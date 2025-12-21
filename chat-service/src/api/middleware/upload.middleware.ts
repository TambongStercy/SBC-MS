import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import path from 'path';
import logger from '../../utils/logger';

const log = logger.getLogger('UploadMiddleware');

// Document types allowed for chat
const ALLOWED_DOCUMENT_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
];

const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'];

// Media types allowed for status
const ALLOWED_MEDIA_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
];

const ALLOWED_MEDIA_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];

// File size limits
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

// Memory storage (files will be passed to cloud storage)
const storage = multer.memoryStorage();

// Document filter for chat
const documentFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
): void => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (
        ALLOWED_DOCUMENT_TYPES.includes(file.mimetype) &&
        ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)
    ) {
        cb(null, true);
    } else {
        log.warn(`Rejected document upload: ${file.originalname} (${file.mimetype})`);
        cb(new Error('Invalid document type. Allowed: PDF, DOC, DOCX, XLS, XLSX, TXT, CSV'));
    }
};

// Media filter for status
const mediaFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
): void => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (
        ALLOWED_MEDIA_TYPES.includes(file.mimetype) &&
        ALLOWED_MEDIA_EXTENSIONS.includes(ext)
    ) {
        cb(null, true);
    } else {
        log.warn(`Rejected media upload: ${file.originalname} (${file.mimetype})`);
        cb(new Error('Invalid media type. Allowed: JPG, PNG, GIF, WEBP, MP4, WEBM, MOV'));
    }
};

// Document upload for chat (max 10MB)
export const uploadDocument = multer({
    storage,
    fileFilter: documentFilter,
    limits: {
        fileSize: MAX_DOCUMENT_SIZE
    }
});

// Media upload for status (images max 5MB, videos max 50MB)
export const uploadMedia = multer({
    storage,
    fileFilter: mediaFilter,
    limits: {
        fileSize: MAX_VIDEO_SIZE // Use largest limit, validate per type in controller
    }
});

// Helper to check if file is video
export const isVideo = (mimetype: string): boolean => {
    return mimetype.startsWith('video/');
};

// Helper to check if file is image
export const isImage = (mimetype: string): boolean => {
    return mimetype.startsWith('image/');
};

// Helper to validate file size based on type
export const validateFileSize = (file: Express.Multer.File): { valid: boolean; error?: string } => {
    if (isVideo(file.mimetype)) {
        if (file.size > MAX_VIDEO_SIZE) {
            return {
                valid: false,
                error: `Video file too large. Maximum size: ${MAX_VIDEO_SIZE / 1024 / 1024}MB`
            };
        }
    } else if (isImage(file.mimetype)) {
        if (file.size > MAX_IMAGE_SIZE) {
            return {
                valid: false,
                error: `Image file too large. Maximum size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`
            };
        }
    } else {
        if (file.size > MAX_DOCUMENT_SIZE) {
            return {
                valid: false,
                error: `Document file too large. Maximum size: ${MAX_DOCUMENT_SIZE / 1024 / 1024}MB`
            };
        }
    }

    return { valid: true };
};
