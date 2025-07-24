import { Request, Response, NextFunction } from 'express';
import settingsService from '../../services/settings.service'; // Import the instance directly
import GoogleDriveService from '../../services/googleDrive.service'; // Import Drive service
import logger from '../../utils/logger';
import { NotFoundError, AppError, BadRequestError } from '../../utils/errors'; // Assuming custom error classes
import axios from 'axios'; // Import axios

const log = logger.getLogger('SettingsController');

// Remove the instantiation, use the imported instance directly
// const settingsService = new SettingsService(); 

export const getSettings = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling GET /settings request');
    try {
        // Use the imported instance
        const settings = await settingsService.getSettings();
        if (!settings) {
            log.info('No settings found.');
            // Decide whether to return 404 or an empty/default object
            // Returning success: true with null data is often preferred for GET
            return res.status(200).json({ success: true, data: null, message: 'No settings configured yet.' });
        }
        log.info('Settings retrieved successfully');
        res.status(200).json({ success: true, data: settings });
    } catch (error) {
        log.error('Error fetching settings:', error);
        next(new AppError('Failed to retrieve settings', 500));
    }
};

// Controller for updating non-file settings (like URLs)
export const updateSettings = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling PUT /settings request', req.body);
    // Explicitly pick allowed fields to prevent unwanted updates
    const { whatsappGroupUrl, telegramGroupUrl, discordGroupUrl } = req.body;
    const updateData = { whatsappGroupUrl, telegramGroupUrl, discordGroupUrl };

    // Remove undefined fields so they don't overwrite existing values with null
    Object.keys(updateData).forEach(key => updateData[key as keyof typeof updateData] === undefined && delete updateData[key as keyof typeof updateData]);

    if (Object.keys(updateData).length === 0) {
        log.warn('Update settings request received with no valid fields.');
        return next(new BadRequestError('No valid settings fields provided for update.'));
    }

    try {
        const updatedSettings = await settingsService.updateSettings(updateData);
        log.info('Settings updated successfully.');
        res.status(200).json({ success: true, data: updatedSettings, message: 'Settings updated successfully.' });
    } catch (error) {
        log.error('Error updating settings:', error);
        next(new AppError('Failed to update settings', 500));
    }
};

// export const getCompanyLogo = async (req: Request, res: Response, next: NextFunction) => {
//     // This is likely obsolete now, as the logo URL is part of getSettings
// };

// Generic helper for file upload controllers
const handleFileUpload = async (
    req: Request,
    res: Response,
    next: NextFunction,
    serviceMethod: (file: Express.Multer.File) => Promise<any>,
    fieldName: string // e.g., 'companyLogo', 'termsPdf'
) => {
    log.info(`Handling POST /settings/${fieldName} request`);
    if (!req.file) {
        log.warn(`No file uploaded in request for ${fieldName}.`);
        return next(new BadRequestError(`No file uploaded. Please provide a ${fieldName} file.`));
    }

    try {
        log.info(`Received ${fieldName} file: ${req.file.originalname}, size: ${req.file.size}`);
        const updatedSettings = await serviceMethod(req.file);
        log.info(`${fieldName} updated successfully.`);
        res.status(200).json({ success: true, data: updatedSettings, message: `${fieldName} updated successfully.` });
    } catch (error) {
        log.error(`Error uploading ${fieldName}:`, error);
        next(new AppError(`Failed to update ${fieldName}`, 500));
    }
};

export const uploadCompanyLogo = async (req: Request, res: Response, next: NextFunction) => {
    await handleFileUpload(req, res, next, settingsService.updateCompanyLogo.bind(settingsService), 'companyLogo');
};

export const uploadTermsPdf = async (req: Request, res: Response, next: NextFunction) => {
    await handleFileUpload(req, res, next, settingsService.updateTermsPdf.bind(settingsService), 'termsPdf');
};

export const uploadPresentationVideo = async (req: Request, res: Response, next: NextFunction) => {
    await handleFileUpload(req, res, next, settingsService.updatePresentationVideo.bind(settingsService), 'presentationVideo');
};

export const uploadPresentationPdf = async (req: Request, res: Response, next: NextFunction) => {
    await handleFileUpload(req, res, next, settingsService.updatePresentationPdf.bind(settingsService), 'presentationPdf');
};

