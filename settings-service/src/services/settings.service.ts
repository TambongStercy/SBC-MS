// import { NotFoundError } from '../utils/errors';
import SettingsRepository from '../database/repositories/settings.repository';
import {
    ISettings,
    IFileReference
} from '../database/models/settings.model';
import GoogleDriveService from './googleDrive.service'; // Import Google Drive Service
// Remove S3 related imports if they exist
// import S3Service from './s3.service'; 
import logger from '../utils/logger';
import { AppError, NotFoundError } from '../utils/errors'; // Import NotFoundError if needed
import { Types } from 'mongoose';
import config from '../config'; // Import config to access folder IDs

const log = logger.getLogger('SettingsService');

// Interface for the response of the generic upload
interface UploadedFileInfo {
    fileId: string;
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
}

class SettingsService {
    private repository: SettingsRepository;
    // Remove S3 service instance if it exists
    // private s3Service: S3Service; 

    constructor() {
        this.repository = new SettingsRepository();
        // Remove S3 service initialization if it exists
        // this.s3Service = new S3Service(); 
        log.info('SettingsService initialized.');
    }

    /**
     * Helper function to generate proxy URLs for file references.
     * @param settings - The settings document.
     * @returns The settings document with URLs populated.
     */
    private populateFileUrls(settings: ISettings | null): ISettings | null {
        if (!settings) return null;

        const generateUrl = (ref?: IFileReference) => {
            if (ref?.fileId) {
                ref.url = GoogleDriveService.getProxyFileUrl(ref.fileId);
            }
            return ref;
        };

        settings.companyLogo = generateUrl(settings.companyLogo);
        settings.termsAndConditionsPdf = generateUrl(settings.termsAndConditionsPdf);
        settings.presentationVideo = generateUrl(settings.presentationVideo);
        settings.presentationPdf = generateUrl(settings.presentationPdf);

        return settings;
    }

    async getSettings(): Promise<ISettings | null> {
        log.info('Fetching settings...');
        let settings: ISettings | null = null;
        try {
            settings = await this.repository.findSingle();
        } catch (dbError: any) {
            log.error('Database error fetching settings:', dbError);
            // Throw a specific AppError or handle as needed
            throw new AppError('Failed to retrieve settings due to database issue.', 500);
        }

        try {
            settings = this.populateFileUrls(settings);
        } catch (processingError: any) {
            log.error('Error processing settings after fetch:', processingError);
            // Handle potential errors during URL population, though less likely
            throw new AppError('Failed to process settings data.', 500);
        }
        log.info('Settings fetched successfully.');
        return settings;
    }

    async updateSettings(data: Partial<Omit<ISettings, 'companyLogo' | 'termsAndConditionsPdf' | 'presentationVideo' | 'presentationPdf'>>): Promise<ISettings> {
        log.info('Updating settings...', data);
        // Optional: Add validation for URLs if needed
        const settings = await this.repository.upsert(data);
        log.info('Settings updated successfully.');
        // Re-populate URLs for the response
        return this.populateFileUrls(settings) || settings;
    }

    /**
     * Helper function to handle file uploads for specific settings fields.
     * @param file - The uploaded file.
     * @param fieldName - The key of the field in ISettings (e.g., 'companyLogo').
     * @param fileNamePrefix - Prefix for the filename in storage (e.g., 'logo_').
     * @returns The updated ISettings document.
     */
    private async updateFileField(file: Express.Multer.File, fieldName: keyof Pick<ISettings, 'companyLogo' | 'termsAndConditionsPdf' | 'presentationVideo' | 'presentationPdf'>, fileNamePrefix: string): Promise<ISettings> {
        log.info(`Updating file field '${fieldName}' with file: ${file.originalname}`);
        let currentSettings = await this.repository.findSingle();
        const oldFileId = currentSettings?.[fieldName]?.fileId;

        // Delete the old file from Google Drive if it exists
        if (oldFileId) {
            log.debug(`Attempting to delete old ${fieldName} file with File ID: ${oldFileId}`);
            try {
                await GoogleDriveService.deleteFile(oldFileId);
                log.info(`Successfully deleted old ${fieldName} file (File ID: ${oldFileId}) from Google Drive.`);
            } catch (deleteError: any) {
                log.error(`Failed to delete old ${fieldName} file (File ID: ${oldFileId}) from Google Drive: ${deleteError.message}`, deleteError);
            }
        }

        // Upload the new file to Google Drive
        let fileId: string;
        try {
            log.debug(`Uploading new ${fieldName} file '${file.originalname}' to Google Drive...`);
            const uniqueFileName = `${fileNamePrefix}${Date.now()}_${file.originalname}`;
            const uploadResult = await GoogleDriveService.uploadFile(
                file.buffer,
                file.mimetype,
                uniqueFileName
            );

            fileId = uploadResult.fileId;
            log.info(`New ${fieldName} file uploaded successfully. File ID: ${fileId}`);
        } catch (uploadError: any) {
            log.error(`Failed to upload new ${fieldName} file to Google Drive: ${uploadError.message}`, uploadError);
            throw new AppError(`Failed to upload ${fieldName} file to storage.`, 500);
        }

        // Prepare file reference data
        const fileData: IFileReference = {
            fileId: fileId,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
        };

        log.debug(`Updating settings database with new ${fieldName} information...`, fileData);
        // Use Partial<ISettings> to update only the specific field
        const updatePayload: Partial<ISettings> = { [fieldName]: fileData };
        const updatedSettings = await this.repository.upsert(updatePayload);

        log.info(`${fieldName} updated successfully in database.`);
        // Re-populate URLs for the response
        return this.populateFileUrls(updatedSettings) || updatedSettings;
    }

