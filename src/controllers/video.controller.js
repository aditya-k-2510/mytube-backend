import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { 
         uploadOnCloudinary,
         deleteFromCloudinary
      } from "../utils/cloudinary.js";

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
         owner: new mongoose.Types.ObjectId(userId)
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
            videoFile: 1,
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

const publishAVideo = asyncHandler( async (req, res) => {
   const { title, description } = req.body;
   const videoLocalPath = req.files?.video[0]?.path;
   const thumbnailLocalPath = req.files?.thumbnail[0]?.path;
   if (!videoLocalPath || !title || !description || !thumbnailLocalPath)
      throw new ApiError(400, "all fields are required");
   const uploadedVideo = await uploadOnCloudinary(videoLocalPath);
   const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);

   if (!uploadedVideo || !uploadedThumbnail)
      throw new ApiError(500, "couldn't upload file/s on cloudinary");

   const video = await Video.create({
      videoFile: uploadedVideo.url,
      thumbnail: uploadedThumbnail.url,
      title,
      description,
      duration: uploadedVideo.duration,
      owner: req.user._id,
   });

   return res.status(201).json(
      new ApiResponse(
         201,
         {
            video,
         },
         "video uploaded successfully"
      )
   );
});

const getVideoById = asyncHandler( async (req, res) => {
   const { videoId } = req.params;

   const video = await Video.aggregate([
      {
         $match: {   
            _id: new mongoose.Types.ObjectId(videoId)
         }
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
                  }
               },
               {
                  $addFields: {
                     subscriberCount:{
                        $size: "$subscribers"
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
                        }
                     }
                  }
               },
               {
                  $project: {
                        username: 1,
                        avatar: 1,
                        subscriberCount: 1,
                        isSubscribed: 1
                     }
               }
            ]
         }
      },
      {
         $addFields: {
            owner: { 
               $first: "$owner" 
            },
         },
      },
      {
         $lookup: {
            from: "likes",
            localField: "_id",
            foreignField: "video",
            as: "likes"
         }
      },
      {
         $addFields: {
            likesCount: {
               $size: "$likes"
            }
         }
      },
      {
         $project: {
            owner: 1,
            likesCount: 1,
            thumbnail: 1,
            videoFile: 1,
            title: 1,
            description: 1, 
            duration: 1,
            views: 1,
            isPublished: 1
         }
      }
   ])

   if(video.length==0) throw new ApiError(404, "Video not found")

   return res
      .status(200)
      .json(new ApiResponse(200, video[0], "video fetched successfully"));
});

const updateVideo = asyncHandler( async (req, res) => {
   const { videoId } = req.params
   const video = await Video.findById(videoId)
   if(!video) throw new ApiError(404, "video not found")
   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request")
   }
   
   const { title, description } = req.body
   
   const thumbnailLocalPath = req.file?.path
   const updatedDetails = {}
   if(title) updatedDetails.title = title

   if(description) updatedDetails.description = description

   if(thumbnailLocalPath) {
      const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)
      if(!thumbnail) throw new ApiError(500, "error in uploading to cloudinary")
      updatedDetails.thumbnail = thumbnail.url
   }

   if(!title&&!description&&!thumbnailLocalPath) throw new ApiError(400, "atleast one field is required")
   const updatedVideo = await  Video.findByIdAndUpdate(
      videoId, 
      {
         $set: updatedDetails
      },
      {
         new: true
      }
   )
   return res
   .status(200)
   .json(new ApiResponse(200, updatedVideo, "video updated successfully"))
})

const deleteVideo = asyncHandler( async (req, res) => {

   const { videoId } = req.params
   const video = await Video.findById(videoId)

   if (!video) throw new ApiError(404, "Video not found")

   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request")
   }

   try {
      if (video.thumbnail) await deleteFromCloudinary(video.thumbnail)
   } catch (err) {
      console.log("Cloudinary delete failed:", err.message)
   }
   try {
      if (video.videoFile) await deleteFromCloudinary(video.videoFile)
   } catch (err) {
      console.log("Cloudinary delete failed:", err.message)
   }
      
   await video.deleteOne()

   return res
      .status(200)
      .json(new ApiResponse(200, null, "Video deleted successfully"))
})

const togglePublishStatus = asyncHandler( async (req, res) => {
   const { videoId } = req.params
   const video = await Video.findById(videoId)

   if(!video) throw new ApiError(404, "video not found")
   
   if (!video.owner.equals(req.user._id)) {
      throw new ApiError(401, "Unauthorized request")
   }
   video.isPublished = !video.isPublished
   await video.save()

   return res
   .status(200)
   .json(new ApiResponse(200, video, "publish status changed"))
})

export { 
         getAllVideos, 
         publishAVideo, 
         getVideoById,
         updateVideo,
         deleteVideo,
         togglePublishStatus
};
