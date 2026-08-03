import mongoose from "mongoose";
import crypto from "crypto"
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { View } from "../models/view.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { mergeChunks } from "../utils/mergeChunks.js";
import { saveToLocal, deleteFromLocal, deleteVideoFiles } from "../utils/localStorage.js";
import { transcodingQueue } from "../jobs/queue.js";
import * as cache from "../utils/cache.js";
import fs from "fs";

const getAllVideos = asyncHandler( async (req, res) => {
   const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;

   if (userId && !mongoose.isValidObjectId(userId))
      throw new ApiError(400, "Invalid user id");

   const allowedSortFields = ["duration", "createdAt", "views"];
   if (sortBy && !allowedSortFields.includes(sortBy))
      throw new ApiError(400, "sortBy field is not allowed");

   const pageNumber = Number(page);
   const pageLimit = Number(limit);
   const skip = (pageNumber - 1) * pageLimit;

   if (pageNumber < 1 || pageLimit < 1)
      throw new ApiError(400, "Invalid pagination parameters");

   const matchStage = {
      isPublished: true,
      ...(userId && {
         owner: new mongoose.Types.ObjectId(userId),
      }),
      ...(query && {
         $or: [
            {
               title: {
                  $regex: query,
                  $options: "i",
               },
            },
            {
               description: {
                  $regex: query,
                  $options: "i",
               },
            },
         ],
      }),
   };

   const sortField = sortBy || "createdAt";
   const sortOrder = sortType === "asc" ? 1 : -1;

   const videos = await Video.aggregate([
      {
         $match: matchStage,
      },
      {
         $sort: {
            [sortField]: sortOrder,
         },
      },
      {
         $skip: skip,
      },
      {
         $limit: pageLimit,
      },
      {
         $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
         },
      },
      {
         $lookup: {
            from: "likes",
            localField: "_id",
            foreignField: "video",
            as: "likes",
         },
      },
      {
         $unwind: "$owner",
      },
      {
         $addFields: {
            channelName: "$owner.username",
            channelCoverImage: "$owner.coverImage",
            channelAvatar: "$owner.avatar",
            ownerName: "$owner.fullName",
            numberOfLikes: {
               $size: "$likes",
            },
         },
      },
      {
         $project: {
            _id: 1,
            thumbnail: 1,
            title: 1,
            description: 1,
            duration: 1,
            views: 1,
            channelName: 1,
            channelCoverImage: 1,
            channelAvatar: 1,
            ownerName: 1,
            isPublished: 1,
            numberOfLikes: 1,
         },
      },
   ]);
   const totalVideosAgg = await Video.aggregate([
      {
         $match: matchStage,
      },
      {
         $count: "total",
      },
   ]);

   const totalVideos = totalVideosAgg[0]?.total || 0;

   return res.status(200).json(
      new ApiResponse(
         200,
         {
            videos,
            totalVideos,
            currentPage: pageNumber,
            totalPages: Math.ceil(totalVideos / pageLimit),
         },
         "videos fetched"
      )
   );
});

const initVideoUpload = asyncHandler( async (req, res) => {
   const { title, description } = req.body;
   const thumbnailPath = req.file?.path || null
   const fileId = crypto.randomUUID();
   const sessionData = {
      title,
      description,
      ownerId: req.user._id.toString(),
      thumbnailPath: thumbnailPath || null
   };
   await cache.set(`upload-session:${fileId}`, sessionData, 7200);
   return res
   .status(200)
   .json(new ApiResponse(200, fileId, "video upload started"))
});

const uploadVideoChunk = asyncHandler( async (req, res) => {
      const { chunkIndex, fileId } = req.params;
      const chunkPath = `./public/temp/chunkUploads/${fileId}/${chunkIndex}`;
      if(!fs.existsSync(chunkPath)) throw new ApiError(500, "error in uploading")
      return res
      .status(200)
      .json(new ApiResponse(200, null, "chunk uploaded"))
});   

