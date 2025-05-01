import multer from 'multer';
import { Request } from 'express';
import { BadRequestError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('MulterConfig');

// Configure Multer storage (MemoryStorage is simple for now)
// For production, consider disk storage or direct cloud upload (e.g., multer-s3)
const storage = multer.memoryStorage();

// Expanded file filter function - allow images and common documents
// Consider security implications - restrict further if possible
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimes = [
        // Images
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        // Documents
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.ms-excel', // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-powerpoint', // .ppt
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
        'text/plain', // .txt
        'text/csv',   // .csv
        // Videos (Added)
        'video/mp4',
        'video/mpeg',
        'video/ogg',
        'video/webm',
        'video/quicktime', // .mov
        'video/x-msvideo', // .avi
        // Add other types as needed
    ];

    if (allowedMimes.includes(file.mimetype)) {
        log.debug(`Accepting file upload: ${file.originalname} (${file.mimetype})`);
        cb(null, true);
    } else {
        log.warn(`Rejected file upload: ${file.originalname} (${file.mimetype}) - Invalid or disallowed type`);
        // Pass an error to Multer
        cb(new BadRequestError(`Invalid file type. Allowed types include images, PDF, Office documents, text, CSV.`));
    }
};

// Multer upload instance
export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 50, // Increased limit to 50MB
    },
    fileFilter: fileFilter,
}); 