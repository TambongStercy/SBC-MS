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

interface SignedUrlOptions {
    expiresIn?: number; // Expiration in seconds (default: 3600 = 1 hour)
    action?: 'read' | 'write' | 'delete';
}

class CloudStorageService {
    private storage: Storage;
    private bucketName = 'sbc-file-storage'; // Public bucket for general files
    private privateBucketName = 'sbc-status-media-private'; // Private bucket for status/stories
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

    // Universal file retrieval - returns direct CDN URLs for Cloud Storage, proxy URLs for Drive
    async getFileUrl(fileId: string): Promise<string> {
        // Check if it's already a full URL (GCS direct URL)
        if (fileId.startsWith('https://storage.googleapis.com/')) {
            return fileId; // Already a direct URL
        }

        // Check if it's a GCS filename (contains folder structure) - return direct CDN URL
        if (fileId.includes('/') || fileId.startsWith('avatars/') || fileId.startsWith('products/') || fileId.startsWith('documents/')) {
            return `https://storage.googleapis.com/${this.bucketName}/${fileId}`;
        }

        // Check if it's a Drive file (33 character ID starting with '1') - use proxy to save bandwidth
        if (fileId.length === 33 && fileId.startsWith('1')) {
            return `/api/settings/files/${fileId}`;
        }

        // Fallback: assume it's a GCS filename and return direct CDN URL
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
                // Files will be publicly accessible via bucket-level IAM policy
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
            const bucket = this.storage.bucket(this.bucketName);
            const [exists] = await bucket.exists();

            if (!exists) {
                await this.storage.createBucket(this.bucketName, {
                    location: 'US',
                    storageClass: 'STANDARD',
                    uniformBucketLevelAccess: true, // Enable uniform bucket-level access
                });

                log.info(`Created bucket with uniform bucket-level access: ${this.bucketName}`);
            }

            // Set bucket-level IAM policy to allow public read access
            await this.setBucketPublicPolicy(bucket);

        } catch (error: any) {
            log.error(`Error creating bucket: ${error.message}`);
            throw error;
        }
    }

    private async setBucketPublicPolicy(bucket: any): Promise<void> {
        try {
            // Get current IAM policy
            const [policy] = await bucket.iam.getPolicy();

            // Add public read access
            const publicReadBinding = {
                role: 'roles/storage.objectViewer',
                members: ['allUsers'],
            };

            // Check if public read binding already exists
            const existingBinding = policy.bindings?.find(
                (binding: any) => binding.role === 'roles/storage.objectViewer' &&
                    binding.members?.includes('allUsers')
            );

            if (!existingBinding) {
                if (!policy.bindings) policy.bindings = [];
                policy.bindings.push(publicReadBinding);

                await bucket.iam.setPolicy(policy);
                log.info(`Set bucket IAM policy for public read access: ${this.bucketName}`);
            } else {
                log.info(`Bucket already has public read access: ${this.bucketName}`);
            }
        } catch (error: any) {
            log.warn(`Could not set bucket public policy (files may not be publicly accessible): ${error.message}`);
            // Don't throw error - the bucket still works, files just might not be publicly accessible
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

    // ========== PRIVATE BUCKET METHODS (for status/stories media) ==========

    /**
     * Upload file to PRIVATE bucket (for status/stories)
     * Returns GCS path (gs://bucket/path), not a public URL
     */
    async uploadFilePrivate(fileBuffer: Buffer, mimeType: string, fileName: string, folder: string = 'statuses'): Promise<UploadResult> {
        try {
            const bucket = this.storage.bucket(this.privateBucketName);
            const filePath = `${folder}/${fileName}`;
            const file = bucket.file(filePath);

            await file.save(fileBuffer, {
                metadata: {
                    contentType: mimeType,
                    cacheControl: 'private, max-age=3600', // 1 hour cache
                },
                // File is private by default (no public access)
            });

            // Return GCS path (gs:// format) - NOT a public URL
            const gcsPath = `gs://${this.privateBucketName}/${filePath}`;

            log.info(`File '${filePath}' uploaded successfully to PRIVATE bucket`);

            return {
                fileId: filePath, // Full path within bucket
                publicUrl: gcsPath, // GCS path (will need signed URL to access)
                fileName: filePath
            };
        } catch (error: any) {
            log.error(`Error uploading file '${fileName}' to private bucket:`, error);
            throw new Error(`Private bucket upload failed: ${error.message}`);
        }
    }

    /**
     * Generate signed URL for private file access
     * @param filePath - File path in private bucket (e.g., 'statuses/images/uuid.jpg')
     * @param options - Signed URL options
     */
    async getSignedUrl(filePath: string, options: SignedUrlOptions = {}): Promise<string> {
        try {
            const {
                expiresIn = 3600, // 1 hour default
                action = 'read'
            } = options;

            // Remove gs:// prefix if present
            const cleanPath = filePath.replace(`gs://${this.privateBucketName}/`, '');

            const bucket = this.storage.bucket(this.privateBucketName);
            const file = bucket.file(cleanPath);

            // Generate signed URL
            const [url] = await file.getSignedUrl({
                version: 'v4',
                action,
                expires: Date.now() + (expiresIn * 1000)
            });

            log.debug(`Generated signed URL for ${cleanPath} (expires in ${expiresIn}s)`);

            return url;
        } catch (error: any) {
            log.error(`Failed to generate signed URL for ${filePath}:`, error);
            throw new Error(`Failed to generate signed URL: ${error.message}`);
        }
    }

    /**
     * Generate signed URLs for multiple files (batch operation)
     */
    async getSignedUrls(filePaths: string[], options: SignedUrlOptions = {}): Promise<Map<string, string>> {
        try {
            const urlPromises = filePaths.map(async (filePath) => {
                const url = await this.getSignedUrl(filePath, options);
                return { filePath, url };
            });

            const results = await Promise.all(urlPromises);

            const urlMap = new Map<string, string>();
            results.forEach(({ filePath, url }) => {
                urlMap.set(filePath, url);
            });

            return urlMap;
        } catch (error: any) {
            log.error('Failed to generate multiple signed URLs:', error);
            throw new Error(`Failed to generate signed URLs: ${error.message}`);
        }
    }

    /**
     * Delete file from private bucket
     */
    async deleteFilePrivate(filePath: string): Promise<void> {
        try {
            // Remove gs:// prefix if present
            const cleanPath = filePath.replace(`gs://${this.privateBucketName}/`, '');

            const bucket = this.storage.bucket(this.privateBucketName);
            await bucket.file(cleanPath).delete();
            log.info(`File '${cleanPath}' deleted successfully from private bucket`);
        } catch (error: any) {
            log.error(`Error deleting file '${filePath}' from private bucket:`, error);
            throw new Error(`Private bucket deletion failed: ${error.message}`);
        }
    }

    /**
     * Check if file exists in private bucket
     */
    async fileExistsPrivate(filePath: string): Promise<boolean> {
        try {
            const cleanPath = filePath.replace(`gs://${this.privateBucketName}/`, '');
            const bucket = this.storage.bucket(this.privateBucketName);
            const file = bucket.file(cleanPath);
            const [exists] = await file.exists();
            return exists;
        } catch (error: any) {
            log.error(`Error checking file existence ${filePath}:`, error);
            return false;
        }
    }
}

export default new CloudStorageService();