// Controller method for generic file uploads
export const uploadGenericFile = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling POST /files/upload request (generic file upload)');
    if (!req.file) {
        log.warn('No file uploaded in generic upload request.');
        return next(new BadRequestError('No file uploaded. Please provide a file.'));
    }

    try {
        log.info(`Received generic file: ${req.file.originalname}, size: ${req.file.size}`);
        // Use the imported instance
        const fileInfo = await settingsService.uploadGenericFile(req.file);
        log.info('Generic file uploaded and processed successfully.');
        // Return the file info (id, url, name, type, size)
        res.status(200).json({ success: true, data: fileInfo, message: 'File uploaded successfully.' });
    } catch (error) {
        log.error('Error uploading generic file:', error);
        next(new AppError('Failed to process file upload', 500));
    }
};

// Controller method for INTERNAL service-to-service file uploads
export const internalUploadFile = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling POST /internal/upload request (internal service upload)');
    const folderName = req.body.folderName as string | undefined;

    if (!req.file) {
        log.warn('No file provided in internal upload request.');
        return next(new BadRequestError('No file uploaded.'));
    }

    try {
        log.info(`Received internal file: ${req.file.originalname}, size: ${req.file.size}, target folder: ${folderName || 'default'}`);
        // Call service method, passing the file and potential folder name
        const fileInfo = await settingsService.uploadGenericFile(req.file, folderName);
        log.info('Internal file uploaded and processed successfully.');
        // Return the file info (id, url, name, type, size)
        res.status(200).json({ success: true, data: fileInfo, message: 'File uploaded successfully.' }); // Use 200 OK for internal success
    } catch (error) {
        log.error('Error processing internal file upload:', error);
        // Pass specific error if available, otherwise generic
        next(error instanceof AppError ? error : new AppError('Failed to process internal file upload', 500));
    }
};

// Universal file proxy - handles both Google Drive and Cloud Storage files
export const getFileFromStorage = async (req: Request, res: Response, next: NextFunction) => {
    const { fileId } = req.params;
    if (!fileId) {
        log.warn('Missing fileId in proxy request');
        return res.status(400).json({ success: false, message: 'File ID is required' });
    }

    try {
        log.info(`Proxy request received for file ID: ${fileId}`);

        // Check if it's a Cloud Storage file (contains folder structure or is a URL)
        if (fileId.includes('/') || fileId.startsWith('avatars/') || fileId.startsWith('products/') || fileId.startsWith('documents/') || fileId.startsWith('https://storage.googleapis.com/')) {
            // Cloud Storage file - redirect to direct CDN URL
            let directUrl: string;

            if (fileId.startsWith('https://storage.googleapis.com/')) {
                directUrl = fileId; // Already a full URL
            } else {
                directUrl = `https://storage.googleapis.com/sbc-file-storage/${fileId}`;
            }

            log.info(`Redirecting to Cloud Storage CDN: ${directUrl}`);
            return res.redirect(302, directUrl);
        }

        // Google Drive file - use proxy streaming (legacy support)
        log.info(`Serving Google Drive file via proxy: ${fileId}`);
        const { stream, mimeType, size } = await GoogleDriveService.getFileContent(fileId);

        if (mimeType) {
            res.setHeader('Content-Type', mimeType);
        }
        if (size) {
            res.setHeader('Content-Length', size);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

        stream.pipe(res);

        stream.on('error', (error: any) => {
            log.error(`Error streaming file ${fileId} from Drive:`, error);
            if (!res.headersSent) {
                if (error.message === 'File not found') {
                    return res.status(404).json({ success: false, message: 'File not found' });
                }
                res.status(500).json({ success: false, message: 'Error streaming file' });
            }
        });

        stream.on('end', () => {
            log.debug(`Successfully streamed file ${fileId}`);
        });

    } catch (error: any) {
        log.error(`Error in getFileFromStorage for file ID ${fileId}:`, error);
        if (error.message === 'File not found') {
            return res.status(404).json({ success: false, message: 'File not found' });
        }
        next(new AppError('Failed to retrieve file from storage', 500));
    }
};

// Backward compatibility alias
export const getFileFromDrive = getFileFromStorage;

/**
 * Get Thumbnail from Drive
 * Proxies the Google Drive thumbnail endpoint.
 * GET /thumbnails/:fileId?size=XXX
 */
export const getThumbnailFromDrive = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { fileId } = req.params;
        const sizeQuery = req.query.size as string | undefined;
        const size = sizeQuery && /^[0-9]+$/.test(sizeQuery) ? parseInt(sizeQuery, 10) : 500; // Default size 500px width

        if (!fileId) {
            log.warn('Thumbnail request missing fileId');
            return res.status(400).send('Missing file ID');
        }

        log.info(`Fetching thumbnail for Drive fileId: ${fileId}, size: w${size}`);
        const thumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;

        const response = await axios.get(thumbnailUrl, {
            responseType: 'arraybuffer', // Fetch as raw bytes
            validateStatus: (status) => status < 500, // Treat 4xx as valid response for checking headers
        });

        if (response.status >= 400) {
            log.warn(`Google Drive thumbnail endpoint returned status ${response.status} for fileId: ${fileId}`);
            // Send appropriate client error (e.g., 404 if Drive returned 404)
            return res.status(response.status).send(`Error fetching thumbnail (status: ${response.status})`);
        }

        console.log(response.data);

        // Set content type from Drive response and send data
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg'); // Default to jpeg if header missing
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.send(response.data);

    } catch (error: any) {
        log.error(`Error fetching Drive thumbnail: ${error.message}`, {
            fileId: req.params.fileId,
            error: error.response?.data || error.stack // Log response data if available
        });
        // Avoid sending detailed errors to client
        res.status(500).send('Server error fetching thumbnail');
    }
};

