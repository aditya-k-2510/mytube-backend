import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
app.use(
   cors({
      //app.use() is for configuration
      origin: process.env.CORS_ORIGIN,
      credentials: true,
   })
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public")); //for logos, image, etc.
app.use(cookieParser());

//import routes
import userRouter from "./routes/user.routes.js";
import videoRouter from "./routes/video.routes.js";

//routes declaration
app.use("/api/v1/users", userRouter);
app.use("/api/v1/videos", videoRouter);

export { app };
