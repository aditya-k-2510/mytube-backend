import mongoose from "mongoose"
import { Like } from "../models/like.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const { isValidObjectId } = mongoose

const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params

    if(!videoId) throw new ApiError(400, "video id required")

    if(!isValidObjectId(videoId)) throw new ApiError(400, "invalid object id")

    const userId= req.user._id

    const deletedLike = await Like.findOneAndDelete({
        video: videoId,
        likedBy: userId
    })
    if(deletedLike) {
        return res
        .status(200)
        .json(new ApiResponse(200, "video unliked successfully"))
    }
    
    const like = await Like.create({
        video: videoId,
        likedBy: userId
    })
    
    return res
    .status(200)
    .json(new ApiResponse(200, like, "video liked successfully"))
})

const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params
    if(!commentId) throw new ApiError(400, "comment id required")

    if(!isValidObjectId(commentId)) throw new ApiError(400, "invalid object id")

    const userId = req.user._id

    const deletedLike = await Like.findOneAndDelete({
        comment: commentId,
        likedBy: userId
    })
    if(deletedLike) {
        return res
        .status(200)
        .json(new ApiResponse(200, "comment unliked successfully"))
    }
    
    const like = await Like.create({
        comment: commentId,
        likedBy: userId
    })
    
    return res
    .status(200)
    .json(new ApiResponse(200, like, "comment liked successfully"))
})

const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params
    
    if(!tweetId) throw new ApiError(400, "tweet id required")

    if(!isValidObjectId(tweetId)) throw new ApiError(400, "invalid object id")

    const userId = req.user._id

    const deletedLike = await Like.findOneAndDelete({
        tweet: tweetId,
        likedBy: userId
    })
    if(deletedLike) {
        return res
        .status(200)
        .json(new ApiResponse(200, "tweet unliked successfully"))
    }
    
    const like = await Like.create({
        tweet: tweetId,
        likedBy: userId
    })
    
    return res
    .status(200)
    .json(new ApiResponse(200, like, "tweet liked successfully"))
})

const getLikedVideos = asyncHandler(async (req, res) => {
    const { page = 1 } = req.query
    const pageNumber = Number(page)
    const pageLimit = 10
    const skip = (pageNumber - 1) * pageLimit

    if ( pageNumber < 1 )
        throw new ApiError(400, "Invalid pagination parameters")

    const userId = req.user._id
    const result = await Like.aggregate([
        {
            $match: {
                likedBy: new mongoose.Types.ObjectId(userId),
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "video",
            }
        },
        { 
            $unwind: "$video" 
        },
        {
            $facet: {
                videos: [
                    { 
                        $sort: { 
                            "video.createdAt": -1 
                        } 
                    },
                    { 
                        $skip: skip 
                    },
                    { 
                        $limit: pageLimit 
                    },
                    { $replaceRoot: { newRoot: "$video" } }
                ],
                totalCount: [
                    { 
                        $count: "total" 
                    }
                ]
            }
        }
    ])
    const videos = result[0]?.videos
    const total = result[0]?.totalCount[0]?.total || 0
    return res
    .status(200)
    .json(new ApiResponse(
        200, 
        {
            videos,
            totalVideos: total,
            totalPages: Math.ceil(total / pageLimit),
            currentPage: pageNumber
        }, "liked videos fetched successfully"
    ))
})

export {
    toggleCommentLike,
    toggleTweetLike,
    toggleVideoLike,
    getLikedVideos
}