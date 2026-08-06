# MyTube Backend

A YouTube-style video backend/API service — chunked resumable uploads, async FFmpeg transcoding to adaptive-bitrate HLS, and Redis-cached video listings/streaming, all backed by MongoDB and local disk storage.

This is a **backend-only repository**. It exposes a REST API (Express 5) consumed by a separate frontend client; no UI code lives here.

## Architecture

```
                                   ┌──────────────────────┐
                                   │        Client        │
                                   │ (external consumer   │
                                   │   of this REST API)  │
                                   └──────────┬───────────┘
                                              │ HTTP (chunked upload,
                                              │ CRUD, stream URLs)
                                              ▼
                                   ┌──────────────────────┐
                                   │     API Server       │
                                   │   (src/app.js +      │
                                   │    src/index.js)     │
                                   └───┬──────────────┬───┘
                                       │              │
                        writes/reads   │              │ enqueues
                                       ▼              ▼
                       ┌───────────────────┐   ┌───────────────────┐
                       │  MongoDB          │   │  Bull Queue       │
                       │  (video, user,    │   │  "video-          │
                       │   view, ... docs) │   │   transcoding"    │
                       └───────────────────┘   │  (Redis-backed,   │
                                                │   src/jobs/       │
                       ┌───────────────────┐   │   queue.js)       │
                       │  Redis            │   └─────────┬─────────┘
                       │  - cache.js       │             │
                       │    (video lists,  │             │ jobs picked up by
                       │    stream URLs)   │             ▼
                       │  - upload         │   ┌───────────────────┐
                       │    sessions       │   │  Worker Process   │
                       │  - Bull job data  │   │  (src/worker.js → │
                       └───────────────────┘   │   transcodeWorker)│
                                                └─────────┬─────────┘
                                                          │ shells out to
                                                          ▼
                                                ┌───────────────────┐
                                                │      FFmpeg       │
                                                │ (fluent-ffmpeg):  │
                                                │ probe, thumbnail, │
                                                │ transcode, HLS    │
                                                └─────────┬─────────┘
                                                          │ writes files
                                                          ▼
                                                ┌───────────────────┐
                                                │  Local Storage    │
                                                │  ./public/videos/ │
                                                │  (src/utils/      │
                                                │  localStorage.js) │
                                                └───────────────────┘
```

The API server and the worker are **separate Node processes** (`npm run dev` vs `npm run worker:dev`) that communicate only through MongoDB (job status fields on the `Video` document) and the Bull queue (job payloads). Neither process talks to the other directly.

## Upload Flow (Backend Perspective)

The backend never receives a whole video file in one request — it only ever sees small chunks and a merge trigger. The four endpoints involved, in order:

1. **`POST /videos/init-upload`** ([video.controller.js](src/controllers/video.controller.js) → `initVideoUpload`)
   Accepts `title`, `description`, and an optional `thumbnail` file (via `multer.middleware.js`, written to `./public/temp`). Generates a `fileId` with `crypto.randomUUID()`, and stores a session object (`title`, `description`, `ownerId`, `thumbnailPath`) in Redis under `upload-session:{fileId}` with a **7200s (2h) TTL**. Returns `fileId` to the client — nothing touches MongoDB yet.

2. **`PUT /videos/chunk-upload/:fileId/:chunkIndex`** ([video.controller.js](src/controllers/video.controller.js) → `uploadVideoChunk`)
   `multer.videoChunk.middleware.js` streams the chunk straight to disk at `./public/temp/chunkUploads/{fileId}/{chunkIndex}` — the chunk index becomes the filename, so re-uploading the same index simply overwrites it (this is what makes resumption idempotent). The controller just confirms the file landed on disk; it does not validate chunk order or count.

3. **`GET /videos/upload-status/:fileId`** ([video.controller.js](src/controllers/video.controller.js) → `getUploadStatus`)
   Lists the chunk directory (`fs.readdirSync`) and returns the received chunk indices as numbers. There's no separate manifest — the filesystem *is* the source of truth for what's been received, which is why this endpoint has to exist (a resuming client needs to ask the backend what it already has).

