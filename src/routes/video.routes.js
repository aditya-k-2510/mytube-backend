import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { uploadChunk } from "../middlewares/multer.videoChunk.middleware.js"
import {
   getAllVideos,
   getVideoById,
   updateVideo,
   deleteVideo,
   togglePublishStatus,
   initVideoUpload,
   uploadVideoChunk,
   getUploadStatus,
   finishVideoUpload,
   getProcessingStatus,
   getStreamUrls,
   postWatchProgress
} from "../controllers/video.controller.js";

const router = Router();

router.use(verifyJWT);

router
   .route("/")
   .get(getAllVideos)

router
   .route("/init-upload")
   .post(
      upload.single("thumbnail"),
      initVideoUpload)

router
   .route("/chunk-upload/:fileId/:chunkIndex")
   .put(
      uploadChunk.single("chunk"),
      uploadVideoChunk)

router
   .route("/finish-upload/:fileId")
   .post(finishVideoUpload)

router
   .route("/upload-status/:fileId")
   .get(getUploadStatus)

router
   .route("/processing-status/:videoId")
   .get(getProcessingStatus)

router
   .route("/:videoId/stream")
   .get(getStreamUrls)

router
   .route("/watch-progress/:videoId")
   .post(postWatchProgress)
   
router
   .route("/:videoId")
   .get(getVideoById)
   .patch(upload.single("thumbnail"), updateVideo)
   .delete(deleteVideo);

router.route("/toggle/publish/:videoId").patch(togglePublishStatus);

export default router;