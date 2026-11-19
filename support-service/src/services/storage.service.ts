import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config';
import { DependencyError } from '../utils/errors';

/**
 * Private attachment storage on Cloudflare R2 (same env names as
 * settings-service). Files are only ever served by presigned GET URLs.
 * Signing date and expiry are snapped to the hour (CLAUDE.md: a fresh
 * signature per call defeats every cache).
 */
export interface StorageDriver {
    put(key: string, body: Buffer, contentType: string): Promise<void>;
    presignGet(key: string, filename: string): Promise<string>;
}

class R2Driver implements StorageDriver {
    private client = new S3Client({
        region: 'auto',
        endpoint: config.r2.endpoint || `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
        // MinIO (R2_ENDPOINT, local dev) serves buckets by path, not by sub-domain.
        forcePathStyle: Boolean(config.r2.endpoint),
        credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });

    async put(key: string, body: Buffer, contentType: string) {
        try {
            await this.client.send(new PutObjectCommand({ Bucket: config.r2.privateBucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=3600' }));
        } catch {
            throw new DependencyError('storage');
        }
    }

    async presignGet(key: string, filename: string) {
        const hour = 3600 * 1000;
        const signingDate = new Date(Math.floor(Date.now() / hour) * hour);
        const cmd = new GetObjectCommand({
            Bucket: config.r2.privateBucket, Key: key,
            ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`,
        });
        // Valid from the start of this hour for two hours: always ≥ 1 h left, same URL all hour.
        return getSignedUrl(this.client, cmd, { expiresIn: 7200, signingDate });
    }
}

class UnconfiguredDriver implements StorageDriver {
    async put(): Promise<void> { throw new DependencyError('storage'); }
    async presignGet(): Promise<string> { throw new DependencyError('storage'); }
}

let driver: StorageDriver = (config.r2.accountId || config.r2.endpoint) && config.r2.accessKeyId ? new R2Driver() : new UnconfiguredDriver();

export const storage = (): StorageDriver => driver;
/** Tests replace the driver with an in-memory one. */
export const setStorageDriver = (d: StorageDriver) => { driver = d; };
