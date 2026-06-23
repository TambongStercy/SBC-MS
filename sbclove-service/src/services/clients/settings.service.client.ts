import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SettingsServiceClient');

interface UploadResponse {
    success: boolean;
    data?: {
        fileId: string;
        url?: string;
    };
    message?: string;
}

class SettingsServiceClient {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: config.services.settingsService,
            timeout: 15000, // uploads can take longer
            headers: {
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'sbclove-service',
            },
        });
    }

    /**
     * Uploads a SBCLOVE photo to the settings-service PRIVATE bucket
     * (profile photos are privacy-sensitive). Returns the stored file id.
     *
     * @param fileBuffer raw image bytes
     * @param fileName   original file name (for content-type inference)
     * @param mimeType   image mime type
     */
    async uploadPrivatePhoto(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
        const form = new FormData();
        form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
        form.append('folderName', 'sbclove');

        const response = await this.client.post<UploadResponse>('/settings/internal/upload-private', form, {
            headers: form.getHeaders(),
        });

        if (!response.data?.success || !response.data.data?.fileId) {
            log.error('Settings-service upload returned no fileId', { data: response.data });
            throw new Error('Photo upload failed.');
        }
        return response.data.data.fileId;
    }

    /**
     * Builds the public proxy URL for a stored file id (served by settings-service).
     */
    getFileUrl(fileId: string): string {
        return `${config.services.settingsService}/settings/files/${fileId}`;
    }
}

export const settingsServiceClient = new SettingsServiceClient();
