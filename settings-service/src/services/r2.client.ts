import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import '../config'; // loads .env before the values below are read

/**
 * Cloudflare R2 (S3-compatible): where SBC's files live since November 2026.
 *
 * Google Cloud Storage was dropped after the project's billing was suspended on
 * 2026-11-01 and every image, video and status stopped loading. R2 charges
 * nothing for downloads, which were most of the Google bill (636 GiB of egress
 * in August 2026 against 1.23 USD of storage).
 */
export const r2Config = {
    accountId: process.env.R2_ACCOUNT_ID || '',
    publicBucket: process.env.R2_PUBLIC_BUCKET || 'sbc-media',
    privateBucket: process.env.R2_PRIVATE_BUCKET || 'sbc-status-private',
    // Custom domain of the public bucket, served and cached by Cloudflare.
    publicBaseUrl: (process.env.MEDIA_PUBLIC_BASE_URL || 'https://media.sniperbuisnesscenter.com').replace(/\/+$/, ''),
};

export const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    // Only send/verify checksums when an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
});

/** Public addresses files had before R2; still found in stored URLs. */
export const LEGACY_PUBLIC_PREFIXES = ['https://storage.googleapis.com/sbc-file-storage/'];

/** Public URL of an object key, each path segment encoded. */
export const publicUrl = (key: string): string =>
    `${r2Config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;

/**
 * `https://media…/a/b.jpg`, the old Google URL, or `a/b.jpg` -> `a/b.jpg`.
 * Callers pass ids taken straight out of URLs, so %20 and friends are common.
 */
export const publicObjectKey = (fileId: string): string => {
    const prefixes = [`${r2Config.publicBaseUrl}/`, ...LEGACY_PUBLIC_PREFIXES];
    const prefix = prefixes.find(p => fileId.startsWith(p));
    const path = prefix ? fileId.slice(prefix.length) : fileId;
    return decodeURIComponent(path.split('?')[0]);
};

/**
 * Private objects are referenced as `gs://<bucket>/<path>` in the chat and
 * status records. The scheme is kept as an opaque marker so chat-service needs
 * no change; any bucket name in it is ignored.
 */
export const privateObjectRef = (path: string): string => `gs://${r2Config.privateBucket}/${path}`;
export const privateObjectKey = (ref: string): string => ref.replace(/^gs:\/\/[^/]+\//, '');

export interface ListedObject {
    name: string;
    metadata: { size: number; timeCreated?: string; contentType?: string };
}

/** Every object in a bucket (paginated, 1,000 per request). */
export async function listAllObjects(bucket: string): Promise<ListedObject[]> {
    const objects: ListedObject[] = [];
    let token: string | undefined;
    do {
        const page = await r2.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        for (const o of page.Contents ?? []) {
            objects.push({ name: o.Key ?? '', metadata: { size: o.Size ?? 0, timeCreated: o.LastModified?.toISOString() } });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return objects;
}
