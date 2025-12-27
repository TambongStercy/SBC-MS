import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SettingsServiceClient');

export interface UploadResult {
    fileId: string;
    gcsPath: string; // gs://bucket/path format
    fileName: string;
    mimeType: string;
    size: number;
}

class SettingsServiceClient {
    private apiClient: AxiosInstance;
    private static readonly DEFAULT_TIMEOUT = 30000; // 30s for regular requests
    private static readonly UPLOAD_TIMEOUT = 120000; // 2 minutes for file uploads

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.settingsServiceUrl,
            timeout: SettingsServiceClient.DEFAULT_TIMEOUT,
            headers: {
                'X-Service-Name': 'chat-service',
                'Authorization': `Bearer ${config.services.serviceSecret}`
            }
        });
        log.info('Settings service client initialized');
    }

    /**
     * Upload file to PRIVATE bucket (for status/stories and chat documents)
     * Uses extended timeout for large file uploads
     */
    async uploadFilePrivate(fileBuffer: Buffer, mimeType: string, originalName: string, folder: string = 'statuses'): Promise<UploadResult> {
        try {
            const formData = new FormData();
            formData.append('file', fileBuffer, {
                filename: originalName,
                contentType: mimeType
            });
            formData.append('folder', folder);

            log.debug(`Starting upload of ${originalName} (${(fileBuffer.length / 1024).toFixed(2)} KB) to ${folder}`);

            const response = await this.apiClient.post('/settings/internal/upload-private', formData, {
                headers: {
                    ...formData.getHeaders()
                },
                timeout: SettingsServiceClient.UPLOAD_TIMEOUT // Extended timeout for uploads
            });

            if (response.data.success && response.data.data) {
                log.debug(`Upload completed successfully for ${originalName}`);
                return response.data.data;
            }

            throw new Error('Failed to upload file: Invalid response');
        } catch (error: any) {
            log.error('Error uploading file to settings-service:', error.message);
            throw new Error(`File upload failed: ${error.message}`);
        }
    }

    /**
     * Generate signed URL for a single private file
     */
    async getSignedUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
        try {
            const response = await this.apiClient.post('/settings/internal/signed-url', {
                filePath,
                expiresIn
            });

            if (response.data.success && response.data.data && response.data.data.signedUrl) {
                return response.data.data.signedUrl;
            }

            throw new Error('Failed to generate signed URL: Invalid response');
        } catch (error: any) {
            log.error(`Error generating signed URL for ${filePath}:`, error.message);
            throw new Error(`Signed URL generation failed: ${error.message}`);
        }
    }

    /**
     * Generate signed URLs for multiple files (batch operation)
     */
    async getSignedUrls(filePaths: string[], expiresIn: number = 3600): Promise<Map<string, string>> {
        try {
            const response = await this.apiClient.post('/settings/internal/signed-urls', {
                filePaths,
                expiresIn
            });

            if (response.data.success && response.data.data && response.data.data.urls) {
                const urlMap = new Map<string, string>();
                const urls = response.data.data.urls as Record<string, string>;

                Object.entries(urls).forEach(([filePath, url]) => {
                    urlMap.set(filePath, url);
                });

                return urlMap;
            }

            throw new Error('Failed to generate signed URLs: Invalid response');
        } catch (error: any) {
            log.error('Error generating batch signed URLs:', error.message);
            throw new Error(`Batch signed URL generation failed: ${error.message}`);
        }
    }

    /**
     * Delete file from private bucket
     */
    async deleteFilePrivate(filePath: string): Promise<void> {
        try {
            const response = await this.apiClient.delete('/settings/internal/file-private', {
                data: { filePath }
            });

            if (!response.data.success) {
                throw new Error('Failed to delete file: Invalid response');
            }

            log.info(`File deleted successfully: ${filePath}`);
        } catch (error: any) {
            log.error(`Error deleting file ${filePath}:`, error.message);
            throw new Error(`File deletion failed: ${error.message}`);
        }
    }

    /**
     * Extract file path from GCS URL (gs://bucket/path)
     */
    extractFilePath(gcsUrl: string): string {
        if (gcsUrl.startsWith('gs://')) {
            // Remove gs://bucket-name/ prefix
            const parts = gcsUrl.replace('gs://', '').split('/');
            parts.shift(); // Remove bucket name
            return parts.join('/');
        }
        return gcsUrl; // Already a clean path
    }
}

export const settingsServiceClient = new SettingsServiceClient();