    // --- Specific File Update Methods ---

    async updateCompanyLogo(file: Express.Multer.File): Promise<ISettings> {
        return this.updateFileField(file, 'companyLogo', 'logo_');
    }

    async updateTermsPdf(file: Express.Multer.File): Promise<ISettings> {
        return this.updateFileField(file, 'termsAndConditionsPdf', 'terms_');
    }

    async updatePresentationVideo(file: Express.Multer.File): Promise<ISettings> {
        return this.updateFileField(file, 'presentationVideo', 'pres_video_');
    }

    async updatePresentationPdf(file: Express.Multer.File): Promise<ISettings> {
        return this.updateFileField(file, 'presentationPdf', 'pres_pdf_');
    }

    /**
     * Uploads a generic file for use by other services.
     * Stores the file in Google Drive and returns access information.
     * Does NOT modify the main Settings document.
     * @param file The file uploaded via Multer.
     * @param folderName Optional name ('profile-picture', 'product-docs') to specify target folder.
     * @returns Information about the uploaded file, including the proxy URL.
     */
    async uploadGenericFile(file: Express.Multer.File, folderName?: string): Promise<UploadedFileInfo> {
        log.info(`Uploading generic file: ${file.originalname} (Size: ${file.size}), Target Folder Name: ${folderName || 'Default'}`);
        let fileId: string;

        // Determine the parent folder ID based on folderName
        let parentFolderId: string | undefined;
        switch (folderName) {
            case 'profile-picture':
                parentFolderId = config.googleDrive.profilePictureFolderId;
                log.debug('Targeting Profile Picture folder.');
                break;
            case 'product-docs':
                parentFolderId = config.googleDrive.productDocsFolderId;
                log.debug('Targeting Product Docs folder.');
                break;
            default:
                // Use default settings folder ID or undefined if none configured
                parentFolderId = config.googleDrive.parentFolderId;
                log.debug('Targeting default settings folder (or root if none specified).');
        }

        // Optional: Add a check if a specific folder was requested but its ID is missing
        if (folderName && !parentFolderId) {
            log.warn(`Folder ID for requested folder '${folderName}' is not configured. Uploading to default/root.`);
            // Reset to default/root if specific folder ID missing
            parentFolderId = config.googleDrive.parentFolderId;
        }

        try {
            log.debug(`Uploading generic file '${file.originalname}' to Google Drive...`);
            const uniqueFileName = `generic_${Date.now()}_${file.originalname}`;
            const uploadResult = await GoogleDriveService.uploadFile(
                file.buffer,
                file.mimetype,
                uniqueFileName,
                parentFolderId // Pass the determined parent folder ID
            );
            fileId = uploadResult.fileId;
            log.info(`Generic file uploaded successfully. File ID: ${fileId}`);
        } catch (uploadError: any) {
            log.error(`Failed to upload generic file to Google Drive: ${uploadError.message}`, uploadError);
            throw new Error('Failed to upload file to storage.');
        }

        const url = GoogleDriveService.getProxyFileUrl(fileId);
        const fileInfo: UploadedFileInfo = {
            fileId: fileId,
            url: url,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
        };
        log.info(`Returning info for generic file upload:`, fileInfo);
        return fileInfo;
    }

    // Removed getCompanyLogo method if it only returned a URL,
    // as getSettings now handles URL generation.
    // If it did more, it would need adjustment.
}

export default new SettingsService(); 