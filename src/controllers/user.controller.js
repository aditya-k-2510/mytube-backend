import {asyncHandler} from "../utils/asyncHandler.js"
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import {ApiResponse} from "../utils/ApiResponse.js"

    // 1. get user details from frontend(or any tool like postman)
    // 2. validation(they are there in frontend as well)
    // 3 .check if user already exists: username or name
    // 4. check for images, check for avatar
    // 5. upload on cloudinary, avatar
    // 6. create user object - create entry in db
    // 7. remove password and refresh token field from response
    // 8. check for user creation
    // 9. return res

const registerUser = asyncHandler( async(req, res)=>{

    //validation for non-empty strings
    const {fullName, email, username, password} = req.body
    if([fullName, email, username, password].some((field)=>field?.trim()==="")) {
        throw new ApiError(400, "All fields are required  ")
    }

    //checking for already existed user
    const existedUser = User.findOne({username})
    if (existedUser) {
        throw new ApiError(409, "user with username already exists")
    }

    //check for images, avatar should be there
    const avatarLocalPath = req.files?.avatar[0]?.path
    const coverImageLocalPath = req.files?.coverImage[0]?.path
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    //upload on cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!avatarURL) {
        throw new ApiError(400, "Avatar file is required")
    }

    //creating entry in database
    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email, 
        password, 
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if (!createdUser) {
        throw new ApiError(500, "something went wrong while registering user")
    }

    return res.status(201).json(new ApiResponse(200, createdUser, "User registered successfully"))
})

export {registerUser} 