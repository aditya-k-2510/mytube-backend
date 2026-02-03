import mongoose, { Schema } from "mongoose";

const playlistSchema = new Schema(
   {
      name: {
         type: String,
         required: true,
      },
      description: {
         type: String,
         required: true,
      },
      videos: [
         {
            type: Schema.Types.ObjectId,
            ref: "Video",
         },
      ],
      owner: {
         type: Schema.Types.ObjectId,
         ref: "User",
      },
      public: {
         type: Boolean,
         default: true
      }
   },
   {
      timestamps: true,
   }
);

playlistSchema.index(
   { 
      name: 1, 
      owner: 1 
   }, 
   { 
      unique: true 
   }
)

export const Playlist = mongoose.model("Playlist", playlistSchema);
