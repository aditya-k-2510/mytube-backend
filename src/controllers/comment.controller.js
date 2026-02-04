import mongoose from "mongoose";
import { Comment } from "../models/comment.model.js";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const { isValidObjectId } = mongoose;

const getVideoComments = asyncHandler(async (req, res) => {
   const { videoId } = req.params;
   const { page = 1, limit = 10 } = req.query;
   if (!isValidObjectId(videoId)) throw new ApiError(400, "invalid object id");
   const pageNumber = Number(page);
   const pageLimit = Number(limit);
   const skip = (pageNumber - 1) * pageLimit;
   if (pageNumber < 1 || pageLimit < 1)
      throw new ApiError(400, "incorrect pagination parameters");

   const result = await Comment.aggregate([
      {
         $match: {
            video: new mongoose.Types.ObjectId(videoId),
         },
      },
      {
         $sort: {
            createdAt: -1,
         },
      },
      {
         $facet: {
            comments: [
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
                     pipeline: [
                        {
                           $project: {
                              username: 1,
                              avatar: 1,
                              fullName: 1,
                           },
                        },
                     ],
                  },
               },
               {
                  $unwind: "$owner",
                  // preserveNullAndEmptyArrays: true
               },
            ],
            totalCount: [
               {
                  $count: "total",
               },
            ],
         },
      },
   ]);

   const comments = result[0]?.comments || [];
   const total = result[0]?.totalCount[0]?.total || 0;
   return res.status(200).json(
      new ApiResponse(
         200,
         {
            comments,
            totalComments: total,
            totalPages: Math.ceil(total / pageLimit),
            currentPage: pageNumber,
         },
         "comments fetched successfully"
      )
   );
});

const addComment = asyncHandler(async (req, res) => {
   const { videoId } = req.params;
   const { content } = req.body;
   const trimContent = content.trim();
   const userId = req.user._id;
   if (!isValidObjectId(videoId)) throw new ApiError(400, "invalid object id");

   if (!trimContent) throw new ApiError(400, "content is required");

   if (trimContent.length < 1 || trimContent.length > 100)
      throw new ApiError(400, "Comment must be 1–100 characters");

   const videoExists = await Video.exists({
      _id: videoId,
   });

   if (!videoExists) throw new ApiError(404, "Video not found");

   const comment = await Comment.create({
      content: trimContent,
      video: videoId,
      owner: userId,
   });
   return res
      .status(200)
      .json(new ApiResponse(200, comment, "comment added successfully"));
});

const updateComment = asyncHandler(async (req, res) => {
   const { commentId } = req.params;
   const { content } = req.body;

   const trimContent = content.trim();

   if (!trimContent) throw new ApiError(400, "content is required");
   if (trimContent.length < 1 || trimContent.length > 100)
      throw new ApiError(400, "Comment must be 1–100 characters");

   if (!isValidObjectId(commentId))
      throw new ApiError(400, "invalid object id");

   const comment = await Comment.findById(commentId);

   if (!comment) throw new ApiError(404, "comment not found");
   if (comment.owner.toString() !== req.user._id.toString())
      throw new ApiError(403, "Unauthorized");

   comment.content = trimContent;
   await comment.save();

   return res
      .status(200)
      .json(new ApiResponse(200, comment, "comment updated successfully"));
});

const deleteComment = asyncHandler(async (req, res) => {
   const { commentId } = req.params;
   if (!isValidObjectId(commentId))
      throw new ApiError(400, "invalid object id");
   const comment = await Comment.findById(commentId);
   if (!comment) throw new ApiError(404, "comment not found");
   if (comment.owner.toString() !== req.user._id.toString())
      throw new ApiError(403, "unauthorized request");
   await comment.deleteOne();
   return res
      .status(200)
      .json(new ApiResponse(200, "comment deleted successfully"));
});

export { getVideoComments, addComment, updateComment, deleteComment };
