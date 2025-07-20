// import { NotFoundError } from '../utils/errors';
import SettingsRepository from '../database/repositories/settings.repository';
import {
    ISettings,
    IFileReference,
    IFormation
} from '../database/models/settings.model';
import GoogleDriveService from './googleDrive.service'; // Import Google Drive Service
// Remove S3 related imports if they exist
// import S3Service from './s3.service'; 
import logger from '../utils/logger';
import { AppError, NotFoundError } from '../utils/errors'; // Import NotFoundError if needed
import { Types } from 'mongoose';
import config from '../config'; // Import config to access folder IDs
import paymentService from './clients/payment.service.client'; // NEW: Import the new payment service client

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
     * Helper function to generate direct URLs for file references.
     * Uses direct URLs for new GCS files, proxy for old Drive files.
     * @param settings - The settings document.
     * @returns The settings document with URLs populated.
     */
    private async populateFileUrls(settings: ISettings | null): Promise<ISettings | null> {
        if (!settings) return null;

        const generateUrl = async (ref?: IFileReference) => {
            if (ref?.fileId) {
                // Import cloud storage service dynamically
                const CloudStorageService = (await import('./cloudStorage.service')).default;
                ref.url = await CloudStorageService.getFileUrl(ref.fileId);
            }
            return ref;
        };

        settings.companyLogo = await generateUrl(settings.companyLogo);
        settings.termsAndConditionsPdf = await generateUrl(settings.termsAndConditionsPdf);
        settings.presentationVideo = await generateUrl(settings.presentationVideo);
        settings.presentationPdf = await generateUrl(settings.presentationPdf);

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
            settings = await this.populateFileUrls(settings);
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
        return await this.populateFileUrls(settings) || settings;
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
        return await this.populateFileUrls(updatedSettings) || updatedSettings;
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
     * Uses hybrid storage: Cloud Storage for new uploads, Drive for existing files.
     * Does NOT modify the main Settings document.
     * @param file The file uploaded via Multer.
     * @param folderName Optional name ('profile-picture', 'product-docs') to specify target folder.
     * @returns Information about the uploaded file, including the proxy URL.
     */
    async uploadGenericFile(file: Express.Multer.File, folderName?: string): Promise<UploadedFileInfo> {
        log.info(`Uploading generic file: ${file.originalname} (Size: ${file.size}), Target Folder Name: ${folderName || 'Default'}`);
        
        try {
            // Import cloud storage service
            const CloudStorageService = (await import('./cloudStorage.service')).default;
            
            // Create organized filename with folder prefix
            const folderPrefix = folderName ? `${folderName}/` : '';
            const uniqueFileName = `${folderPrefix}${Date.now()}_${file.originalname}`;
            
            log.debug(`Uploading generic file '${file.originalname}' using hybrid storage...`);
            const uploadResult = await CloudStorageService.uploadFileHybrid(
                file.buffer,
                file.mimetype,
                uniqueFileName,
                folderName
            );
            
            log.info(`Generic file uploaded successfully. File ID: ${uploadResult.fileId}`);
            
            const fileInfo: UploadedFileInfo = {
                fileId: uploadResult.fileId,
                url: uploadResult.publicUrl,
                fileName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
            };
            
            log.info(`Returning info for generic file upload:`, fileInfo);
            return fileInfo;
            
        } catch (uploadError: any) {
            log.error(`Failed to upload generic file: ${uploadError.message}`, uploadError);
            throw new Error('Failed to upload file to storage.');
        }
    }

    // --- Formations Management Methods ---

    /**
     * Retrieves all formations from the settings document.
     */
    async getFormations(): Promise<IFormation[]> {
        log.info('Fetching formations...');
        try {
            const settings = await this.repository.findSingle();
            log.info('Formations fetched successfully.');
            return settings?.formations || []; // Return empty array if no settings or formations
        } catch (dbError: any) {
            log.error('Database error fetching formations:', dbError);
            throw new AppError('Failed to retrieve formations due to database issue.', 500);
        }
    }

    /**
     * Adds a new formation to the settings document.
     * @param data The formation data (title, link).
     * @returns The newly added formation with its _id.
     */
    async addFormation(data: { title: string; link: string }): Promise<IFormation> {
        log.info('Adding new formation...', data);
        try {
            let settings = await this.repository.findSingle();

            if (!settings) {
                // If no settings document exists, create a minimal one
                settings = await this.repository.upsert({});
                log.info('No settings document found, created a new one for formations.');
            }

            // Mongoose will automatically assign an _id to the subdocument
            settings.formations.push(data);
            const updatedSettings = await settings.save(); // Save the document to persist changes
            log.info('Formation added successfully.');

            // Return the last added formation, which should be the new one
            return updatedSettings.formations[updatedSettings.formations.length - 1];
        } catch (error: any) {
            log.error('Error adding formation:', error);
            throw new AppError('Failed to add formation.', 500);
        }
    }

    /**
     * Updates an existing formation in the settings document.
     * @param formationId The _id of the formation to update.
     * @param updates The partial formation data to update.
     * @returns The updated formation.
     */
    async updateFormation(formationId: string, updates: Partial<Omit<IFormation, '_id'>>): Promise<IFormation> {
        log.info(`Updating formation with ID: ${formationId}`, updates);
        try {
            const settings = await this.repository.findSingle();

            if (!settings) {
                log.warn('Settings document not found for formation update.');
                throw new NotFoundError('Settings document not found.');
            }

            const formation = settings.formations.id(formationId);
            if (!formation) {
                log.warn(`Formation with ID ${formationId} not found.`);
                throw new NotFoundError(`Formation with ID ${formationId} not found.`);
            }

            // Apply updates
            if (updates.title !== undefined) formation.title = updates.title;
            if (updates.link !== undefined) formation.link = updates.link;

            await settings.save(); // Save the document to persist changes
            log.info(`Formation with ID ${formationId} updated successfully.`);
            return formation;
        } catch (error: any) {
            log.error(`Error updating formation with ID ${formationId}:`, error);
            if (error instanceof NotFoundError) throw error;
            throw new AppError('Failed to update formation.', 500);
        }
    }

    /**
     * Removes a formation from the settings document.
     * @param formationId The _id of the formation to remove.
     */
    async removeFormation(formationId: string): Promise<void> {
        log.info(`Removing formation with ID: ${formationId}`);
        try {
            const settings = await this.repository.findSingle();

            if (!settings) {
                log.warn('Settings document not found for formation removal.');
                throw new NotFoundError('Settings document not found.');
            }

            const initialLength = settings.formations.length;
            settings.formations.pull(formationId); // Mongoose method to remove subdocument by ID

            if (settings.formations.length === initialLength) {
                log.warn(`Formation with ID ${formationId} not found for removal.`);
                throw new NotFoundError(`Formation with ID ${formationId} not found.`);
            }

            await settings.save(); // Save the document to persist changes
            log.info(`Formation with ID ${formationId} removed successfully.`);
        } catch (error: any) {
            log.error(`Error removing formation with ID ${formationId}:`, error);
            if (error instanceof NotFoundError) throw error;
            throw new AppError('Failed to remove formation.', 500);
        }
    }

    /**
     * Fetches the admin balance from the Payment Service.
     */
    async getAdminBalance(): Promise<number> {
        log.info('Fetching admin balance from payment service...');
        try {
            const balance = await paymentService.getAdminBalance();
            log.info(`Admin balance fetched successfully: ${balance}`);
            return balance;
        } catch (error: any) {
            log.error(`Failed to fetch admin balance from payment service: ${error.message}`, error);
            throw new AppError('Failed to retrieve admin balance from payment service.', 500);
        }
    }
}

export default new SettingsService(); 