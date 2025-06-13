import multer from 'multer';
import { Request } from 'express';
import { AppError } from '../../utils/errors'; // Assuming you have AppError
import logger from '../../utils/logger';

const log = logger.getLogger('UploadMiddleware');

// Define allowed MIME types for product images
const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Configure storage (memory storage is suitable for proxying to another service)
const storage = multer.memoryStorage();

// Configure file filter
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (allowedMimes.includes(file.mimetype)) {
        log.debug(`File filter allowed: ${file.originalname} (${file.mimetype})`);
        cb(null, true);
    } else {
        log.warn(`File filter rejected: ${file.originalname} (${file.mimetype}) - Invalid type`);
        cb(new AppError('Invalid file type. Only JPEG, PNG, GIF, WebP images are allowed.', 400));
    }
};

// Configure limits (e.g., 20MB per image, max 10 files)
const limits = {
    fileSize: 20 * 1024 * 1024, // 20 MB
    files: 10,                 // Max 10 files
};

// Create Multer instance
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: limits,
});

export { upload }; 