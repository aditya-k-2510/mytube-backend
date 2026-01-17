import { Router } from "express"
import { 
            registerUser, 
            loginUser, 
            logoutUser, 
            refreshUser, 
            changeCurrentPassword, 
            getCurrentUser, 
            updateAccountDetails ,
            updateUserAvatar,
            updateUserCoverImage
        } from "../controllers/user.controller.js"
import { upload } from "../middlewares/multer.middleware.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"


const router = Router()
router.route("/register").post(
    upload.fields([
        {
            name: "avatar",
            maxCount: 1
        }, 
        {
            name: "coverImage",
            maxCount: 1
        }
    ]),
    registerUser
)

router.route("/login").post(loginUser)


// SECURED ROUTES

router.route("/logout").post(verifyJWT, logoutUser)
router.route("/refresh-token").post(refreshUser)
router.route("/change-password").post(verifyJWT, changeCurrentPassword)
router.route("/profile").get(verifyJWT, getCurrentUser)
router.route("/update-details").post(verifyJWT, updateAccountDetails)
router.route("/update-avatar").post(verifyJWT, 
    upload.fields([
        {
            name: "avatar",
            maxCount: 1
        }
    ]), 
    updateUserAvatar)
router.route("/update-coverimage").post(verifyJWT, 
    upload.fields([
        {
            name: "coverImage",
            maxCount: 1
        }
    ]), 
    updateUserCoverImage)

export default router