const finishVideoUpload = asyncHandler( async(req, res) => {
   const { fileId } = req.params;
   const { fileName, totalChunks } = req.body;
   const session = await cache.get(`upload-session:${fileId}`);
   if(!session) return res.status(410).json(new ApiResponse(410, "oh no! session expired or server was restarted"));
   const finalPath = await mergeChunks(fileId, fileName, totalChunks);
   if(!finalPath) {
      throw new ApiError(500, "final path error")
   }

   const video = await Video.create({
      videoFile: null,
      duration: 0,
      title: session.title,
      description: session.description,
      owner: session.ownerId,
      isPublished: false,
      processingStatus: "queued"
   });
   console.log(`upload finished for ${fileId}`);
   if(session.thumbnailPath) {
      const savedThumbnail = saveToLocal(session.thumbnailPath, video._id, "thumbnail.jpg");
      video.thumbnail = savedThumbnail.url;
      deleteFromLocal(session.thumbnailPath);
   }

   const job = await transcodingQueue.add("transcode", {
      videoId: video._id.toString(),
      inputPath: finalPath,
      originalFileName: fileName,
      needsThumbnail: !session.thumbnailPath,
   });

   video.transcodingJobId = job.id;
   await video.save();

   await cache.del(`upload-session:${fileId}`);
   // TODO: invalidate cache here
   // chunk dir is deleted by the worker's cleanup step after successful transcoding, not here

   return res
         .status(202)
         .json(new ApiResponse(
      202, { video, jobId: job.id }, "video queued for processing"
   ));
});

const getUploadStatus = asyncHandler( async(req, res) => {
   const { fileId } = req.params;
   const chunkDir = `./public/temp/chunkUploads/${fileId}`;
   if (!fs.existsSync(chunkDir)) throw new ApiError(404, "Upload session not found");

   const recieved = fs.readdirSync(chunkDir)
    .map(f => Number(f));
   return res.status(200).json(new ApiResponse(
      200, recieved, "fetched indices of uploaded chunks"
   ));
})

const getVideoById = asyncHandler( async (req, res) => {
   const { videoId } = req.params;

   const video = await Video.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(videoId),
         },
      },
      {
         $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
            pipeline: [
               {
                  $lookup: {
                     from: "subscriptions",
                     localField: "_id",
                     foreignField: "channel",
                     as: "subscribers",
                  },
               },
               {
                  $addFields: {
                     subscriberCount: {
                        $size: "$subscribers",
                     },
                     isSubscribed: {
                        $cond: {
                           if: {
                              $in: [
                                 new mongoose.Types.ObjectId(req.user?._id),
                                 "$subscribers.subscriber",
                              ],
                           },
                           then: true,
                           else: false,
                        },
                     },
                  },
               },
               {
                  $project: {
                     username: 1,
                     avatar: 1,
                     subscriberCount: 1,
                     isSubscribed: 1,
                  },
               },
            ],
         },
      },
      {
         $addFields: {
            owner: {
               $first: "$owner",
            },
         },
      },
      {
         $lookup: {
            from: "likes",
            localField: "_id",
            foreignField: "video",
            as: "likes",
         },
      },
      {
         $addFields: {
            likesCount: {
               $size: "$likes",
            },
         },
      },
      {
         $project: {
            videoFile: 1,
            owner: 1,
            likesCount: 1,
            thumbnail: 1,
            _id: 1,
            title: 1,
            description: 1,
            duration: 1,
            views: 1,
            isPublished: 1,
            processingStatus: 1,
         },
      },
   ]);

   if (video.length == 0) throw new ApiError(404, "Video not found");

   return res
      .status(200)
      .json(new ApiResponse(200, video[0], "video fetched successfully"));
});

const updateVideo = asyncHandler( async (req, res) => {
   const { videoId } = req.params;
   const video = await Video.findById(videoId);
   if (!video) throw new ApiError(404, "video not found");
   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request");
   }

   const { title, description } = req.body;

   const thumbnailLocalPath = req.file?.path;
   const updatedDetails = {};
   if (title) updatedDetails.title = title;

   if (description) updatedDetails.description = description;

   if (thumbnailLocalPath) {
      const thumbnail = saveToLocal(thumbnailLocalPath, videoId, "thumbnail_updated.jpg");
      if (!thumbnail)
         throw new ApiError(500, "error in saving thumbnail");
      updatedDetails.thumbnail = thumbnail.url;
   }

   if (!title && !description && !thumbnailLocalPath)
      throw new ApiError(400, "atleast one field is required");
   const updatedVideo = await Video.findByIdAndUpdate(
      videoId,
      {
         $set: updatedDetails,
      },
      {
         new: true,
      }
   ).select("-videoFile");
   // TODO: invalidate cache here
   return res
      .status(200)
      .json(new ApiResponse(200, updatedVideo, "video updated successfully"));
});

