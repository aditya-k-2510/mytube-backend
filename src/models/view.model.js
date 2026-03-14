import mongoose, { Schema } from "mongoose";

const viewSchema = new Schema(
    {
        viewer: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        video: {
            type: Schema.Types.ObjectId,
            ref: "Video",
        },
        watchTime: {
            type: Number,
            required: true
        },
        viewCounted: {
            type: Boolean,
            default: false
        },
        videoDuration: {
            type: Number,
            required: true
        }
    },
    {
      timestamps: true,
    }
);

export const View = mongoose.model("View", viewSchema);