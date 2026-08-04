import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import dotenv from "dotenv";
import { transcodingQueue } from "./queue.js";
import { Video } from "../models/video.model.js";
import { saveToLocal } from "../utils/localStorage.js";
import * as cache from "../utils/cache.js";

dotenv.config({ path: "./.env" });

const CONCURRENCY = 2;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const QUALITY_PRESETS = [
   { name: "360p", width: 640, height: 360, videoBitrate: "800k", audioBitrate: "96k" },
   { name: "720p", width: 1280, height: 720, videoBitrate: "2500k", audioBitrate: "128k" },
   { name: "1080p", width: 1920, height: 1080, videoBitrate: "5000k", audioBitrate: "192k" },
];

const probeVideo = (filePath) => {
   return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
         if (err) return reject(err);
         resolve(metadata);
      });
   });
};

const generateThumbnail = (inputPath, tempDir) => {
   const fileName = "thumbnail.jpg";
   return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
         .on("end", () => resolve(path.join(tempDir, fileName)))
         .on("error", (err) => reject(err))
         .screenshots({
            timestamps: ["00:00:02"],
            filename: fileName,
            folder: tempDir,
            size: "1280x720",
         });
   });
};

const transcodeQuality = (inputPath, outputPath, preset) => {
   return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
         .videoCodec("libx264")
         .audioCodec("aac")
         .size(`${preset.width}x${preset.height}`)
         .videoBitrate(preset.videoBitrate)
         .audioBitrate(preset.audioBitrate)
         .outputOptions([
            "-preset fast",
            "-movflags +faststart",
            "-profile:v main",
            "-crf 23",
         ])
         .on("end", () => resolve())
         .on("error", (err) => reject(err))
         .save(outputPath);
   });
};

const generateQualityHLS = (inputPath, outputDir, preset) => {
   const qualityDir = path.join(outputDir, preset.name);
   const playlistPath = path.join(qualityDir, "playlist.m3u8");
   return new Promise((resolve, reject) => {
      fs.mkdirSync(qualityDir, { recursive: true });
      ffmpeg(inputPath)
         .videoCodec("libx264")
         .audioCodec("aac")
         .size(`${preset.width}x${preset.height}`)
         .videoBitrate(preset.videoBitrate)
         .audioBitrate(preset.audioBitrate)
         .outputOptions([
            "-preset fast",
            "-profile:v main",
            "-crf 23",
            "-hls_time 6",
            "-hls_list_size 0",
            "-hls_segment_filename",
            path.join(qualityDir, "seg_%03d.ts"),
            "-f hls",
         ])
         .on("end", () => resolve({ preset, playlistPath }))
         .on("error", (err) => reject(err))
         .save(playlistPath);
   });
};

