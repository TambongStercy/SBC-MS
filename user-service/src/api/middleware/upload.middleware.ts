import multer from 'multer';
import { AppError } from '../../utils/errors';

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter for images
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new AppError('Not an image! Please upload only images.', 400));
    }
};

// Set up multer options
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2 MB limit
    },
    fileFilter: fileFilter
});

// Export the configured middleware (specifically for single file upload named 'avatar')
export const uploadAvatar = upload.single('avatar'); 