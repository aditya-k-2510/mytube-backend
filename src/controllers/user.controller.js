import {asyncHandler} from "../utils/asyncHandler.js"
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.models.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import {ApiResponse} from "../utils/ApiResponse.js"


const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })
        return {accessToken, refreshToken}
    }
    catch(error) {
        throw new ApiError(500, "Something went wrong while generating refersh and access token")
    }
}

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

const registerUser = asyncHandler( async(req, res)=>{

    //validation for non-empty strings
    const {fullName, email, username, password} = req.body
    if([fullName, email, username, password].some((field)=>field?.trim()==="")) {
        throw new ApiError(400, "All fields are required  ")
    }

    //checking for already existed user
    const existedUser = await User.findOne({username})
    if (existedUser) {
        throw new ApiError(409, "user with username already exists")
    }

    //check for images, avatar should be there
    const avatarLocalPath = req.files?.avatar[0]?.path
    const coverImageLocalPath = req.files?.coverImage[0]?.path
    // console.log(avatarLocalPath)
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    //upload on cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    // console.log(req.files)
    if (!avatar) {
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


    // STEPS FOR LOGGING USER IN

    // 1. get user details
    // 2. check for empty fields
    // 3. check if the user is registered and password
    // 4. access, refresh token
    // 5. send cookie

const loginUser = asyncHandler(async(req, res) => {
    const {username, password} = req.body

    if(username=="") throw new ApiError(400, "username is required")
    else if(password=="") throw new ApiError(400, "password is required")
    
    const user = await User.findOne({username})
    if(!user) throw new ApiError(400, "couldn't find such user")
    
    const isPasswordValid = await User.findOne({username})
    if(isPasswordValid) throw new ApiError(401, "incorrect password")
    
    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id)
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")
    const options = {
        httpOnly : true, 
        secure: true
    }
    return res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(200, {
            user: loggedInUser, accessToken, refreshToken
        }, "user logged in successfully")
    )
}) 

const logoutUser = asyncHandler(async(req, res) => {
    User.findByIDAndUpdate(req.user._id, {
        $set: {
            refreshToken: undefined
        }
    }, {
        new: true
    })
    const options = {
        httpOnly : true, 
        secure: true
    }
    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCooker("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"))
})


export {
    registerUser,
    loginUser,
    logoutUser
} 