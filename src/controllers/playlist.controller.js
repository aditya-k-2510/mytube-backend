import mongoose from "mongoose";
import { Playlist } from "../models/playlist.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const { isValidObjectId } = mongoose;

const createPlaylist = asyncHandler(async (req, res) => {
   const { name, description } = req.body;
   if (!name || !description)
      throw new ApiError(400, "all fields are required");
   const _name = name.trim().toLowerCase();
   const _description = description.trim();
   if (_description.length > 50)
      throw new ApiError(400, "description should be less than 50 characters");
   if (_name.length > 15)
      throw new ApiError(400, "name should be less than 15 characters");
   if (!_name.length || !_description.length)
      throw new ApiError(400, "name and description cannot be blank spaces");
   try {
      const playlist = await Playlist.create({
         name: _name,
         description: _description,
         owner: req.user._id,
      });
      return res
         .status(201)
         .json(new ApiResponse(201, playlist, "playlist created successfully"));
   } catch (err) {
      if (err.code === 11000)
         throw new ApiError(400, "playlist already exists");
      throw err;
   }
});

const getUserPlaylists = asyncHandler(async (req, res) => {
   const { userId } = req.params;
   if (!isValidObjectId(userId)) throw new ApiError(400, "invalid user id");
   const ownerId = new mongoose.Types.ObjectId(userId);
   const playlists = await Playlist.aggregate([
      {
         $match: {
            owner: ownerId,
            public: true,
         },
      },
      {
         $addFields: {
            videoCount: {
               $size: "$videos",
            },
         },
      },
      {
         $project: {
            videos: 1,
            name: 1,
            description: 1,
            videoCount: 1,
         },
      },
   ]);
   if (!playlists.length) throw new ApiError(404, "no public playlists found");
   return res
      .status(200)
      .json(new ApiResponse(200, playlists, "playlists fetched successfully"));
});

const getPlaylistById = asyncHandler(async (req, res) => {
   const { playlistId } = req.params;
   if (!isValidObjectId(playlistId))
      throw new ApiError(400, "invalid playlist id");
   const playlist = await Playlist.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(playlistId),
         },
      },
      {
         $lookup: {
            from: "videos",
            localField: "videos",
            foreignField: "_id",
            as: "videos",
            pipeline: [
               {
                  $project: {
                     title: 1,
                     views: 1,
                     thumbnail: 1,
                     duration: 1,
                  },
               },
            ],
         },
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
         $unwind: "$owner",
      },
   ]);
   if (playlist.length === 0) throw new ApiError(404, "playlist not found");
   return res
      .status(200)
      .json(
         new ApiResponse(200, playlist[0], "playlist fetched succcessfully")
      );
});

const addVideoToPlaylist = asyncHandler(async (req, res) => {
   const { playlistId, videoId } = req.params;
   if (!isValidObjectId(playlistId) || !isValidObjectId(videoId))
      throw new ApiError(400, "invalid playlist/video id");
   const playlist = await Playlist.findById(playlistId);
   if (!playlist) throw new ApiError(404, "playlist not found");
   if (playlist.owner.toString() != req.user._id.toString())
      throw new ApiError(403, "unauthorized request");
   if (playlist.videos.includes(videoId))
      throw new ApiError(400, "Video already in playlist");
   playlist.videos.push(videoId);
   await playlist.save();
   return res
      .status(200)
      .json(new ApiResponse(200, playlist, "video added successfully"));
});

const removeVideoFromPlaylist = asyncHandler(async (req, res) => {
   const { playlistId, videoId } = req.params;
   if (!isValidObjectId(playlistId) || !isValidObjectId(videoId))
      throw new ApiError(400, "invalid playlist/video id");
   const playlist = await Playlist.findById(playlistId);
   if (!playlist) throw new ApiError(404, "playlist not found");
   if (playlist.owner.toString() != req.user._id.toString())
      throw new ApiError(403, "unauthorized request");
   if (!playlist.videos.includes(videoId))
      throw new ApiError(400, "Video not present the playlist");
   const updatedPlaylist = await Playlist.findByIdAndUpdate(
      playlistId,
      {
         $pull: {
            videos: videoId,
         },
      },
      {
         new: true,
      }
   );
   return res
      .status(200)
      .json(
         new ApiResponse(200, updatedPlaylist, "video removed successfully")
      );
});

const deletePlaylist = asyncHandler(async (req, res) => {
   const { playlistId } = req.params;
   if (!isValidObjectId(playlistId))
      throw new ApiError(400, "invalid playlist id");
   const playlist = await Playlist.findOneAndDelete({
      _id: playlistId,
      owner: req.user._id,
   });
   if (!playlist) throw new ApiError(404, "Playlist not found or unauthorized");
   return res
      .status(200)
      .json(new ApiResponse(200, "playlist deleted successfully"));
});

const updatePlaylist = asyncHandler(async (req, res) => {
   const { playlistId } = req.params;
   const { name, description } = req.body;
   if (!name || !description)
      throw new ApiError(400, "all fields are required");
   if (!isValidObjectId(playlistId))
      throw new ApiError(400, "invalid playlist id");
   const playlist = await Playlist.findById(playlistId);
   if (!playlist) throw new ApiError(404, "playlist not found");
   if (playlist.owner.toString() != req.user._id.toString())
      throw new ApiError(403, "unauthorized request");
   playlist.name = name;
   playlist.description = description;
   await playlist.save();
   return res
      .status(200)
      .json(new ApiResponse(200, playlist, "playlist updated successfully"));
});

export {
   createPlaylist,
   getUserPlaylists,
   getPlaylistById,
   addVideoToPlaylist,
   removeVideoFromPlaylist,
   deletePlaylist,
   updatePlaylist,
};
