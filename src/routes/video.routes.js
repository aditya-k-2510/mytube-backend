import { Router } from "express"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middleware.js"

const router = Router();

router.use(verifyJWT); // this applies verifyJWT middleware to all routes in this file

export default router