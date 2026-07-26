import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import connectDB from "./db/index.js";

connectDB()
   .then(async () => {
      console.log("🎬 [Worker] MongoDB connected — loading transcode worker...");
      await import("./jobs/transcodeWorker.js");
      console.log("✅ [Worker] Transcode worker is up and listening for jobs");
   })
   .catch((error) => {
      console.error("❌ [Worker] MongoDB connection failed:", error);
      process.exit(1);
   });
