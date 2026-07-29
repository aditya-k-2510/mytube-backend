import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const videoSchema = new Schema(
   {
      videoFile: {
         type: String, 
         default: null
      },
      thumbnail: {
         type: String, 
         default: null,
      },
      title: {
         type: String,
         required: true,
      },
      description: {
         type: String,
         required: true,
      },
      duration: {
         type: Number, 
         default: 0
      },
      views: {
         type: Number,
         default: 0,
      },
      isPublished: {
         type: Boolean,
         default: true,
      },
      owner: {
         type: Schema.Types.ObjectId,
         ref: "User",
      },

      processingStatus: {
         type: String,
         enum: ["queued", "processing", "ready", "failed"],
         default: "queued",
      },

      processingProgress: {
         type: Number,
         default: 0,
         min: 0,
         max: 100,
      },

      processingError: {
         type: String,
         default: null,
      },

      transcodingJobId: {
         type: String,
         default: null,
      },

      qualities: {
         original: {
            type: String,
            default: null,
         },
         "360p": {
            type: String,
            default: null,
         },
         "720p": {
            type: String,
            default: null,
         },
         "1080p": {
            type: String,
            default: null,
         },
      },

      hlsManifestUrl: {
         type: String,
         default: null,
      },
   },
   {
      timestamps: true,
   }
);
videoSchema.plugin(mongooseAggregatePaginate); // specifically for watch history
export const Video = mongoose.model("Video", videoSchema);