const writeMasterPlaylist = (outputDir, completedQualities, baseUrl, videoId) => {
   let manifest = "#EXTM3U\n#EXT-X-VERSION:3\n\n";
   for (const { preset } of completedQualities) {
      const bandwidth = parseInt(preset.videoBitrate.replace("k", ""), 10) * 1000;
      manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${preset.width}x${preset.height},NAME="${preset.name}"\n`;
      manifest += `${preset.name}/playlist.m3u8\n\n`;
   }
   fs.writeFileSync(path.join(outputDir, "master.m3u8"), manifest);
   return `${baseUrl}/videos/${videoId}/hls/master.m3u8`;
};

const safeRemoveDir = (dirPath) => {
   try {
      if (dirPath && fs.existsSync(dirPath)) {
         fs.rmSync(dirPath, { recursive: true, force: true });
      }
   } catch (err) {
      console.warn(`⚠️ [Worker] Failed to remove ${dirPath}: ${err.message}`);
   }
};

transcodingQueue.process("transcode", CONCURRENCY, async (job) => {
   const { videoId, inputPath, originalFileName, needsThumbnail } = job.data;
   const tempDir = `/tmp/transcode_${videoId}`;
   const qualities = {};
   let thumbnailUrl = null;
   let hlsManifestUrl = null;

   console.log(`🎬 [Worker] Starting transcode for video: ${videoId} (${originalFileName})`);

   try {
      // STEP 0 — SETUP
      fs.mkdirSync(tempDir, { recursive: true });
      await Video.findByIdAndUpdate(videoId, {
         processingStatus: "processing",
         processingProgress: 0,
      });
      await job.progress(0);

      // STEP 1 — PROBE
      console.log(`📊 [Worker] Probing input file for video: ${videoId}`);
      const metadata = await probeVideo(inputPath);
      const duration = Math.round(metadata.format?.duration || 0);
      const videoStream = metadata.streams.find((s) => s.codec_type === "video");
      const originalWidth = videoStream?.width || 0;
      const originalHeight = videoStream?.height || 0;

      await Video.findByIdAndUpdate(videoId, { duration });
      await job.progress(5);
      console.log(
         `📊 [Worker] Probe complete for video: ${videoId} — ${originalWidth}x${originalHeight}, ${duration}s`
      );

      // STEP 2 — THUMBNAIL (non-fatal)
      if(needsThumbnail) {
         console.log(`📸 [Worker] Generating thumbnail for video: ${videoId}`);
         try {
            const thumbPath = await generateThumbnail(inputPath, tempDir);
            const { url } = saveToLocal(thumbPath, videoId, "thumbnail.jpg");
            thumbnailUrl = url;
            console.log(`📸 [Worker] Thumbnail saved for video: ${videoId} — ${url}`);
         } catch (err) {
            console.warn(`⚠️ [Worker] Thumbnail generation failed for video: ${videoId} (non-fatal): ${err.message}`);
            thumbnailUrl = null;
         }
      }
      else {
         console.log(`📸 [Worker] User-provided thumbnail exists, skipping thumbnail generation for video: ${videoId}`);
      }
      await job.progress(10);

      // STEP 3 — SAVE ORIGINAL (non-fatal)
      try {
         const { url } = saveToLocal(inputPath, videoId, "original.mp4");
         qualities.original = url;
         console.log(`💾 [Worker] Original saved for video: ${videoId} — ${url}`);
      } catch (err) {
         console.warn(`⚠️ [Worker] Saving original failed for video: ${videoId} (non-fatal): ${err.message}`);
      }

      // STEP 4 — TRANSCODE TO MULTIPLE QUALITIES
      const applicablePresets = QUALITY_PRESETS.filter((preset) => {
         if (preset.height > originalHeight) {
            console.log(
               `⏭️ [Worker] Skipping ${preset.name} for video: ${videoId} — exceeds original resolution (${originalWidth}x${originalHeight})`
            );
            return false;
         }
         return true;
      });

      const PROGRESS_START = 15;
      const PROGRESS_END = 75;

      for (let i = 0; i < applicablePresets.length; i++) {
         const preset = applicablePresets[i];
         console.log(`🔄 [Worker] Transcoding ${preset.name} for video: ${videoId}`);
         try {
            const tempOutputPath = path.join(tempDir, `video_${preset.name}.mp4`);
            await transcodeQuality(inputPath, tempOutputPath, preset);
            const { url } = saveToLocal(tempOutputPath, videoId, `video_${preset.name}.mp4`);
            qualities[preset.name] = url;
            console.log(`✅ [Worker] ${preset.name} transcoded for video: ${videoId} — ${url}`);
         } catch (err) {
            console.error(`❌ [Worker] ${preset.name} transcode failed for video: ${videoId} (non-fatal): ${err.message}`);
         }

         const progress = Math.round(
            PROGRESS_START + ((i + 1) / applicablePresets.length) * (PROGRESS_END - PROGRESS_START)
         );
         await job.progress(progress);
      }

      // STEP 4.5 — GENERATE ADAPTIVE BITRATE HLS
      console.log(`🎞️ [Worker] Generating adaptive bitrate HLS for video: ${videoId}`);
      await job.progress(80);
      const hlsDir = path.join("./public/videos", videoId, "hls");
      fs.mkdirSync(hlsDir, { recursive: true });

      const completedQualities = [];
      for (const preset of applicablePresets) {
         try {
            const result = await generateQualityHLS(inputPath, hlsDir, preset);
            completedQualities.push(result);
         } catch (err) {
            console.error(`❌ [Worker] ${preset.name} HLS generation failed for video: ${videoId} (non-fatal): ${err.message}`);
         }
      }

      if (completedQualities.length > 0) {
         hlsManifestUrl = writeMasterPlaylist(hlsDir, completedQualities, BASE_URL, videoId);
         console.log(
            `🎞️ [Worker] Adaptive bitrate HLS generated for video: ${videoId} — qualities: ${completedQualities.map((q) => q.preset.name).join(", ")}`
         );
      }
      await job.progress(90);

      // STEP 5 — UPDATE DATABASE
      await job.progress(95);
      const primaryVideoFile =
         qualities["1080p"] || qualities["720p"] || qualities["360p"] || qualities.original;

      const updatePayload = {
         videoFile: primaryVideoFile,
         qualities,
         processingStatus: "ready",
         processingProgress: 100,
         isPublished: true,
      };
      if (thumbnailUrl) {
         updatePayload.thumbnail = thumbnailUrl;
      }
      if (hlsManifestUrl) {
         updatePayload.hlsManifestUrl = hlsManifestUrl;
      }

      await Video.findByIdAndUpdate(videoId, updatePayload);
      const v = await Video.findById(videoId)
      console.log(v)
      await cache.flush("videos:*");

      // STEP 6 — CLEANUP
      await job.progress(100);
      safeRemoveDir(tempDir);
      safeRemoveDir(path.dirname(inputPath));

      console.log(`✅ [Worker] Transcode complete for video: ${videoId}`);
      return { videoId, status: "completed", qualities };
   } catch (error) {
      console.error(`❌ [Worker] Fatal error transcoding video: ${videoId} — ${error.message}`);
      try {
         await Video.findByIdAndUpdate(videoId, {
            processingStatus: "failed",
            processingError: error.message,
         });
      } catch (dbErr) {
         console.error(`❌ [Worker] Failed to update failed status for video: ${videoId} — ${dbErr.message}`);
      }
      safeRemoveDir(tempDir);
      throw error;
   }
});

console.log(`🎬 [Worker] Transcode processor registered (concurrency: ${CONCURRENCY})`);