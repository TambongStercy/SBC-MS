import { Storage } from '@google-cloud/storage';
import config from '../config';
import logger from '../utils/logger';
import googleDriveService from './googleDrive.service';

const log = logger.getLogger('CloudStorageService');

interface UploadResult {
    fileId: string;
    publicUrl: string;
    fileName: string;
}

class CloudStorageService {
    private storage: Storage;
    private bucketName = 'sbc-file-storage'; // You'll need to create this bucket
    private useCloudStorage = true; // Feature flag - ENABLE for new uploads

    constructor() {
        this.storage = new Storage({
            projectId: 'snipper-c0411', // Your project ID
            credentials: {
                client_email: config.googleDrive.clientEmail,
                private_key: config.googleDrive.privateKey,
            }
        });

        // Auto-create bucket if it doesn't exist
        this.createBucketIfNotExists().catch(error => {
            log.error('Failed to create bucket:', error);
        });

        log.info('Cloud Storage service initialized.');
    }

    // Smart hybrid service that handles both old and new files
    async uploadFileHybrid(fileBuffer: Buffer, mimeType: string, fileName: string, folderType?: string): Promise<UploadResult> {
        // Route NEW uploads to Cloud Storage
        if (this.useCloudStorage) {
            try {
                return await this.uploadFile(fileBuffer, mimeType, fileName, folderType);
            } catch (error) {
                log.warn('Cloud Storage upload failed, falling back to Google Drive');
                const driveResult = await googleDriveService.uploadFile(fileBuffer, mimeType, fileName);
                return {
                    fileId: driveResult.fileId,
                    publicUrl: driveResult.webContentLink || driveResult.webViewLink || '',
                    fileName
                };
            }
        } else {
            // Use Drive for now (but this will change soon)
            const driveResult = await googleDriveService.uploadFile(fileBuffer, mimeType, fileName);
            return {
                fileId: driveResult.fileId,
                publicUrl: driveResult.webContentLink || driveResult.webViewLink || '',
                fileName
            };
        }
    }

    // Universal file retrieval - works with both Drive and GCS files
    async getFileUrl(fileId: string): Promise<string> {
        // Check if it's already a full URL (GCS direct URL)
        if (fileId.startsWith('https://storage.googleapis.com/')) {
            return fileId; // Already a direct URL
        }

        // Check if it's a GCS filename (contains folder structure)
        if (fileId.includes('/') || fileId.startsWith('profile-pictures/') || fileId.startsWith('product-images/')) {
            return `https://storage.googleapis.com/${this.bucketName}/${fileId}`;
        }

        // Check if it's a Drive file (33 character ID starting with '1')
        if (fileId.length === 33 && fileId.startsWith('1')) {
            // For Drive files, we can return direct URLs instead of proxy
            return this.getDriveDirectUrl(fileId);
        }

        // Fallback: assume it's a GCS filename
        return `https://storage.googleapis.com/${this.bucketName}/${fileId}`;
    }

    // Get direct Google Drive URL (no proxy needed)
    private getDriveDirectUrl(fileId: string): string {
        // Use Google Drive's direct download URL for public files
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }

    async uploadFile(fileBuffer: Buffer, mimeType: string, fileName: string, folderType?: string): Promise<UploadResult> {
        try {
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(fileName);

            await file.save(fileBuffer, {
                metadata: {
                    contentType: mimeType,
                    cacheControl: 'public, max-age=31536000', // 1 year cache
                },
                public: true, // Make file publicly accessible
            });

            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${fileName}`;

            log.info(`File '${fileName}' uploaded successfully to Cloud Storage`);

            return {
                fileId: fileName, // In Cloud Storage, fileName serves as ID
                publicUrl,
                fileName
            };
        } catch (error: any) {
            log.error(`Error uploading file '${fileName}' to Cloud Storage:`, error);
            throw new Error(`Cloud Storage upload failed: ${error.message}`);
        }
    }

    async createBucketIfNotExists(): Promise<void> {
        try {
            const [exists] = await this.storage.bucket(this.bucketName).exists();
            if (!exists) {
                await this.storage.createBucket(this.bucketName, {
                    location: 'US',
                    storageClass: 'STANDARD',
                });

                // Make bucket publicly readable
                await this.storage.bucket(this.bucketName).makePublic();
                log.info(`Created and configured bucket: ${this.bucketName}`);
            }
        } catch (error: any) {
            log.error(`Error creating bucket: ${error.message}`);
            throw error;
        }
    }

    async deleteFile(fileName: string): Promise<void> {
        try {
            const bucket = this.storage.bucket(this.bucketName);
            await bucket.file(fileName).delete();
            log.info(`File '${fileName}' deleted successfully from Cloud Storage`);
        } catch (error: any) {
            log.error(`Error deleting file '${fileName}' from Cloud Storage:`, error);
            throw new Error(`Cloud Storage deletion failed: ${error.message}`);
        }
    }
}

export default new CloudStorageService();