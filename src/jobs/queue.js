import Queue from "bull";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const createClient = (type) => {
   const baseOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
   };

   switch (type) {
      case "client":
         return new Redis(REDIS_URL); // normal client — defaults are fine
      case "subscriber":
         return new Redis(REDIS_URL, baseOptions);
      case "bclient":
         return new Redis(REDIS_URL, baseOptions);
      default:
         throw new Error(`Unexpected redis client type: ${type}`);
   }
};

const transcodingQueue = new Queue("video-transcoding", {
   createClient,
   defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 3,
      backoff: {
         type: "exponential",
         delay: 5000,
      },
   },
});

transcodingQueue.on("completed", (job, result) => {
   const videoId = result?.videoId ?? job.data?.videoId;
   console.log(`Job ${job.id} completed — video ${videoId} transcoded`);
});

transcodingQueue.on("failed", (job, error) => {
   console.log(
      `Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`
   );
});

transcodingQueue.on("progress", (job, progress) => {
   console.log(`Job ${job.id} progress: ${progress}%`);
});

transcodingQueue.on("stalled", (job) => {
   console.log(`Job ${job.id} stalled — will be retried`);
});

const gracefulShutdown = async (signal) => {
   console.log(`${signal} received: closing video-transcoding queue`);
   await transcodingQueue.close();
   process.exit(0);
};

transcodingQueue.on("error", (err) => {
   console.error(`[Queue] Redis error (non-fatal): ${err.message}`);
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { transcodingQueue };
