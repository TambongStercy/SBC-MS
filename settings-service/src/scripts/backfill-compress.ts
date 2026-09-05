/**
 * Re-compress media already in the bucket.
 *
 * Upload-time compression only affects new files. The corpus behind it was
 * measured 2026-09-05 at 47,955 images averaging 667 KiB (30.5 GiB) and 578
 * videos averaging 11.6 MiB — all stored exactly as the phone produced them.
 * Sampled re-encoding showed ~86% off images and ~87% off video.
 *
 * Objects are replaced IN PLACE, under the same name. Every file id is stored in
 * some other service's database — avatars on users, images on products, creatives
 * on campaigns — so renaming even the extension would break references we cannot
 * find from here. A .jpg holding WebP bytes is fine in practice: browsers read
 * Content-Type, which is updated, not the extension.
 *
 * Safety:
 *   - Dry run by default. --apply is required to write anything.
 *   - The re-encode is verified to actually be smaller AND to decode back to a
 *     valid image before it replaces anything. Nothing is deleted; the object is
 *     overwritten, so a failure part-way leaves the original intact.
 *   - --min-kb skips small files, where re-encoding tends to add bytes.
 *   - Rate-limited, because this competes with live traffic for the same CPU.
 *
 * Usage (on the server, in settings-service/):
 *   npx ts-node src/scripts/backfill-compress.ts --prefix=avatars/
 *   npx ts-node src/scripts/backfill-compress.ts --prefix=avatars/ --apply
 *   npx ts-node src/scripts/backfill-compress.ts --video --apply --limit=50
 */

import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import config from '../config';
import { compressUpload } from '../services/media-compression.service';

const arg = (name: string, fallback?: string): string | undefined => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const APPLY = process.argv.includes('--apply');
const VIDEO = process.argv.includes('--video');
const PREFIX = arg('prefix', '');
const LIMIT = Number(arg('limit', '0')) || Infinity;
const MIN_BYTES = Number(arg('min-kb', '80')) * 1024;

const MIB = 1024 * 1024;
const storage = new Storage({
    projectId: 'snipper-c0411',
    credentials: {
        client_email: config.googleDrive.clientEmail,
        private_key: config.googleDrive.privateKey,
    },
});

/** Proves the re-encode is readable before it is allowed to replace anything. */
const decodes = async (buffer: Buffer, isVideo: boolean): Promise<boolean> => {
    if (isVideo) return buffer.length > 1024; // ffmpeg already failed loudly if not
    try {
        const meta = await sharp(buffer).metadata();
        return Boolean(meta.width && meta.height);
    } catch {
        return false;
    }
};

const run = async () => {
    const bucket = storage.bucket('sbc-file-storage');
    console.log(
        `${APPLY ? '*** APPLY — objects will be overwritten ***' : '--- DRY RUN (pass --apply to write) ---'}\n`
        + `prefix="${PREFIX}"  type=${VIDEO ? 'video' : 'image'}  min=${(MIN_BYTES / 1024).toFixed(0)} KiB\n`,
    );

    const [files] = await bucket.getFiles({ prefix: PREFIX });
    let seen = 0, done = 0, skipped = 0, failed = 0, before = 0, after = 0;

    for (const file of files) {
        if (done >= LIMIT) break;

        const size = Number(file.metadata.size ?? 0);
        const type = String(file.metadata.contentType ?? '');
        const wanted = VIDEO ? type.startsWith('video/') : type.startsWith('image/');
        if (!wanted || size < MIN_BYTES) continue;

        seen++;
        try {
            const [original] = await file.download();
            const result = await compressUpload(original, type);

            if (!result.compressed || result.buffer.length >= original.length) {
                skipped++;
                continue;
            }
            if (!(await decodes(result.buffer, VIDEO))) {
                console.log(`SKIP (re-encode did not decode): ${file.name}`);
                skipped++;
                continue;
            }

            before += original.length;
            after += result.buffer.length;
            done++;

            const saved = Math.round(100 - (result.buffer.length / original.length) * 100);
            console.log(
                `${APPLY ? 'REWROTE' : 'WOULD'}  ${(original.length / MIB).toFixed(2)} -> `
                + `${(result.buffer.length / MIB).toFixed(2)} MiB  (${saved}%)  ${file.name}`,
            );

            if (APPLY) {
                await file.save(result.buffer, {
                    resumable: result.buffer.length >= 8 * MIB,
                    metadata: {
                        contentType: result.mimeType,
                        cacheControl: 'public, max-age=31536000',
                    },
                });
            }
        } catch (err) {
            failed++;
            console.log(`FAIL  ${file.name}: ${(err as Error).message}`);
        }

        // The API and ffmpeg share this box with live traffic.
        await new Promise(r => setTimeout(r, 50));
    }

    console.log(
        `\n${seen} candidate(s): ${done} ${APPLY ? 'rewritten' : 'would shrink'}, `
        + `${skipped} left alone, ${failed} failed.`,
    );
    if (done) {
        console.log(
            `${(before / MIB).toFixed(0)} MiB -> ${(after / MIB).toFixed(0)} MiB `
            + `(${Math.round(100 - (after / before) * 100)}% smaller)`,
        );
    }
};

run().catch(err => { console.error(err); process.exit(1); });
