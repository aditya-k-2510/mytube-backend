import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshToken = async (userId) => {
   try {
      const user = await User.findById(userId);
      const accessToken = user.generateAccessToken();
      const refreshToken = user.generateRefreshToken();
      user.refreshToken = refreshToken;
      await user.save({ validateBeforeSave: false });
      return { accessToken, refreshToken };
   } catch (error) {
      throw new ApiError(
         500,
         error.message ||
            "Something went wrong while generating refersh and access token"
      );
   }
};

// STEPS FOR USER REGISTRATION:

// 1. get user details from frontend(or any tool like postman)
// 2. validation(they are there in frontend as well)
// 3. check if user already exists: username or name
// 4. check for images, check for avatar
// 5. upload on cloudinary, avatar
// 6. create user object - create entry in db
// 7. remove password and refresh token field from response
// 8. check for user creation
// 9. return res

const registerUser = asyncHandler(async (req, res) => {
   //validation for non-empty strings
   const { fullName, email, username, password } = req.body;
   if (
      [fullName, email, username, password].some(
         (field) => field?.trim() === ""
      )
   ) {
      throw new ApiError(400, "All fields are required");
   }

   //checking for already existed user with the provided username
   const existedUserWithTheGivenUsername = await User.findOne({ username });
   if (existedUserWithTheGivenUsername) {
      throw new ApiError(409, "user with username already exists");
   }

   const existedUserWithTheGivenEmailId = await User.findOne({ email });
   if (existedUserWithTheGivenEmailId) {
      throw new ApiError(409, "user with email already exists");
   }
   
   //check for images, avatar should be there
   const avatarLocalPath = req.files?.avatar[0]?.path;
   const coverImageLocalPath = req.files?.coverImage[0]?.path;

   // console.log(avatarLocalPath)
   if (!avatarLocalPath) {
      throw new ApiError(400, "Avatar file is required");
   }

   //upload on cloudinary
   const avatar = await uploadOnCloudinary(avatarLocalPath);
   const coverImage = await uploadOnCloudinary(coverImageLocalPath);
   // console.log(req.files)
   if (!avatar) {
      throw new ApiError(400, "error in uploading to cloudinary");
   }

   //creating entry in database
   const user = await User.create({
      fullName,
      avatar: avatar.url,
      coverImage: coverImage?.url || "",
      email,
      password,
      username: username.toLowerCase(),
   });

   const createdUser = await User.findById(user._id).select(
      "-password -refreshToken"
   );

   if (!createdUser) {
      throw new ApiError(500, "something went wrong while registering user");
   }

   return res
      .status(201)
      .json(new ApiResponse(200, createdUser, "User registered successfully"));
});

// STEPS FOR LOGGING USER IN

// 1. get user details
// 2. check for empty fields
// 3. check if the user is registered and password
// 4. access, refresh token
// 5. send cookie

const loginUser = asyncHandler(async (req, res) => {
   const { username, password } = req.body;

   if (username == "") throw new ApiError(400, "username is required");
   else if (password == "") throw new ApiError(400, "password is required");

   const user = await User.findOne({ username });
   if (!user) throw new ApiError(400, "couldn't find such user");

   const isPasswordValid = await user.isPasswordCorrect(password);
   if (!isPasswordValid) throw new ApiError(401, "incorrect password");

   const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
      user._id
   );
   const loggedInUser = await User.findById(user._id).select(
      "-password -refreshToken"
   );
   const options = {
      httpOnly: true,
      secure: true,
   };
   return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(
         new ApiResponse(
            200,
            {
               user: loggedInUser,
               accessToken,
            },
            "user logged in successfully"
         )
      );
});