const deleteVideo = asyncHandler( async (req, res) => {
   const { videoId } = req.params;
   const video = await Video.findById(videoId);

   if (!video) throw new ApiError(404, "Video not found");

   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request");
   }

   await deleteVideoFiles(videoId);

   await video.deleteOne();
   // TODO: invalidate cache here

   return res
      .status(200)
      .json(new ApiResponse(200, null, "Video deleted successfully"));
});

const togglePublishStatus = asyncHandler( async (req, res) => {
   const { videoId } = req.params;
   const video = await Video.findById(videoId).select("-videoFile");

   if (!video) throw new ApiError(404, "video not found");

   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request");
   }
   video.isPublished = !video.isPublished;
   await video.save();
   
   return res
      .status(200)
      .json(new ApiResponse(200, video, "publish status changed"));
});

const postWatchProgress = asyncHandler( async (req, res) => {
   try {
   const viewer = req.user._id;
   const { videoId } = req.params;
   const { duration, watchTime} = JSON.parse(req.body);
   console.log(videoId, duration, watchTime, viewer);
   if (!duration) throw new ApiError(400, "duration required");
   if (!watchTime) throw new ApiError(400, "watchTime required");
   let view = await View.findOne(
      {
         viewer, 
         video: videoId
      }
   );
   let user = await User.findById(viewer);
   let video = await Video.findById(videoId);
   console.log(video.videoFile)
   if (video.owner.equals(req.user._id)) {
      return res.status(200).json(new ApiResponse(200, null, "success"));
   }
   if(!view) {
      view = await View.create(
         {
            viewer, 
            video: videoId,
            videoDuration: duration,
            watchTime: watchTime
         }
      );
   }
   else {
      view.watchTime = Math.max(watchTime, view.watchTime);
      await view.save();
   }
   const percentageWatched = (view.watchTime/duration)*100;
   if(percentageWatched>=20) {
      //increasing the views
      if(!view.viewCounted) {
         await Video.updateOne(
         { _id: videoId },
         { $inc: { views: 1 } }
         );
         // TODO: invalidate cache here
         view.viewCounted = true;
         await view.save();
      }

      //adding to watch history
      user.watchHistory = user.watchHistory.filter(
         id => id.toString() !== videoId
      );
      user.watchHistory.push(videoId);
      await user.save();
   }
   return res
            .status(200)
            .json(new ApiResponse(200, "success"));
} catch(err) {
   console.log(err)
}
});

const getProcessingStatus = asyncHandler( async (req, res) => {
   const { videoId } = req.params;
   const video = await Video.findById(videoId).select(
      "processingStatus processingProgress processingError qualities hlsManifestUrl title transcodingJobId"
   );

   if (!video) throw new ApiError(404, "Video not found");

   let jobState = null;
   let jobProgress = null;
   if (video.transcodingJobId) {
      try {
         const job = await transcodingQueue.getJob(video.transcodingJobId);
         if (job) {
            jobState = await job.getState();
            jobProgress = job.progress();
         }
      } catch (err) {
         console.log("Could not fetch live job state:", err.message);
      }
   }

   return res
      .status(200)
      .json(new ApiResponse(200, { video, jobState, jobProgress }, "processing status fetched"));
});

const getStreamUrls = asyncHandler( async (req, res) => {
   const { videoId } = req.params;

   const cached = await cache.get(`stream:${videoId}`);
   if (cached) {
      console.log(`CACHE HIT FOR stream: ${videoId}`);
      return res.status(200).json(new ApiResponse(200, cached, "stream urls fetched"));
   }
   console.log(`CACHE MISS FOR stream: ${videoId}`);
   const video = await Video.findById(videoId).select(
      "qualities hlsManifestUrl videoFile processingStatus"
   );

   if (!video) throw new ApiError(404, "Video not found");
   if (video.processingStatus !== "ready")
      throw new ApiError(422, "Video is not ready for streaming");

   const responseData = {
      hls: video.hlsManifestUrl,
      qualities: {
         "360p": video.qualities?.["360p"],
         "720p": video.qualities?.["720p"],
         "1080p": video.qualities?.["1080p"],
         original: video.qualities?.original,
      },
      fallback: video.videoFile,
   };

   await cache.set(`stream:${videoId}`, responseData, 86400);

   return res.status(200).json(
      new ApiResponse(200, responseData, "stream urls fetched")
   );
});

export {
   getAllVideos,
   getVideoById,
   updateVideo,
   deleteVideo,
   togglePublishStatus,
   initVideoUpload,
   uploadVideoChunk,
   getUploadStatus,
   finishVideoUpload,
   postWatchProgress,
   getProcessingStatus,
   getStreamUrls
};