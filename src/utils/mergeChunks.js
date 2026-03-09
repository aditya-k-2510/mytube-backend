import fs from "fs";

export const mergeChunks = async (fileId, fileName, totalChunks) => {

   const chunkDir = `./public/temp/chunkUploads/${fileId}`;
   const finalPath = `${chunkDir}/${fileName}`;

   const writeStream = fs.createWriteStream(finalPath);

   for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `${chunkDir}/${i}`;
      const data = fs.readFileSync(chunkPath);
      if (!writeStream.write(data)) {
         await new Promise(resolve =>
            writeStream.once("drain", resolve)
         );
      }
      if (fs.existsSync(chunkPath)) {
         fs.unlinkSync(chunkPath);
      }
   }
   await new Promise(resolve =>
      writeStream.end(resolve)
   );
   return finalPath;
};