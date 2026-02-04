import mongoose from "mongoose";
import { Tweet } from "../models/tweet.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const createTweet = asyncHandler(async (req, res) => {
   const { content } = req.body;
   if (!content) throw new ApiError(400, "content is required");
   const tweet = await Tweet.create({
      content: content.trim(),
      owner: req.user._id,
   });

   return res
      .status(201)
      .json(new ApiResponse(201, tweet, "tweet created successfully"));
});

const getUserTweets = asyncHandler(async (req, res) => {
   const { userId } = req.params;
   const { page = 1, limit = 5, sortBy, sortType } = req.query;
   if (!userId) throw new ApiError(400, "user id is required");
   if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(400, "Invalid user id");
   }
   const allowedSortFields = ["createdAt", "views"];

   if (sortBy && !allowedSortFields.includes(sortBy))
      throw new ApiError(400, "sortBy field is not allowed");

   const pageNumber = Number(page);
   const pageLimit = Math.min(Number(limit), 20);
   const skip = (pageNumber - 1) * pageLimit;
   if (pageNumber < 1 || pageLimit < 1)
      throw new ApiError(400, "Invalid pagination parameters");
   const sortField = sortBy || "createdAt";
   const sortOrder = sortType === "asc" ? 1 : -1;

   const tweets = await User.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(userId),
         },
      },
      {
         $lookup: {
            from: "tweets",
            localField: "_id",
            foreignField: "owner",
            as: "tweets",
            pipeline: [
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
                  $project: {
                     content: 1,
                     createdAt: 1,
                  },
               },
            ],
         },
      },
      {
         $project: {
            fullName: 1,
            username: 1,
            avatar: 1,
            tweets: 1,
         },
      },
   ]);

   if (!tweets.length) throw new ApiError(404, "no such user exists");
   const totalTweets = await Tweet.countDocuments({
      owner: userId,
   });
   return res.status(200).json(
      new ApiResponse(
         200,
         {
            user: tweets[0],
            pagination: {
               total: totalTweets,
               page: pageNumber,
               limit: pageLimit,
               totalPages: Math.ceil(totalTweets / pageLimit),
            },
         },
         "tweets fetched successfully"
      )
   );
});

const updateTweet = asyncHandler(async (req, res) => {
   const { tweetId } = req.params;
   const { content } = req.body;

   if (!content || typeof content !== "string" || !content.trim()) {
      throw new ApiError(403, "you are not allowed to edit the tweet");
   }

   if (content.length > 100) {
      throw new ApiError(400, "Tweet cannot exceed 100 characters");
   }

   const tweet = await Tweet.findById(tweetId);
   if (!tweet) throw new ApiError(404, "tweet not found");
   if (!tweet.owner.equals(req.user._id))
      throw new ApiError(401, "unauthorized request");
   tweet.content = content.trim();
   await tweet.save();

   return res
      .status(200)
      .json(new ApiResponse(200, tweet, "tweet updated successfully"));
});

const deleteTweet = asyncHandler(async (req, res) => {
   const { tweetId } = req.params;

   const tweet = await Tweet.findById(tweetId);

   if (!tweet) throw new ApiError(404, "tweet not found");

   if (!tweet.owner.equals(req.user._id))
      throw new ApiError(403, "you are not allowed to delete this tweet");
   await tweet.deleteOne();

   return res
      .status(200)
      .json(new ApiResponse(200, "tweet deleted successfully"));
});

export { createTweet, getUserTweets, updateTweet, deleteTweet };
