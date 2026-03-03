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
   uploadVideoChunk
} from "../controllers/video.controller.js";

const router = Router();

router.use(verifyJWT); // this applies verifyJWT middleware to all routes in this file

router
   .route("/")
   .get(getAllVideos)
router
   .route("/init-upload")
   .post(
      upload.single("thumbnail"),
      initVideoUpload)
router
   .route("/chunk-upload/:fileId")
   .post(
      uploadChunk.single("chunk"),
      uploadVideoChunk)
router
   .route("/:videoId")
   .get(getVideoById)
   .patch(upload.single("thumbnail"), updateVideo)
   .delete(deleteVideo);

router.route("/toggle/publish/:videoId").patch(togglePublishStatus);

export default router;
