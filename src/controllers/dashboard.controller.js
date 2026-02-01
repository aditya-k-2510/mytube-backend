import mongoose from "mongoose"
import {Video} from "../models/video.model.js"
import {User} from "../models/user.model.js"
import {Subscription} from "../models/subscription.model.js"
import {Like} from "../models/like.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const getChannelStats = asyncHandler(async (req, res) => {
    const stats = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "_id",
                foreignField: "owner",
                as: "videos"
            }
        },
        {
            $addFields: {
                numberOfSubs: {
                    $size: "$subscribers"
                },
                numberOfVideos: {
                    $size: "$videos"
                }
            }
        },
        {
            $project: {
                numberOfSubs: 1,
                numberOfVideos: 1
            }
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200, stats, "channel stats fetched"))
})

const getChannelVideos = asyncHandler(async (req, res) => {
    const { page = 1 } = req.query;

    const userId = req.user._id     
    const pageNumber = Number(page)
    const pageLimit = 10
    const skip = (pageNumber - 1) * pageLimit
    
    if ( pageNumber < 1 )
        throw new ApiError(400, "Invalid pagination parameters")
        
    const sortField = "createdAt";
    const sortOrder = -1

    const result = await Video.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(userId)
            }
        },
        {
            $sort: {
               [sortField]: sortOrder,
            }
        },
        {
            $facet: {
                videos: [
                    {
                        $skip: skip,
                    },
                    {
                        $limit: pageLimit,
                    }
                ],
                totalCount: [
                    { 
                        $count: "total" 
                    }
                ]
            }
        }
    ])
    
    const videos = result[0].videos
    const totalVideos = result[0].totalCount[0]?.total || 0

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
})

export {
    getChannelStats, 
    getChannelVideos
}