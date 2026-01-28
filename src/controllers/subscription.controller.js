import mongoose from "mongoose"
import {User} from "../models/user.model.js"
import { Subscription } from "../models/subscription.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"


const { isValidObjectId } = mongoose


const toggleSubscription = asyncHandler(async (req, res) => {
    const {channelId} = req.params
    if(!isValidObjectId(channelId)) throw new ApiError(400, "invalid object id")
    if (channelId === req.user._id.toString()) throw new ApiError(400, "cannot subscribe to yourself")
    const user = await User.findById(channelId)
    if(!user) throw new ApiError(404, "channel not found")
    const subscription = await Subscription.findOne(
        {
            channel: channelId, 
            subscriber: req.user._id
        }
    )
    if(!subscription) {
        const subscription = await Subscription.create(
        {
            channel: channelId,
            subscriber: req.user._id
        })

        return res
        .status(200)
        .json(new ApiResponse(200, subscription, "channel subscribed succesfully"))
    }
    await subscription.deleteOne()
    return res
    .status(200)
    .json(new ApiResponse(200, "channel unsubscribed succesfully"))
})

const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    const {channelId} = req.params
    if(!isValidObjectId(channelId)) throw new ApiError(400, "invalid object id")
    if(channelId!=req.user._id.toString()) throw new ApiError(403, "unauthorized request")
    const subscribers = await Subscription.aggregate([
        {
            $match: {
                channel: new mongoose.Types.ObjectId(channelId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriber",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            avatar: 1,
                            fullName: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: "$subscriber" 
        },
        {
            $project: {
                _id: 0,
                subscriber: 1
            }
        },
        { 
            $replaceRoot: { 
                newRoot: "$subscriber" 
            } 
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200, subscribers, "subscribers fetched"))
})

const getSubscribedChannels = asyncHandler(async (req, res) => {
    const { subscriberId } = req.params
    if(!isValidObjectId(subscriberId)) throw new ApiError(400, "invalid object id")
    if(subscriberId!=req.user._id.toString()) throw new ApiError(403, "unauthorized request")
    const channel = await Subscription.aggregate([
        {
            $match: {
                subscriber: new mongoose.Types.ObjectId(subscriberId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "channel",
                foreignField: "_id",
                as: "channel",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            avatar: 1,
                            fullName: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: "$channel" 
        },
        {
            $project: {
                _id: 0,
                channel: 1
            }
        },
        { 
            $replaceRoot: { 
                newRoot: "$channel" 
            } 
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200, channel, "channel subscribed to fetched successfully"))
})

export {
    toggleSubscription,
    getUserChannelSubscribers,
    getSubscribedChannels
}