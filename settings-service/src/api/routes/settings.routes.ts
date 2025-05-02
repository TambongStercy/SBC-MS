import express, { Request, Response, NextFunction } from 'express';
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
    uploadGenericFile,
    internalUploadFile
} from '../controllers/settings.controller';
import { upload } from '../middleware/multer.config'; // Import the configured Multer instance
import authenticate from '../middleware/auth.middleware'; // Standard auth for settings management
import { authenticateServiceRequest } from '../middleware/auth.middleware'; // Assume it's exported from the main auth file

const router = express.Router();
const internalRouter = express.Router(); // Router for internal service calls

// Define CORS options based on config
const corsOptions = {
    origin: config.cors.allowedOrigins, // Use the same origins as global config
    methods: ['GET'], // Only GET is needed for these public routes
};

// Define a no-op middleware for non-production environments
const noOpMiddleware = (req: Request, res: Response, next: NextFunction) => next();

// Conditionally select the CORS middleware
const conditionalCors = config.nodeEnv === 'production' ? cors(corsOptions) : noOpMiddleware;

// GET /settings/files/:fileId - Proxy route for accessing uploaded files (e.g., logo)
// Apply CORS middleware conditionally
router.get('/files/:fileId', conditionalCors, getFileFromDrive);

// GET /settings/thumbnails/:fileId - Proxy route for accessing Drive thumbnails
// Apply CORS middleware conditionally
router.get('/thumbnails/:fileId', conditionalCors, getThumbnailFromDrive);

// GET /settings - Retrieve current settings
router.get('/', getSettings);

// POST /settings/files/upload - Upload a generic file (potentially for direct admin use? keep for now)
// Uses the standard user/admin authentication
router.post('/files/upload', upload.single('file'), uploadGenericFile);

// --- Internal Service Routes --- 
// Prefix with /internal and use service-specific authentication
internalRouter.use(authenticateServiceRequest); // Apply service-to-service auth middleware

// POST /settings/internal/upload - Upload a file from another service
// Uses Multer to handle the file and expect folderName in body
internalRouter.post('/upload', upload.single('file'), internalUploadFile);

// Mount the internal router
router.use('/internal', internalRouter);

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