import { Router } from "express";

import {
   registerUser,
   loginUser,
   logoutUser,
   refreshUser,
   changeCurrentPassword,
   getCurrentUser,
   updateAccountDetails,
   updateUserAvatar,
   updateUserCoverImage,
   getUserChannelProfile,
   getWatchHistory,
} from "../controllers/user.controller.js";

import { upload } from "../middlewares/multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.route("/register").post(
   upload.fields([
      {
         name: "avatar",
         maxCount: 1,
      },
      {
         name: "coverImage",
         maxCount: 1,
      },
   ]),
   registerUser
);

router.route("/login").post(loginUser);

// SECURED ROUTES

router.route("/logout").post(verifyJWT, logoutUser);
router.route("/refresh").post(refreshUser);
router.route("/change-password").post(verifyJWT, changeCurrentPassword);
router.route("/profile").get(verifyJWT, getCurrentUser);
router.route("/update-details").patch(verifyJWT, updateAccountDetails);

router
   .route("/avatar")
   .patch(verifyJWT, upload.single("avatar"), updateUserAvatar);

router
   .route("/coverimage")
   .patch(verifyJWT, upload.single("coverImage"), updateUserCoverImage);

router.route("/history").get(verifyJWT, getWatchHistory);

router.route("/c/:username").get(verifyJWT, getUserChannelProfile);

export default router;