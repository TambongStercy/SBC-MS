import axios, { AxiosInstance } from 'axios';
import config from '../../config'; // Assuming config is one level up from services
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import FormData from 'form-data'; // Ensure FormData is imported

const log = logger.getLogger('SettingsServiceClient');

// Define expected response structure for file upload
interface FileUploadResponseData {
    fileId: string;
    url?: string; // URL might be returned by settings service
    message?: string;
}

// Define the payload structure for JSON/Base64 upload
interface FileUploadPayload {
    fileName: string;
    mimeType: string;
    fileContent: string; // Base64 encoded file content
    folderName?: string; // Optional: Specify Google Drive folder (e.g., 'product_images')
}

interface ServiceResponse<T> {
    success: boolean;
    data?: T;
    message?: string;
}

class SettingsServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.settingsServiceUrl, // Use URL from product-service config
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'product-service',
            },
        });
        log.info('Settings Service client initialized');
    }

    /**
     * Uploads a file to the settings service internal endpoint.
     * @param fileBuffer The file content as a Buffer.
     * @param mimeType The MIME type of the file.
     * @param originalName The original name of the file.
     * @param folderName Optional target folder name ('profile-picture', 'product-docs').
     * @returns The file ID.
     */
    async uploadFile(
        fileBuffer: Buffer,
        mimeType: string,
        originalName: string,
        folderName?: 'profile-picture' | 'product-docs' // Add optional folderName
    ): Promise<{ fileId: string }> {
        // Target the new internal endpoint
        const url = '/settings/internal/upload';
        log.info(`Uploading file "${originalName}" (${mimeType}) to internal endpoint ${this.apiClient.defaults.baseURL}${url}, Folder: ${folderName || 'default'}`);

        // Create FormData
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: originalName,
            contentType: mimeType,
        });

        // Add folderName to FormData if provided
        if (folderName) {
            formData.append('folderName', folderName);
        }

        try {
            // Send as multipart/form-data
            const response = await this.apiClient.post<ServiceResponse<FileUploadResponseData>>(
                url,
                formData, // Send the FormData object
                {
                    headers: {
                        ...formData.getHeaders(), // Let axios set Content-Type and boundary
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'X-Service-Name': 'product-service',
                    }
                }
            );

            // Settings service internal endpoint returns 200 OK on success
            if (response.status === 200 && response.data?.success && response.data.data?.fileId) {
                log.info(`File uploaded successfully. File ID: ${response.data.data.fileId}`);
                return { fileId: response.data.data.fileId };
            } else {
                log.warn('Settings service responded with failure or unexpected structure for file upload.', {
                    status: response.status,
                    responseData: response.data
                });
                throw new AppError(response.data?.message || 'Failed to upload file via settings service', response.status);
            }
        } catch (error: any) {
            log.error(`Error calling settings service ${url}: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error('Settings Service Error Response (uploadFile):', { status: error.response.status, data: error.response.data });
                throw new AppError(error.response.data?.message || 'Settings service communication error', error.response.status);
            } else {
                throw new AppError('Settings service communication error', 500);
            }
        }
    }

    // Add other methods to interact with settings-service if needed (e.g., getFileStream, deleteFile)
}

export const settingsServiceClient = new SettingsServiceClient(); 