import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import logger from '../utils/logger';

const log = logger.getLogger('MediaCompression');

/**
 * Shrink what we store, at the moment it arrives.
 *
 * Nothing was ever compressed on upload: `file.buffer` went straight to the
 * bucket. Measured 2026-09-05 — 47,955 images averaging 667 KiB (30.5 GiB), and
 * video growing 873 MiB/day now that manual verification is live, which is
 * ~25 GiB a month of screen recordings an admin watches once.
 *
 * Serving was already fixed (`?w=` resizes on the way out, Cloudflare caches it),
 * so this is about what we hold and what the FIRST fetch of each file costs.
 */

/** Above this, a photo is bigger than any screen we serve it to. */
const MAX_IMAGE_DIMENSION = Number(process.env.UPLOAD_MAX_IMAGE_PX || 1920);
/** Skip tiny files — re-encoding them tends to make them larger. */
const MIN_IMAGE_BYTES = Number(process.env.UPLOAD_MIN_IMAGE_BYTES || 50 * 1024);
/** Video wider than this is downscaled; phone recordings are usually 1080p+. */
const MAX_VIDEO_WIDTH = Number(process.env.UPLOAD_MAX_VIDEO_PX || 1280);
/** x264 quality. 28 is visually fine for screen recordings and text stays legible. */
const VIDEO_CRF = Number(process.env.UPLOAD_VIDEO_CRF || 28);
/** Give up rather than hold an upload forever on a pathological file. */
const VIDEO_TIMEOUT_MS = Number(process.env.UPLOAD_VIDEO_TIMEOUT_MS || 5 * 60 * 1000);

/**
 * Transcodes running at once.
 *
 * ffmpeg is CPU-bound and shares this box with every service. A verification
 * round means many diffuseurs uploading within a few minutes of each other, and
 * unbounded spawning would starve the API of CPU to save disk that costs cents.
 * Queued rather than rejected: waiting a few seconds is invisible next to
 * uploading the file in the first place.
 */
const MAX_CONCURRENT_TRANSCODES = Number(process.env.UPLOAD_MAX_TRANSCODES || 2);

let running = 0;
const waiting: Array<() => void> = [];

const acquire = (): Promise<void> => {
    if (running < MAX_CONCURRENT_TRANSCODES) {
        running++;
        return Promise.resolve();
    }
    return new Promise(resolve => waiting.push(() => { running++; resolve(); }));
};

const release = () => {
    running--;
    waiting.shift()?.();
};

export type CompressionResult = {
    buffer: Buffer;
    mimeType: string;
    /** Extension to store under, without the dot. Undefined means keep the original. */
    extension?: string;
    compressed: boolean;
};

const keep = (buffer: Buffer, mimeType: string): CompressionResult =>
    ({ buffer, mimeType, compressed: false });

/**
 * Re-encode an image to WebP, bounded to a sane maximum dimension.
 *
 * Animated GIFs and SVGs are left alone: the first would lose its animation
 * through this path, and the second is text that sharp would rasterise.
 */
const compressImage = async (buffer: Buffer, mimeType: string): Promise<CompressionResult> => {
    if (/svg|gif/i.test(mimeType) || buffer.length < MIN_IMAGE_BYTES) return keep(buffer, mimeType);

    try {
        const out = await sharp(buffer)
            .rotate() // bake in EXIF orientation, or the smaller copy comes out sideways
            .resize({
                width: MAX_IMAGE_DIMENSION,
                height: MAX_IMAGE_DIMENSION,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({ quality: 82 })
            .toBuffer();

        // A re-encode is not guaranteed to win — an already-optimised image can
        // come back larger. Keep whichever is actually smaller.
        if (out.length >= buffer.length) return keep(buffer, mimeType);

        return { buffer: out, mimeType: 'image/webp', extension: 'webp', compressed: true };
    } catch (err) {
        // A corrupt or exotic image must still upload; it just does not shrink.
        log.warn(`Image compression failed, storing the original: ${(err as Error).message}`);
        return keep(buffer, mimeType);
    }
};

const runFfmpeg = (args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += String(d); });

        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error(`ffmpeg timed out after ${VIDEO_TIMEOUT_MS}ms`));
        }, VIDEO_TIMEOUT_MS);

        proc.on('error', err => { clearTimeout(timer); reject(err); });
        proc.on('close', code => {
            clearTimeout(timer);
            if (code === 0) return resolve();
            reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
        });
    });

/**
 * Transcode video to H.264/AAC in an MP4, downscaled to MAX_VIDEO_WIDTH.
 *
 * Also solves a second problem: phones record screens as .mov/HEVC, which Chrome
 * frequently cannot decode — the admin review page showed a black box for those.
 * Everything stored becomes a format browsers actually play.
 *
 * ffmpeg works on files rather than pipes here because MP4 needs a seekable
 * output to write its moov atom, and `-movflags +faststart` puts that atom first
 * so playback can begin before the whole file has arrived.
 */
const compressVideo = async (buffer: Buffer, mimeType: string): Promise<CompressionResult> => {
    await acquire();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbc-video-'));
    const input = path.join(dir, 'in');
    const output = path.join(dir, 'out.mp4');

    try {
        await fs.writeFile(input, buffer);
        await runFfmpeg([
            '-y', '-i', input,
            '-vf', `scale='min(${MAX_VIDEO_WIDTH},iw)':-2`, // -2 keeps height even, which x264 requires
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(VIDEO_CRF),
            '-c:a', 'aac', '-b:a', '96k',
            '-movflags', '+faststart',
            output,
        ]);

        const out = await fs.readFile(output);
        if (out.length >= buffer.length) return keep(buffer, mimeType);

        log.info(
            `Video compressed ${(buffer.length / 1048576).toFixed(1)} MiB -> `
            + `${(out.length / 1048576).toFixed(1)} MiB`,
        );
        return { buffer: out, mimeType: 'video/mp4', extension: 'mp4', compressed: true };
    } catch (err) {
        log.warn(`Video compression failed, storing the original: ${(err as Error).message}`);
        return keep(buffer, mimeType);
    } finally {
        release();
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
};

/**
 * Compress an upload if we usefully can. Never throws: failing to shrink a file
 * must never fail the upload itself.
 */
export const compressUpload = async (buffer: Buffer, mimeType: string): Promise<CompressionResult> => {
    if (mimeType?.startsWith('image/')) return compressImage(buffer, mimeType);
    if (mimeType?.startsWith('video/')) return compressVideo(buffer, mimeType);
    return keep(buffer, mimeType);
};
