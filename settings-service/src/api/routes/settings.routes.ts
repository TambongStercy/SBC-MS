import express from 'express';
import cors from 'cors';
import config from '../../config';
import {
    getSettings,
    updateSettings,
    uploadCompanyLogo,
    uploadTermsPdf,
    uploadPresentationVideo,
    uploadPresentationPdf,
    getFileFromDrive,
    getThumbnailFromDrive,
    uploadGenericFile
} from '../controllers/settings.controller';
import { upload } from '../middleware/multer.config'; // Import the configured Multer instance
import authenticate from '../middleware/auth.middleware'; // Assuming a standard auth middleware exists

const router = express.Router();

// Define CORS options based on config
const corsOptions = {
    origin: config.cors.allowedOrigins, // Use the same origins as global config
    methods: ['GET'], // Only GET is needed for these public routes
};

// GET /settings/files/:fileId - Proxy route for accessing uploaded files (e.g., logo)
// Apply CORS middleware specifically to this route
router.get('/files/:fileId', cors(corsOptions), getFileFromDrive);

// GET /settings/thumbnails/:fileId - Proxy route for accessing Drive thumbnails
// Apply CORS middleware specifically to this route
router.get('/thumbnails/:fileId', cors(corsOptions), getThumbnailFromDrive);

// GET /settings - Retrieve current settings
router.get('/', getSettings);

// Apply authentication middleware to all subsequent settings routes
router.use(authenticate);

// PUT /settings - Update non-file settings (URLs, etc.)
router.put('/', updateSettings);

// POST /settings/logo - Upload/Update company logo
// Multer middleware processes the 'companyLogo' field from the form-data
router.post('/logo', upload.single('companyLogo'), uploadCompanyLogo);

// POST /settings/terms-pdf - Upload/Update terms PDF
// Multer middleware processes the 'termsPdf' field from the form-data
router.post('/terms-pdf', upload.single('termsPdf'), uploadTermsPdf);

// POST /settings/presentation-video - Upload/Update presentation video
// Multer middleware processes the 'presentationVideo' field from the form-data
router.post('/presentation-video', upload.single('presentationVideo'), uploadPresentationVideo);

// POST /settings/presentation-pdf - Upload/Update presentation PDF
// Multer middleware processes the 'presentationPdf' field from the form-data
router.post('/presentation-pdf', upload.single('presentationPdf'), uploadPresentationPdf);

// POST /settings/files/upload - Upload a generic file
// Uses the same authentication for now, but could use specific service auth later.
router.post('/files/upload', upload.single('file'), uploadGenericFile);

// Other routes (e.g., PUT /settings for updating other fields) can be added here
// router.put('/', updateSettings); // Example

export default router; 