4. **`POST /videos/finish-upload/:fileId`** ([video.controller.js](src/controllers/video.controller.js) → `finishVideoUpload`)
   This is where the real work starts:
   - Looks up the session in Redis (`upload-session:{fileId}`). If it's gone (TTL expired, or Redis/server restarted), returns **410 Gone** — the client has to restart the upload.
   - Calls `mergeChunks(fileId, fileName, totalChunks)` ([mergeChunks.js](src/utils/mergeChunks.js)), which streams each chunk file into a single write stream in index order, respecting backpressure (`drain` events), deleting each chunk file as it's consumed.
   - Creates the `Video` document in MongoDB with `processingStatus: "queued"`, `isPublished: false`, `videoFile: null`.
   - If a thumbnail was provided at init time, copies it from temp into permanent storage via `saveToLocal`. **The thumbnail is optional** — if omitted, the worker auto-generates one during transcoding (see below).
   - Enqueues a `"transcode"` job on `transcodingQueue` ([queue.js](src/jobs/queue.js)) with `videoId`, `inputPath` (the merged file), `originalFileName`, and `needsThumbnail` (true only if no thumbnail was supplied).
   - Stores the returned `job.id` on the video document as `transcodingJobId`.
   - Deletes the Redis upload session and flushes the `videos:*` cache (a new, if unpublished, video shouldn't matter to cached listings yet, but this keeps state consistent).
   - Returns **202 Accepted** with the video document and job ID — the client polls from here.

The merged chunk file and its parent chunk directory are cleaned up by the **worker**, not the API, once transcoding finishes successfully — so a failed job leaves the source file in place for retry.

## Thumbnail Generation

Thumbnails are optional at upload time. If the user doesn't provide one, the worker generates one automatically.

In [transcodeWorker.js](src/jobs/transcodeWorker.js), **Step 2** of the `transcodingQueue.process("transcode", ...)` handler runs conditionally on the `needsThumbnail` flag from the job payload:

- **`needsThumbnail: true`** (no user-provided thumbnail) — `generateThumbnail` extracts a frame from the source video at the 2-second mark via FFmpeg, saves it to local storage, and the resulting URL is written to the video document's `thumbnail` field once transcoding completes. Failure to generate a thumbnail here is non-fatal — the video still proceeds through the rest of the pipeline with `thumbnail` left as-is.
- **`needsThumbnail: false`** (thumbnail already supplied at init/finish-upload) — Step 2 is skipped entirely; the user-provided thumbnail is left untouched.

## Adaptive Bitrate Streaming — Generation

HLS generation happens entirely inside the worker ([transcodeWorker.js](src/jobs/transcodeWorker.js)), in the `transcodingQueue.process("transcode", ...)` handler, after per-quality MP4 transcoding (Step 4) completes:

**Step 4.5 — per-quality HLS segments.** For each applicable resolution preset (360p/720p/1080p — see [Design Decisions](#design-decisions) for why some are skipped), `generateQualityHLS` runs FFmpeg with `-f hls`, `-hls_time 6`, `-hls_list_size 0`, writing segments and a playlist into a dedicated subdirectory:

```
public/videos/{videoId}/hls/
├── master.m3u8
├── 360p/
│   ├── playlist.m3u8
│   └── seg_000.ts, seg_001.ts, ...
├── 720p/
│   ├── playlist.m3u8
│   └── seg_000.ts, seg_001.ts, ...
└── 1080p/
    ├── playlist.m3u8
    └── seg_000.ts, seg_001.ts, ...
```

**Master playlist.** Once all quality directories are written, `writeMasterPlaylist` ([transcodeWorker.js:91-100](src/jobs/transcodeWorker.js)) builds `master.m3u8` by listing one `#EXT-X-STREAM-INF` entry per completed quality, with `BANDWIDTH` computed from the preset's video bitrate (`parseInt(videoBitrate) * 1000`) and `RESOLUTION` from its width/height:

```
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"
360p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"
720p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
```

The resulting URL (`{BASE_URL}/videos/{videoId}/hls/master.m3u8`) is saved on the video document as `hlsManifestUrl`. If HLS generation produces zero completed qualities (all failed), `hlsManifestUrl` stays `null` and the video falls back to the flat MP4 files under `qualities.*` — client-side player behavior for that fallback is out of scope for this repo.

Per-quality generation is independent and non-fatal: if 1080p's `ffmpeg` call throws, the loop logs it and continues with whatever qualities succeeded, so a video is never blocked from going live just because one rendition failed.

## Caching

All caching goes through [cache.js](src/utils/cache.js) — a thin wrapper over `ioredis` with `get`/`set`/`del`/`flush` that fails soft (returns `null` / no-ops) whenever Redis is disconnected, rather than throwing and taking down a request.

| Cache key | Set by | TTL | Invalidated by |
|---|---|---|---|
| `videos:{md5Hash}` | `getAllVideos` | 300s (5 min) | `cache.flush("videos:*")` in `updateVideo`, `deleteVideo`, `togglePublishStatus`, `finishVideoUpload`, and the worker on transcode completion |
| `stream:{videoId}` | `getStreamUrls` | 86400s (24h) | `cache.del(\`stream:${videoId}\`)` in `deleteVideo` |
| `upload-session:{fileId}` | `initVideoUpload` | 7200s (2h) | `cache.del` in `finishVideoUpload`, or natural TTL expiry |

**List caching.** `getAllVideos` builds its key by MD5-hashing the exact query params it was called with — `{ page, limit, query, sortBy, sortType, userId }` — so every distinct filter/sort/page combination gets its own cache entry (`videos:{md5Hash}`). This is why invalidation has to be a `flush("videos:*")` pattern scan rather than a single `del`: there's no way to know in advance which hashed keys might contain a since-changed video.

**Stream URL caching.** `getStreamUrls` only caches once `processingStatus === "ready"` — the qualities/HLS manifest URLs on a ready video never change again, which is exactly why this TTL is 24h instead of 5 minutes (see [Design Decisions](#design-decisions)).

**The deliberate gap: `getVideoById` is not cached.** This is the single-video detail endpoint — it's the one place likes count, subscriber count, and `isSubscribed` are computed per-viewer via `$lookup`/`$cond` on `req.user`. Caching it naively would either cache per-user (defeating the purpose — cache key would be the same as no cache for a single viewer) or serve one viewer's subscription state to another. It's also refreshed on every like/subscribe action from the client today (`fetchVideoData()` re-fetch), so a stale cache would visibly contradict the action a user just took. The honest trade-off: this is the most frequently-hit read path (every video page view) and currently gets zero caching benefit — a viewer-agnostic cache split from the per-viewer fields would fix this, but hasn't been built.

## Recommendation System

`GET /videos/recommendations/home` ([video.controller.js](src/controllers/video.controller.js) → `getHomeRecommendations`) replaces the generic "all videos" home feed with a personalized, scored ranking. It requires authentication.

Every **published, ready** video in the database is scored:

```
score = subscriptionBoost + views + (createdAt / 1e9)
```

- **`subscriptionBoost`** — `2000` if the video's owner is a channel the requesting user subscribes to, `0` otherwise.
- **`views`** — the raw view count, used as a popularity signal.
- **recency weight** — the video's `createdAt` timestamp divided by `1e9`, a small tiebreaker that favors newer content without overpowering subscription/popularity signals.

Videos are sorted by `score` descending, then paginated (`page`/`limit`, same as `getAllVideos`). A search `query`, if provided, filters within the scored result set before pagination — same `$regex` match against `title`/`description` as `getAllVideos`. Because of how the score is composed, higher-priority content (subscribed channels, popular videos) naturally surfaces on page 1, while lower-priority content falls to later pages.

The response shape is identical to `getAllVideos` (`{ videos, totalVideos, currentPage, totalPages }`), so the frontend `VideoCard` and pagination UI required zero changes to consume this endpoint.

This is deliberately heuristic-based rather than ML-driven — at this scale, an explicit subscription signal is a stronger, more predictable ranking input than any learned model could produce without substantial training data.

## API Endpoints

All routes below are mounted under `/api/v1/videos` and require `verifyJWT` ([auth.middleware.js](src/middlewares/auth.middleware.js)) — a valid `accessToken` cookie or `Authorization: Bearer <token>` header.

### Upload flow

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/init-upload` | multipart: `title`, `description`, optional `thumbnail` file | `200` → `{ data: fileId }` |
| `PUT` | `/chunk-upload/:fileId/:chunkIndex` | multipart: `chunk` (binary blob) | `200` → `{ data: null, message: "chunk uploaded" }` |
| `GET` | `/upload-status/:fileId` | — | `200` → `{ data: number[] }` (received chunk indices) |
| `POST` | `/finish-upload/:fileId` | JSON: `{ fileName, totalChunks }` | `202` → `{ data: { video, jobId } }`, or `410` if session expired |
| `GET` | `/processing-status/:videoId` | — | `200` → `{ data: { video, jobState, jobProgress } }` (live Bull job state when available) |

### Streaming & CRUD

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/` | query: `page`, `limit`, `query`, `sortBy` (`duration`\|`createdAt`\|`views`), `sortType`, `userId` | `200` → `{ data: { videos, totalVideos, currentPage, totalPages } }` |
| `GET` | `/recommendations/home` | query: `page`, `limit`, `query` (same as `getAllVideos`) | `200` → `{ data: { videos, totalVideos, currentPage, totalPages } }`; personalized, scored ranking — see [Recommendation System](#recommendation-system) |
| `GET` | `/:videoId/stream` | — | `200` → `{ data: { hls, qualities: {360p,720p,1080p,original}, fallback } }`, or `422` if not `ready` |
| `GET` | `/:videoId` | — | `200` → `{ data: video }` with `owner`, `likesCount`, `subscriberCount`, `isSubscribed` populated |
| `PATCH` | `/:videoId` | multipart: optional `title`, `description`, `thumbnail` | `200` → `{ data: updatedVideo }`; owner-only |
| `DELETE` | `/:videoId` | — | `200` → `{ data: null }`; owner-only, deletes files + cache entries |
| `PATCH` | `/toggle/publish/:videoId` | — | `200` → `{ data: video }`; owner-only |
| `POST` | `/watch-progress/:videoId` | JSON (stringified body): `{ duration, watchTime }` | `200` → `{ data: "success" }`; increments `views` once `watchTime/duration ≥ 20%` |

All responses use the `ApiResponse` envelope (`{ statusCode, data, message }`); errors use `ApiError` (`{ statusCode, data: null, message, success: false, errors: [] }`), caught by the global error handler in [app.js](src/app.js).

## Project Structure

```
src/
├── app.js                              # Express app: middleware, route mounting, global error handler
├── index.js                            # API server entrypoint — connects DB, starts HTTP listener
├── worker.js                           # Worker process entrypoint — connects DB, loads transcodeWorker
├── constants.js                        # DB_NAME
├── db/index.js                         # Mongoose connection
├── controllers/
│   ├── video.controller.js             # Upload flow, streaming, video CRUD, watch progress
│   ├── user.controller.js              # Auth, profile, watch history
│   ├── comment.controller.js           # Video comments
│   ├── like.controller.js              # Likes on videos/comments/tweets
│   ├── playlist.controller.js          # Playlists
│   ├── subscription.controller.js      # Channel subscriptions
│   ├── tweet.controller.js             # Short text posts
│   ├── dashboard.controller.js         # Channel stats/video list for owner
│   └── healthcheck.controller.js       # Liveness endpoint
├── jobs/
│   ├── queue.js                        # Bull queue definition (video-transcoding), Redis client factory
│   └── transcodeWorker.js              # FFmpeg pipeline: probe → thumbnail → transcode → HLS → DB update
├── middlewares/
│   ├── auth.middleware.js              # verifyJWT — cookie or Bearer token
│   ├── multer.middleware.js            # Generic file upload (thumbnails, avatars) → ./public/temp
│   └── multer.videoChunk.middleware.js # Per-chunk disk storage → ./public/temp/chunkUploads/{fileId}/{chunkIndex}
├── models/                             # Mongoose schemas (video, user, comment, like, playlist, subscription, tweet, view)
├── routes/                             # Express routers, one per resource
├── utils/
│   ├── cache.js                        # Redis get/set/del/flush wrapper, fails soft when disconnected
│   ├── localStorage.js                 # saveToLocal/deleteFromLocal/deleteVideoFiles — swappable storage interface
│   ├── mergeChunks.js                  # Streams chunk files into one, in order, with backpressure handling
│   ├── cloudinary.js                   # Legacy/unused cloud upload helper (superseded by localStorage.js)
│   ├── ApiResponse.js / ApiError.js    # Response/error envelopes
│   └── asyncHandler.js                 # Wraps controllers to forward rejected promises to Express error handler
└── test/                               # Manual scripts for exercising cache/queue/worker in isolation
```

## Setup

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Redis (local or hosted) — used for the Bull queue, response caching, and upload sessions
- FFmpeg installed and on `PATH` (`fluent-ffmpeg` shells out to the system binary)

### Environment variables (`.env`)

```
PORT=3000
BASE_URL=http://localhost:3000
MONGODB_URL=<your MongoDB connection string>
CORS_ORIGIN=<frontend origin>
ACCESS_TOKEN_SECRET=<secret>
REFRESH_TOKEN_SECRET=<secret>
ACCESS_TOKEN_EXPIRY=<e.g. 1d>
REFRESH_TOKEN_EXPIRY=<e.g. 10d>
REDIS_URL=redis://127.0.0.1:6379
CACHE_TTL_SECS=<default TTL fallback>
```
(`CLOUDINARY_*` vars exist for the legacy `cloudinary.js` helper, unused by the current local-storage upload path.)

### Install

```bash
npm install
```

### Run

The API server and transcode worker are independent processes — both need to be running for uploads to actually finish processing:

```bash
# terminal 1 — API server
npm run dev        # nodemon src/index.js

# terminal 2 — transcode worker
npm run worker:dev  # nodemon src/worker.js
```

(`npm start` / `npm run worker` run the non-watching equivalents.)

## Design Decisions

**Why async transcoding via a queue instead of inline processing?** Transcoding a video to three resolutions plus HLS segments takes far longer than an HTTP request should block for. Queuing the job (`transcodingQueue.add`) lets `finishVideoUpload` return **202 Accepted** immediately, and the client polls `/processing-status/:videoId` instead of holding a connection open for minutes. It also means a worker crash or restart doesn't drop in-flight uploads — Bull's `attempts: 3` with exponential backoff ([queue.js](src/jobs/queue.js)) retries the whole job automatically.

**Why skip upscaling?** [transcodeWorker.js](src/jobs/transcodeWorker.js) filters `QUALITY_PRESETS` to only those whose `height <= originalHeight`. Transcoding a 480p source up to a synthetic 1080p rendition burns CPU and storage to produce a stream that looks worse than just serving the original at a lower advertised bitrate — there's no real quality to manufacture, only file size.

**Why local storage with a swappable interface instead of committing to a cloud provider upfront?** `saveToLocal`/`deleteFromLocal`/`deleteVideoFiles` ([localStorage.js](src/utils/localStorage.js)) return the same `{ url, path, size }` shape regardless of backing store. Every caller (controllers, the worker) only depends on that interface, not on `fs` directly — so migrating to S3 or another object store later means rewriting one file, not every call site.

**Why Redis for upload sessions instead of an in-memory object?** An in-memory session map dies with the process — a `nodemon` reload or a deploy mid-upload would silently orphan every in-flight upload with no way for the client to recover. Redis with a 7200s TTL survives server restarts and naturally expires abandoned sessions without a cleanup job.

**Why do stream URLs get a 24h TTL versus 5 minutes for listings?** `getStreamUrls` only populates its cache once `processingStatus === "ready"` — at that point `qualities` and `hlsManifestUrl` are immutable for that video's lifetime (short of a full re-upload, which creates a new video document). Video listings, by contrast, reflect view counts, publish status, and set membership (which videos match a filter) that change continuously — 5 minutes bounds staleness on data that's actually still moving.

## How This Compares to Production Video Platforms

- **Single MongoDB instance vs. sharded/replicated clusters.** Every read and write here goes to one Mongo deployment. At real scale, video metadata and view counters need horizontal sharding and read replicas to survive the write volume a platform like YouTube generates.
- **One worker process vs. a transcoding farm.** `transcodingQueue.process("transcode", CONCURRENCY, ...)` runs with a concurrency of 2 on a single machine. Production platforms distribute encoding across large fleets of dedicated, often hardware-accelerated (GPU/ASIC) transcoding nodes, processing many jobs and many resolutions fully in parallel.
- **Local disk + `BASE_URL` vs. a global CDN.** Files are served straight from `./public/videos` on the API host. There's no edge caching, so every viewer's stream request round-trips to wherever this server happens to be deployed — a real platform pushes segments to a CDN so viewers hit a nearby edge node instead of the origin.
