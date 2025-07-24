import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import FormData from 'form-data';

const log = logger.getLogger('SettingsServiceClient');

// Define expected response structure for count
interface CountResponse {
    success: boolean;
    data?: { count: number };
    message?: string;
}

// Define expected response structure for admin balance
interface BalanceResponse {
    success: boolean;
    data?: { balance: number };
    message?: string;
}

interface FileUploadPayload {
    fileName: string;
    mimeType: string;
    fileContent: string; // Base64 encoded file content
    folderName?: string; // Optional: Specify Google Drive folder
}

interface FileUploadResponseData {
    fileId: string;
    url: string; // URL is returned by settings service
    message?: string;
}

interface ServiceResponse<T> {
    success: boolean;
    data?: T;
    message?: string;
}

class SettingsServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        const baseURL = config.services.settingsService;
        if (!baseURL) {
            log.warn('Settings Service URL is not configured. Settings client will not function.');
        }
        this.apiClient = axios.create({
            baseURL: baseURL || undefined,
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'user-service',
            },
        });
        log.info(`Settings service client initialized. Base URL: ${baseURL || 'NOT SET'}`);
    }

    /**
     * Fetches the total count of events.
     * Assumes endpoint: GET /api/stats/total-events
     */
    async getTotalEvents(): Promise<number> {
        const url = '/stats/total-events';
        if (!this.apiClient.defaults.baseURL) {
            log.warn('Cannot get total events: Settings Service URL not configured.');
            return 0; // Return 0 if service is not configured
        }

        log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<CountResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.count === 'number') {
                log.info(`Successfully fetched total events: ${response.data.data.count}`);
                return response.data.data.count;
            } else {
                log.warn('Settings service responded with failure or unexpected structure for total events count.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0;
            }
        } catch (error: any) {
            log.error(`Error calling settings service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Settings Service Error Response (getTotalEvents):', { status: error.response?.status, data: error.response?.data });
            }
            return 0;
        }
    }

    /**
     * Fetches the admin balance.
     * Assumes endpoint: GET /api/stats/admin-balance
     */
    async getAdminBalance(): Promise<number> {
        const url = '/stats/admin-balance';
        if (!this.apiClient.defaults.baseURL) {
            log.warn('Cannot get admin balance: Settings Service URL not configured.');
            return 0; // Return 0 if service is not configured
        }

        log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<BalanceResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.balance === 'number') {
                log.info(`Successfully fetched admin balance: ${response.data.data.balance}`);
                return response.data.data.balance;
            } else {
                log.warn('Settings service responded with failure or unexpected structure for admin balance.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0;
            }
        } catch (error: any) {
            log.error(`Error calling settings service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Settings Service Error Response (getAdminBalance):', { status: error.response?.status, data: error.response?.data });
            }
            return 0;
        }
    }

    /**
     * Uploads a file to the settings service internal endpoint.
     * @param fileBuffer The file content as a Buffer.
     * @param mimeType The MIME type of the file.
     * @param originalName The original name of the file.
     * @param folderName Optional target folder name ('profile-picture', 'product-docs').
     * @returns The full FileUploadResponseData (including fileId).
     */
    async uploadFile(
        fileBuffer: Buffer,
        mimeType: string,
        originalName: string,
        folderName?: 'avatars' | 'documents' | 'products'
    ): Promise<FileUploadResponseData> {
        const url = '/settings/internal/upload';
        log.info(`Uploading file "${originalName}" (${mimeType}) to internal endpoint ${this.apiClient.defaults.baseURL}${url}, Folder: ${folderName || 'default'}`);

        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: originalName,
            contentType: mimeType,
        });

        if (folderName) {
            formData.append('folderName', folderName);
        }

        try {
            const response = await this.apiClient.post<ServiceResponse<FileUploadResponseData>>(
                url,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'X-Service-Name': 'user-service',
                    }
                }
            );

            if (response.status === 200 && response.data?.success && response.data.data) {
                log.info(`File uploaded successfully. File ID: ${response.data.data.fileId}, URL: ${response.data.data.url}`);
                return response.data.data;
            } else {
                log.warn('Settings service responded with failure or unexpected structure for file upload.', {
                    status: response.status,
                    responseData: response.data
                });
                throw new AppError(response.data?.message || 'Failed to upload file via settings service', response.status);
            }
        } catch (error: any) {
            log.error(`Error calling settings service ${url} from user-service: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error('Settings Service Error Response (uploadFile - user-service client):', { status: error.response.status, data: error.response.data });
                throw new AppError(error.response.data?.message || 'Settings service communication error', error.response.status);
            }
            throw new AppError('Settings service communication error', 500);
        }
    }

    // TODO: Add getFileStream or similar method for the proxy route
    async getFileStream(fileId: string): Promise<NodeJS.ReadableStream> {
        const url = `/files/download/${fileId}`; // Assumed endpoint
        log.info(`Requesting file stream for ${fileId} from settings service at ${url}`);
        try {
            // Important: Set responseType to 'stream'
            const response = await this.apiClient.get<NodeJS.ReadableStream>(url, {
                responseType: 'stream'
            });
            // Axios streams might need specific handling depending on version
            // Ensure the caller handles stream errors
            return response.data;
        } catch (error: any) {
            log.error(`Error fetching file stream from settings service for ${fileId}: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error('Settings Service Stream Error:', { status: error.response.status });
                // Attempt to read error message from stream if possible (might be tricky)
                // throw new AppError(error.response.data?.message || 'Settings service stream error', error.response.status);
            }
            throw new AppError('Failed to get file stream from settings service', 500);
        }
    }

    // Add other methods to interact with settings-service as needed
}

export const settingsService = new SettingsServiceClient(); 