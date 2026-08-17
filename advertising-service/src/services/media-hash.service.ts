import sharp from 'sharp';
import logger from '../utils/logger';

const log = logger.getLogger('MediaHashService');

/**
 * Perceptual hashing for the "did they post OUR flyer?" check.
 *
 * An exact sha256 comparison is useless here: WhatsApp recompresses images on
 * upload, so the advertiser's original and the bytes read back off a status are
 * different files even when they are visibly the same picture.
 *
 * dHash compares adjacent pixel brightness after shrinking to a tiny greyscale
 * grid. That survives recompression, resizing and mild quality loss, while still
 * differing sharply between unrelated images — which is exactly the line we need
 * to draw: someone pasting the tracking link onto an unrelated photo.
 *
 * This is a SECONDARY check. The primary proof is the tracking code in the caption,
 * which is unguessable and campaign-specific.
 */

/** 9x8 greyscale gives 8 horizontal comparisons per row = 64 bits. */
const WIDTH = 9;
const HEIGHT = 8;

/** Bits that may differ before two images are considered different pictures. */
const DEFAULT_THRESHOLD = 10;

/**
 * 64-bit difference hash, hex encoded.
 *
 * Returns null rather than throwing: a hash we cannot compute must degrade to
 * "unknown", never to a failed verification. Video and unsupported formats land
 * here too.
 */
export const perceptualHash = async (buffer: Buffer): Promise<string | null> => {
    try {
        const pixels = await sharp(buffer)
            .greyscale()
            .resize(WIDTH, HEIGHT, { fit: 'fill' })
            .raw()
            .toBuffer();

        let bits = '';
        for (let row = 0; row < HEIGHT; row++) {
            for (let col = 0; col < WIDTH - 1; col++) {
                const left = pixels[row * WIDTH + col];
                const right = pixels[row * WIDTH + col + 1];
                bits += left < right ? '1' : '0';
            }
        }

        // Byte at a time; a 64-bit binary string overflows parseInt in one go.
        let hex = '';
        for (let i = 0; i < bits.length; i += 8) {
            hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
        }
        return hex;
    } catch (err) {
        log.warn(`Perceptual hash failed: ${(err as Error).message}`);
        return null;
    }
};

/** Number of differing bits. Lower means more similar; 0 is identical. */
export const hammingDistance = (a: string, b: string): number | null => {
    if (a.length !== b.length) return null;

    let distance = 0;
    for (let i = 0; i < a.length; i += 2) {
        const byteA = parseInt(a.slice(i, i + 2), 16);
        const byteB = parseInt(b.slice(i, i + 2), 16);
        if (Number.isNaN(byteA) || Number.isNaN(byteB)) return null;

        let xor = byteA ^ byteB;
        while (xor) {
            distance += xor & 1;
            xor >>= 1;
        }
    }
    return distance;
};

export type MediaMatch = {
    /** null when either side could not be hashed; the caller must not treat it as a failure. */
    matches: boolean | null;
    distance: number | null;
};

/**
 * Whether a posted image is the campaign creative.
 *
 * Unknown is deliberately distinct from false. A missing hash means we could not
 * check, and refusing to pay on that basis would punish diffuseurs for our own
 * inability to process a format.
 */
export const compareMedia = (
    campaignHash: string | undefined | null,
    postedHash: string | undefined | null,
    threshold = DEFAULT_THRESHOLD,
): MediaMatch => {
    if (!campaignHash || !postedHash) return { matches: null, distance: null };

    const distance = hammingDistance(campaignHash, postedHash);
    if (distance === null) return { matches: null, distance: null };

    return { matches: distance <= threshold, distance };
};
