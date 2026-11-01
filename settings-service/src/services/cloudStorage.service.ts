import { PassThrough, Readable } from 'stream';
import {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import logger from '../utils/logger';
import {
    r2,
    r2Config,
    publicUrl,
    publicObjectKey,
    privateObjectRef,
    privateObjectKey,
} from './r2.client';

const log = logger.getLogger('CloudStorageService');

/** How long browsers and Cloudflare may keep a stored file. */
export const LONG_CACHE_CONTROL = 'public, max-age=31536000';
/**
 * A video stored as it arrived, about to be replaced by its compressed copy
 * under the same name. Kept short so no cache holds on to the big version.
 */
export const PENDING_CACHE_CONTROL = 'public, max-age=60';

interface UploadResult {
    fileId: string;
    publicUrl: string;
    fileName: string;
}

interface SignedUrlOptions {
    expiresIn?: number; // Expiration in seconds (default: 3600 = 1 hour)
    action?: 'read' | 'write' | 'delete';
}

const isNotFound = (error: any): boolean =>
    error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;

/** S3 CopySource: bucket and key, each path segment encoded. */
const copySource = (bucket: string, key: string): string =>
    `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Object storage for every file SBC serves, on Cloudflare R2 (see r2.client.ts).
 * The public bucket holds avatars, products, creatives and videos, served from
 * its custom domain; the private bucket holds statuses and chat documents,
 * reachable only by signed URL.
 */
class CloudStorageService {
    private bucketName = r2Config.publicBucket;
    private privateBucketName = r2Config.privateBucket;

    constructor() {
        log.info(`Cloud Storage service initialized (R2: ${this.bucketName}, ${this.privateBucketName}).`);
    }

    // Kept for its callers; Google Drive is no longer an upload target.
    async uploadFileHybrid(
        fileBuffer: Buffer,
        mimeType: string,
        fileName: string,
        folderType?: string,
        cacheControl: string = LONG_CACHE_CONTROL,
    ): Promise<UploadResult> {
        return this.uploadFile(fileBuffer, mimeType, fileName, folderType, cacheControl);
    }

    // Public URL for a stored object; proxy URL for a legacy Google Drive id.
    async getFileUrl(fileId: string): Promise<string> {
        if (fileId.length === 33 && fileId.startsWith('1') && !fileId.includes('/') && !fileId.includes('.')) {
            return `/api/settings/files/${fileId}`;
        }
        return publicUrl(publicObjectKey(fileId));
    }

    async uploadFile(
        fileBuffer: Buffer,
        mimeType: string,
        fileName: string,
        folderType?: string,
        cacheControl: string = LONG_CACHE_CONTROL,
    ): Promise<UploadResult> {
        try {
            await r2.send(new PutObjectCommand({
                Bucket: this.bucketName,
                Key: fileName,
                Body: fileBuffer,
                ContentType: mimeType,
                CacheControl: cacheControl,
            }));

            log.info(`File '${fileName}' uploaded successfully to Cloud Storage`);
            return {
                fileId: fileName, // the object key serves as ID
                publicUrl: publicUrl(fileName),
                fileName,
            };
        } catch (error: any) {
            log.error(`Error uploading file '${fileName}' to Cloud Storage:`, error);
            throw new Error(`Cloud Storage upload failed: ${error.message}`);
        }
    }

    async deleteFile(fileName: string): Promise<void> {
        try {
            await r2.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: publicObjectKey(fileName) }));
            log.info(`File '${fileName}' deleted successfully from Cloud Storage`);
        } catch (error: any) {
            log.error(`Error deleting file '${fileName}' from Cloud Storage:`, error);
            throw new Error(`Cloud Storage deletion failed: ${error.message}`);
        }
    }

    // ========== PRIVATE BUCKET METHODS (for status/stories media) ==========

    /**
     * Upload file to PRIVATE bucket (for status/stories)
     * Returns a `gs://bucket/path` reference, not a public URL.
     */
    async uploadFilePrivate(fileBuffer: Buffer, mimeType: string, fileName: string, folder: string = 'statuses'): Promise<UploadResult> {
        try {
            const filePath = `${folder}/${fileName}`;
            await r2.send(new PutObjectCommand({
                Bucket: this.privateBucketName,
                Key: filePath,
                Body: fileBuffer,
                ContentType: mimeType,
                // A status is immutable and lives 24h, so the browser can hold
                // it for its whole life. At 1h, a viewer who came back in the
                // afternoon re-downloaded the same video they had already
                // fetched that morning. Still private: only whoever holds a
                // valid signed URL can fetch it in the first place.
                CacheControl: 'private, max-age=86400, immutable',
            }));

            log.info(`File '${filePath}' uploaded successfully to PRIVATE bucket`);
            return {
                fileId: filePath, // Full path within bucket
                publicUrl: privateObjectRef(filePath), // needs a signed URL to access
                fileName: filePath,
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
            const { expiresIn = 3600, action = 'read' } = options;
            const key = privateObjectKey(filePath);

            // The signing time and the expiry are both snapped to hourly
            // boundaries, so the SAME object yields the SAME URL for everyone
            // who asks within that hour.
            //
            // A signature over the current time puts a different timestamp in
            // every URL. Browser caches are keyed on the URL, so nothing was ever
            // a cache hit: each time a viewer opened the status feed, every image
            // and video in it was pulled from the bucket again in full.
            //
            // Expiry rounded UP, so the URL is always valid for at least expiresIn.
            const HOUR_MS = 60 * 60 * 1000;
            const now = Date.now();
            const signingDate = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
            const expires = Math.ceil((now + expiresIn * 1000) / HOUR_MS) * HOUR_MS;

            const target = { Bucket: this.privateBucketName, Key: key };
            const command = action === 'write'
                ? new PutObjectCommand(target)
                : action === 'delete'
                    ? new DeleteObjectCommand(target)
                    : new GetObjectCommand(target);

            const url = await presign(r2, command, {
                signingDate,
                expiresIn: Math.round((expires - signingDate.getTime()) / 1000),
            });

            log.debug(`Generated signed URL for ${key} (expires in ${expiresIn}s)`);
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
            const results = await Promise.all(
                filePaths.map(async (filePath) => ({ filePath, url: await this.getSignedUrl(filePath, options) }))
            );
            return new Map(results.map(({ filePath, url }) => [filePath, url]));
        } catch (error: any) {
            log.error('Failed to generate multiple signed URLs:', error);
            throw new Error(`Failed to generate signed URLs: ${error.message}`);
        }
    }

    /**
     * Delete file from private bucket. A file that is already gone is the
     * outcome the caller wanted: otherwise the status-cleanup job treats it as
     * "retry later" and re-attempts that status every hour forever.
     */
    async deleteFilePrivate(filePath: string): Promise<void> {
        try {
            const key = privateObjectKey(filePath);
            await r2.send(new DeleteObjectCommand({ Bucket: this.privateBucketName, Key: key }));
            log.info(`File '${key}' deleted successfully from private bucket`);
        } catch (error: any) {
            if (isNotFound(error)) return;
            log.error(`Error deleting file '${filePath}' from private bucket:`, error);
            throw new Error(`Private bucket deletion failed: ${error.message}`);
        }
    }

    /** Read a whole object from the PUBLIC bucket (used to resize images). */
    async downloadFile(fileId: string): Promise<Buffer> {
        const out = await r2.send(new GetObjectCommand({ Bucket: this.bucketName, Key: publicObjectKey(fileId) }));
        return Buffer.from(await out.Body!.transformToByteArray());
    }

    /** Type and size, without pulling any of the bytes. */
    async statFile(fileId: string): Promise<{ contentType?: string; size?: string; cacheControl?: string; updated?: string }> {
        const head = await r2.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: publicObjectKey(fileId) }));
        return {
            contentType: head.ContentType,
            size: head.ContentLength != null ? String(head.ContentLength) : undefined,
            cacheControl: head.CacheControl,
            updated: head.LastModified?.toISOString(),
        };
    }

    /**
     * Changes how long caches may keep an object, without re-uploading it from
     * here: S3 has no metadata-only update, so the object is copied onto itself
     * with the new header (content type kept).
     */
    async setCacheControl(fileId: string, cacheControl: string): Promise<void> {
        const key = publicObjectKey(fileId);
        const head = await r2.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
        await r2.send(new CopyObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            CopySource: copySource(this.bucketName, key),
            MetadataDirective: 'REPLACE',
            ContentType: head.ContentType,
            CacheControl: cacheControl,
        }));
    }

    /**
     * A read stream over the object, optionally over one byte range.
     *
     * The range matters for video: a <video> element seeks by asking for ranges,
     * and a server that always returns the whole file cannot be scrubbed.
     * Returned at once; an R2 failure arrives as the stream's 'error' event.
     */
    streamFile(fileId: string, range?: { start?: number; end?: number }): NodeJS.ReadableStream {
        const out = new PassThrough();
        const Range = range?.start !== undefined ? `bytes=${range.start}-${range.end ?? ''}` : undefined;
        r2.send(new GetObjectCommand({ Bucket: this.bucketName, Key: publicObjectKey(fileId), Range }))
            .then(res => {
                const body = res.Body as Readable;
                body.on('error', err => out.destroy(err));
                body.pipe(out);
            })
            .catch(err => out.destroy(err));
        return out;
    }

    /**
     * Check if file exists in private bucket
     */
    async fileExistsPrivate(filePath: string): Promise<boolean> {
        try {
            await r2.send(new HeadObjectCommand({ Bucket: this.privateBucketName, Key: privateObjectKey(filePath) }));
            return true;
        } catch (error: any) {
            if (!isNotFound(error)) log.error(`Error checking file existence ${filePath}:`, error);
            return false;
        }
    }
}

export default new CloudStorageService();
