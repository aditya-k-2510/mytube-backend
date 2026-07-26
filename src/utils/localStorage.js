import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

const STORAGE_DIR = "./public/videos";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

if (!fs.existsSync(STORAGE_DIR)) {
   fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const saveToLocal = (sourcePath, subDir, fileName) => {
   const outputDir = path.join(STORAGE_DIR, subDir);
   if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
   }

   const outputPath = path.join(outputDir, fileName);
   fs.copyFileSync(sourcePath, outputPath);

   const size = fs.statSync(outputPath).size;
   const url = `${BASE_URL}/videos/${subDir}/${fileName}`;

   return { url, path: outputPath, size };
};

const deleteFromLocal = (urlOrPath) => {
   try {
      let localPath = urlOrPath;

      if (urlOrPath.startsWith("http")) {
         const { pathname } = new URL(urlOrPath);
         localPath = path.join(".", "public", pathname);
      }

      if (!fs.existsSync(localPath)) return;

      const isDirectory = fs.statSync(localPath).isDirectory();
      if (isDirectory) {
         fs.rmSync(localPath, { recursive: true });
      } else {
         fs.unlinkSync(localPath);
      }
   } catch (error) {
      console.log("Local delete error:", error);
   }
};

const deleteVideoFiles = (videoId) => {
   deleteFromLocal(path.join(STORAGE_DIR, videoId));
};

export { 
saveToLocal,
deleteFromLocal, 
deleteVideoFiles 
};