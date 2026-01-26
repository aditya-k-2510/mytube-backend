import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

cloudinary.config({
   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
   api_key: process.env.CLOUDINARY_API_KEY,
   api_secret: process.env.CLOUDINARY_SECRET_KEY,
});

const uploadOnCloudinary = async (localFilePath) => {
   try {
      if (!localFilePath) {
         return null;
      }
      const response = await cloudinary.uploader.upload(localFilePath, {
         resource_type: "auto",
      });
      //file upload successfully
      console.log("file uploaded on cloudinary:", response.url);
      fs.unlinkSync(localFilePath); // remove locally saved files as
      return response;
   } catch (error) {
      console.log(error);
      fs.unlinkSync(localFilePath); //remove locally saved temporary file as upload operation got failed
      return null;
   }
};

const deleteFromCloudinary = async (fileUrl) => {
   try {
      const publicId = fileUrl.split("/").pop().split(".")[0]
      await cloudinary.uploader.destroy(publicId)
   } catch (error) {
      console.log("Cloudinary delete error:", error)
   }
}

export { 
   uploadOnCloudinary,
   deleteFromCloudinary
};
