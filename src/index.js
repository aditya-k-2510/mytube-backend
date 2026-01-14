import connectDB from './db/index.js'
import dotenv from "dotenv"
import {app} from "./app.js"
dotenv.config({path:'./.env'})


connectDB()
.then( () => {
    app.on("error", (error) => {
        console.log("ERROR:" , error)
        throw error
    })

    app.listen(process.env.PORT||3000, () => {
        console.log(`server is running at port ${process.env.PORT||3000}`)
    })
})
.catch( (error) => {
    console.log("MONDO db connection failed", error)
})