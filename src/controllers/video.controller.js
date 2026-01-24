import mongoose from "mongoose"
import { Video } from "../models/video.model.js"
import { User } from "../models/user.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"


const getAllVideos = asyncHandler( async (req, res) => {
    const { 
            page = 1, 
            limit = 10, 
            query, 
            sortBy, 
            sortType, 
            userId } = req.query
    
    if (userId&&!mongoose.isValidObjectId(userId)) throw new ApiError(400, "Invalid user id");

    const allowedSortFields = ["duration", "createdAt", "views"]
    if (sortBy && !allowedSortFields.includes(sortBy)) throw new ApiError(400, "sortBy field is not allowed")
    
    const pageNumber = Number(page)
    const pageLimit = Number(limit)
    const skip = (pageNumber-1) * pageLimit

    if (pageNumber < 1 || pageLimit < 1) throw new ApiError(400, "Invalid pagination parameters")
        
    const matchStage = {
                ...(userId && {
                    owner: new mongoose.Types.ObjectId(userId)
                }),
                ...(query && {
                    $or :[
                        {
                            title: {
                                $regex: query, 
                                $options: "i"
                            }
                        },
                        {
                            description: {
                                $regex: query, 
                                $options: "i"
                            }
                        }
                    ]
                })
            }

    const sortField = sortBy || "createdAt";
    const sortOrder = sortType === "asc" ? 1 : -1;

    const videos = await Video.aggregate([
        {
            $match: matchStage
        },
        {
            $sort: {
                [sortField]: sortOrder
            }
        },
        {
            $skip: skip
        },
        {
            $limit: pageLimit
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner"
            }
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
            $unwind: "$owner" 
        },
        {
            $addFields: {
                channelName: "$owner.username",
                channelCoverImage: "$owner.coverImage",
                channelAvatar: "$owner.avatar",
                ownerName: "$owner.fullName",
                numberOfLikes: {
                    $size: "$likes"
                }
            }
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
                numberOfLikes: 1
            }
        }
    ])
    const totalVideosAgg = await Video.aggregate([
        { 
            $match: matchStage 
        },
        {      
            $count: "total" 
        }
    ])

    const totalVideos = totalVideosAgg[0]?.total || 0

    return res.status(200)
    .json(new ApiResponse(200, {
        videos, 
        totalVideos, 
        currentPage: pageNumber, 
        totalPages: Math.ceil(totalVideos/pageLimit) 
    }, "videos fetched"))
})

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body
    const videoLocalPath = req.files?.video[0]?.path
    const thumbnailLocalPath = req.files?.thumbnail[0]?.path
    if(!videoLocalPath||!title||!description||!thumbnailLocalPath) throw new ApiError(400, "all fields are required")
    const uploadedVideo = await uploadOnCloudinary(videoLocalPath)
    const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath)

    if(!uploadedVideo||!uploadedThumbnail) throw new ApiError(500, "couldn't upload file/s on cloudinary")
    const video = await Video.create({
        videoFile: uploadedVideo.url, 
        thumbnail: uploadedThumbnail.url, 
        title, 
        description,
        duration: uploadedVideo.duration, 
        owner: req.user._id
    })  

    return res
    .status(201)
    .json(new ApiResponse(201, {
        video
    }, "video uploaded successfully"))
})


export {
    getAllVideos,
    publishAVideo
}