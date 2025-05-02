import { google, drive_v3 } from 'googleapis';
import stream from 'stream';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('GoogleDriveService');

// Define interface for the upload result
interface UploadResult {
    fileId: string;
    webViewLink?: string | null;
    webContentLink?: string | null;
    thumbnailLink?: string | null; // Added thumbnail link
}

class GoogleDriveService {
    private drive: drive_v3.Drive;
    private parentFolderId = config.googleDrive.parentFolderId;

    constructor() {
        if (!config.googleDrive.clientEmail || !config.googleDrive.privateKey) {
            log.error('Google Drive client email or private key is missing in configuration.');
            throw new Error('Google Drive configuration incomplete.');
        }

        const jwtClient = new google.auth.JWT(
            config.googleDrive.clientEmail,
            undefined,
            config.googleDrive.privateKey,
            ['https://www.googleapis.com/auth/drive'], // Scope: full drive access
        );

        this.drive = google.drive({ version: 'v3', auth: jwtClient });
        log.info('Google Drive service initialized.');
    }

    /**
     * Uploads a file to Google Drive and makes it publicly readable.
     * @param fileBuffer The file content as a Buffer.
     * @param mimeType The MIME type of the file.
     * @param fileName The desired name for the file in Google Drive.
     * @param parentFolderId The ID of the parent folder in Google Drive.
     * @returns An object containing the Google Drive file ID and public links.
     */
    async uploadFile(fileBuffer: Buffer, mimeType: string, fileName: string, parentFolderId?: string): Promise<UploadResult> {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);

        const fileMetadata: any = {
            name: fileName,
            ...(parentFolderId && { parents: [parentFolderId] }),
        };

        let fileId: string | null = null;

        try {
            log.debug(`Uploading file '${fileName}' (${mimeType}) to Google Drive...`);
            const uploadResponse = await this.drive.files.create({
                requestBody: fileMetadata,
                media: {
                    mimeType: mimeType,
                    body: bufferStream,
                },
                fields: 'id',
            });

            fileId = uploadResponse.data.id as string;

            if (!fileId) {
                throw new Error('Failed to get file ID after upload.');
            }

            log.info(`File '${fileName}' uploaded successfully. File ID: ${fileId}`);

            await this.makeFilePublic(fileId);

            log.debug(`Fetching public links for file ID: ${fileId}`);
            const fileMetaResponse = await this.drive.files.get({
                fileId: fileId,
                fields: 'webViewLink, webContentLink, thumbnailLink',
            });

            return {
                fileId: fileId,
                webViewLink: fileMetaResponse.data.webViewLink,
                webContentLink: fileMetaResponse.data.webContentLink,
                thumbnailLink: fileMetaResponse.data.thumbnailLink,
            };
        } catch (error: any) {
            log.error(`Error during upload process for file '${fileName}':`, error);
            if (fileId) {
                log.warn(`Upload process failed after file creation (${fileId}). Attempting to clean up.`);
                this.deleteFile(fileId).catch(deleteError => {
                    log.error(`Failed to clean up partially uploaded file ${fileId}:`, deleteError);
                });
            }
            throw new Error(`Google Drive upload process failed: ${error.message}`);
        }
    }

    /**
     * Deletes a file from Google Drive.
     * @param fileId The ID of the file to delete.
     */
    async deleteFile(fileId: string): Promise<void> {
        try {
            log.debug(`Deleting file with ID '${fileId}' from Google Drive...`);
            await this.drive.files.delete({ fileId: fileId });
            log.info(`File ID '${fileId}' deleted successfully.`);
        } catch (error: any) {
            if (error.code === 404) {
                log.warn(`Attempted to delete non-existent file ID '${fileId}'.`);
                return;
            }
            log.error(`Error deleting file ID '${fileId}' from Google Drive:`, error);
            throw new Error(`Google Drive deletion failed: ${error.message}`);
        }
    }

    /**
     * Makes a file publicly readable in Google Drive.
     * Note: This grants read access to ANYONE with the link.
     * Consider if a more restricted permission model is needed.
     * @param fileId The ID of the file to make public.
     */
    async makeFilePublic(fileId: string): Promise<void> {
        try {
            log.debug(`Making file ID '${fileId}' public...`);
            await this.drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone',
                },
            });
            log.info(`File ID '${fileId}' successfully made public.`);
        } catch (error: any) {
            log.error(`Error making file ID '${fileId}' public:`, error);
            throw new Error(`Failed to set public permissions: ${error.message}`);
        }
    }

    /**
     * Generates a proxy URL for accessing the file via this service.
     * @param fileId The Google Drive file ID.
     * @returns A URL pointing to the proxy endpoint.
     */
    getProxyFileUrl(fileId: string): string {
        return `/api/settings/files/${fileId}`;
    }

    /**
    * Gets the content of a file from Google Drive.
    * @param fileId The ID of the file to retrieve.
    * @returns A Promise resolving to the file content stream and metadata.
    */
    async getFileContent(fileId: string): Promise<{ stream: stream.Readable, mimeType: string | null | undefined, size: string | null | undefined }> {
        try {
            log.debug(`Fetching content for file ID '${fileId}'...`);
            const metaResponse = await this.drive.files.get({
                fileId: fileId,
                fields: 'mimeType, size',
            });

            const response = await this.drive.files.get(
                { fileId: fileId, alt: 'media' },
                { responseType: 'stream' }
            );

            return {
                stream: response.data as stream.Readable,
                mimeType: metaResponse.data.mimeType,
                size: metaResponse.data.size
            };
        } catch (error: any) {
            if (error.code === 404) {
                log.warn(`File ID '${fileId}' not found when fetching content.`);
                throw new Error('File not found');
            }
            log.error(`Error fetching content for file ID '${fileId}':`, error);
            throw new Error(`Failed to get file content: ${error.message}`);
        }
    }
}

export default new GoogleDriveService(); 