// NEW: Controller for fetching admin balance
export const getAdminBalance = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling GET /settings/stats/admin-balance request');
    try {
        const balance = await settingsService.getAdminBalance();
        res.status(200).json({ success: true, data: balance, message: 'Admin balance retrieved successfully.' });
    } catch (error) {
        log.error('Error fetching admin balance:', error);
        next(error); // Pass to error handler middleware
    }
};

// --- Formations Controllers ---

export const getFormations = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling GET /settings/formations request');
    try {
        const formations = await settingsService.getFormations();
        log.info('Formations retrieved successfully');
        res.status(200).json({ success: true, data: formations });
    } catch (error) {
        log.error('Error fetching formations:', error);
        next(new AppError('Failed to retrieve formations', 500));
    }
};

export const addFormation = async (req: Request, res: Response, next: NextFunction) => {
    log.info('Handling POST /settings/formations request', req.body);
    const { title, link } = req.body;

    if (!title || !link) {
        log.warn('Missing title or link for adding formation.');
        return next(new BadRequestError('Title and link are required to add a formation.'));
    }

    try {
        const newFormation = await settingsService.addFormation({ title, link });
        log.info('Formation added successfully.', newFormation);
        res.status(201).json({ success: true, data: newFormation, message: 'Formation added successfully.' });
    } catch (error) {
        log.error('Error adding formation:', error);
        next(new AppError('Failed to add formation', 500));
    }
};

export const updateFormation = async (req: Request, res: Response, next: NextFunction) => {
    const { formationId } = req.params;
    const { title, link } = req.body;
    log.info(`Handling PUT /settings/formations/${formationId} request`, req.body);

    if (!title && !link) {
        log.warn('No update data provided for formation.');
        return next(new BadRequestError('At least one field (title or link) is required for update.'));
    }

    try {
        const updatedFormation = await settingsService.updateFormation(formationId, { title, link });
        log.info(`Formation with ID ${formationId} updated successfully.`, updatedFormation);
        res.status(200).json({ success: true, data: updatedFormation, message: 'Formation updated successfully.' });
    } catch (error) {
        log.error(`Error updating formation with ID ${formationId}:`, error);
        if (error instanceof NotFoundError) {
            return next(error);
        }
        next(new AppError('Failed to update formation', 500));
    }
};

export const removeFormation = async (req: Request, res: Response, next: NextFunction) => {
    const { formationId } = req.params;
    log.info(`Handling DELETE /settings/formations/${formationId} request`);

    try {
        await settingsService.removeFormation(formationId);
        log.info(`Formation with ID ${formationId} removed successfully.`);
        res.status(200).json({ success: true, message: 'Formation removed successfully.' });
    } catch (error) {
        log.error(`Error removing formation with ID ${formationId}:`, error);
        if (error instanceof NotFoundError) {
            return next(error);
        }
        next(new AppError('Failed to remove formation', 500));
    }
};