const logoutUser = asyncHandler(async (req, res) => {
   await User.findByIdAndUpdate(
      req.user._id,
      {
         $unset: {
            refreshToken: 1,
         },
      },
      {
         new: true,
      }
   );
   const options = {
      httpOnly: true,
      secure: true,
   };
   return res
      .status(200)
      .clearCookie("accessToken", options)
      .clearCookie("refreshToken", options)
      .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshUser = asyncHandler(async (req, res) => {
   try {
      const incomingRefreshToken =
         req.cookies.refreshToken || req.body.refreshToken;
      if (!incomingRefreshToken) {
         throw new ApiError(401, "unauthorized request");
      }

      const decodedToken = jwt.verify(
         incomingRefreshToken,
         process.env.REFRESH_TOKEN_SECRET
      );
      const user = await User.findById(decodedToken?._id);

      if (!user) throw new ApiError(401, "invalid refresh token");
      if (incomingRefreshToken != user?.refreshToken) {
         throw new ApiError(401, "Refresh token is expired or used");
      }

      const options = {
         httpOnly: true,
         secure: true,
      };

      const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
         user._id
      );
      return res
         .status(200)
         .cookie("accessToken", accessToken, options)
         .cookie("refreshToken", refreshToken, options)
         .json(
            new ApiResponse(
               200,
               { accessToken, refreshToken },
               "Access Token refreshed"
            )
         );
   } catch (error) {
      throw new ApiError(401, error?.message || "invalid refresh token");
   }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
   const { newPassword, oldPassword } = req.body;
   const user = await User.findById(req.user?._id);
   const isCorrect = await user.isPasswordCorrect(oldPassword);
   if (!isCorrect)
      throw new ApiError(400, "invalid old password");
   user.password = newPassword;
   await user.save({ validateBeforeSave: true });
   return res
      .status(200)
      .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
   return res
      .status(200)
      .json(
         new ApiResponse(200, req.user, "current user fetched successfully")
      );
});

const updateAccountDetails = asyncHandler(async (req, res) => {
   const { fullName, email } = req.body;
   if (!fullName || !email) {
      throw new ApiError(400, "All fields are required");
   }
   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            fullName: fullName, // or only fullName as both name are same
            email: email,
         },
      },
      { new: true }
   ).select("-password -refreshToken");

   res.status(200).json(
      new ApiResponse(200, user, "Account updated successfully")
   );
});

const updateUserAvatar = asyncHandler(async (req, res) => {
   const avatarLocalPath = req.file?.path;

   if (!avatarLocalPath) throw new ApiError(400, "file is required");

   const avatar = await uploadOnCloudinary(avatarLocalPath);

   if (!avatar.url) throw new ApiError(400, "error while uploading");

   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            avatar: avatar.url,
         },
      },
      { new: true }
   ).select("-password -refreshToken");

   res.status(200).json(new ApiResponse(200, user, "avatar updated"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
   const coverImageLocalPath = req.file?.path;

   if (!coverImageLocalPath) throw new ApiError(400, "file is required");

   const coverImage = await uploadOnCloudinary(coverImageLocalPath);
   if (!coverImage.url) throw new ApiError(400, "error while uploading");
   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            coverImage: coverImage.url,
         },
      },
      { new: true }
   ).select("-password -refreshToken");

   res.status(200).json(new ApiResponse(200, user, "cover image updated"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
   const { username } = req.params;
   if (!username?.trim()) {
      throw new ApiError(400, "username is missing");
   }
   const channel = await User.aggregate([
      {
         $match: {
            username: username?.toLowerCase(),
         },
      },
      {
         $lookup: {
            from: "subscriptions",
            localField: "_id",
            foreignField: "channel",
            as: "subscribers",
         },
      },
      {
         $lookup: {
            from: "subscriptions",
            localField: "_id",
            foreignField: "subscriber",
            as: "subscribedTo",
         },
      },
      {
         $addFields: {
            subscriberCount: {
               $size: "$subscribers",
            },
            channelSubscribedToCount: {
               $size: "$subscribedTo",
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
            fullName: 1,
            username: 1,
            subscriberCount: 1,
            channelSubscribedToCount: 1,
            coverImage: 1,
            avatar: 1,
            isSubscribed: 1,
         },
      },
   ]);

   if (!channel?.length) {
      throw new ApiError(400, "channel does not exists");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, channel[0], "channel fetched succesfully"));
});

const getWatchHistory = asyncHandler(async (req, res) => {
   const user = await User.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(req.user?._id), // aggregation code goes directly without mongoose
         },
      },
      {
         $lookup: {
            from: "videos",
            localField: "watchHistory",
            foreignField: "_id",
            as: "watchHistory",
            pipeline: [
               {
                  $match: {
                     isPublished: true, 
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
                           $project: {
                              fullName: 1,
                              username: 1,
                              avatar: 1,
                           },
                        },
                     ],
                  },
               },
               {
                  $match: {
                     owner: {
                        $ne: []
                     }
                  }
               },
               {
                  $addFields: {
                     owner: {
                        $first: "$owner",
                     },
                  },
               },
               {
                  $project: {
                     owner: 1,
                     thumbnail: 1,
                     title: 1,
                     _id: 1,
                     description: 1,
                     duration: 1,
                     views: 1
                  }
               }
            ],
         },
      },
   ]);

   if (!user.length) {
      throw new ApiError(404, "User not found");
   }
   return res
      .status(200)
      .json(
         new ApiResponse(200, user[0].watchHistory, "watch history fetched")
      );
});

export {
   registerUser,
   loginUser,
   logoutUser,
   refreshUser,
   changeCurrentPassword,
   getCurrentUser,
   updateAccountDetails,
   updateUserAvatar,
   updateUserCoverImage,
   getUserChannelProfile,
   getWatchHistory,
};
