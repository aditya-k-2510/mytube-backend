import mongoose from "mongoose"
import {DB_NAME} from "./constants.js"
import connectDB from './db/index.js'
import dotenv from "dotenv"

dotenv.config({path:'./.env'})
connectDB()

/*
import express from "express"
const app = express()
;(async ()=>{
    try {
        await mongoose.connect(`${process.env.MONGODB_URL}/${DB_NAME}`)
        app.on("error", (error)=>{//if error in express app in listening
            console.log("ERROR: ", error)
            throw error
        })  
        app.listen(process.env.PORT||3000, ()=>{
            console.log(`app listening on ${process.env.PORT}`)
        })
    }
    catch(error) {
        console.error("ERROR: ", error)
        throw error
    }               
})()


---not a good practice
*/