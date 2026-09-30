import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SettingsServiceClient');

const client = axios.create({
    baseURL: config.services.settingsService,
    timeout: 30000,
    headers: { 'X-Service-Secret': config.services.serviceSecret },
});

/**
 * Fetches a campaign creative so it can be perceptually hashed.
 *
 * Returns null instead of throwing: a creative we cannot fetch must degrade the
 * media check to "unknown", never fail a verification. Diffuseurs should not lose
 * a day because our file storage was briefly unreachable.
 */
export const downloadFile = async (fileId: string): Promise<Buffer | null> => {
    try {
        const { data } = await client.get(`/settings/files/${fileId}`, {
            responseType: 'arraybuffer',
            // Campaign creatives are flyers and short videos; anything larger is
            // not something we want to hold in memory during a verification.
            maxContentLength: 25 * 1024 * 1024,
        });
        return Buffer.from(data);
    } catch (err) {
        log.warn(`Could not fetch file ${fileId} from settings-service: ${(err as Error).message}`);
        return null;
    }
};

/**
 * Remove a stored file we own the lifecycle of.
 *
 * Returns whether it is gone rather than throwing: the caller is a sweep, and one
 * unreachable file must not stop it clearing the rest. It simply comes back
 * around next run.
 */
export const deleteFile = async (fileId: string): Promise<boolean> => {
    try {
        await client.delete('/settings/internal/file', { data: { fileId } });
        return true;
    } catch (err) {
        log.warn(`Could not delete file ${fileId} via settings-service: ${(err as Error).message}`);
        return false;
    }
};
