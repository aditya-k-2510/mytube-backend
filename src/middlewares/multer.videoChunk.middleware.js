import fs from "fs";
import multer from "multer";

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        const { fileId } = req.params
        const dir = `./public/temp/chunkUploads/${fileId}`;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const { chunkIndex } = req.body;
        cb(null, chunkIndex); 
    }
});

export const uploadChunk = multer({ storage });