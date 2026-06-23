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
        fileName?: string;
        mimeType?: string;
        size?: number;
    };
    message?: string;
}

export interface UploadedPhoto {
    fileId: string;
    url?: string;
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
     * Uploads a SBCLOVE photo via settings-service (public bucket, served by the
     * /settings/files proxy). The returned fileId is a random UUID-based key, so
     * the clear image is never reachable unless the API hands out its id —
     * blurred/clear selection is enforced at the API layer (spec §3, §6).
     *
     * NOTE (future hardening): switch to the private bucket + signed URLs for
     * stronger access control once per-view signed-URL latency is acceptable.
     *
     * @param fileBuffer raw image bytes
     * @param fileName   original file name (for content-type inference)
     * @param mimeType   image mime type
     */
    async uploadPhoto(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<UploadedPhoto> {
        const form = new FormData();
        form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
        form.append('folderName', 'sbclove');

        const response = await this.client.post<UploadResponse>('/settings/internal/upload', form, {
            headers: form.getHeaders(),
        });

        if (!response.data?.success || !response.data.data?.fileId) {
            log.error('Settings-service upload returned no fileId', { data: response.data });
            throw new Error('Photo upload failed.');
        }
        return { fileId: response.data.data.fileId, url: response.data.data.url };
    }

    /**
     * Builds the public proxy URL for a stored file id (served by settings-service).
     */
    getFileUrl(fileId: string): string {
        return `${config.services.settingsService}/settings/files/${fileId}`;
    }
}

export const settingsServiceClient = new SettingsServiceClient();
