import multer from 'multer';
import config from '../../config';

// In-memory storage: photos are immediately forwarded to settings-service,
// so they never touch this service's disk.
const storage = multer.memoryStorage();

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export const photoUpload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB per photo
        files: config.sbclove.maxPhotos,
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG and WebP images are allowed.'));
        }
    },
});
