import sharp from 'sharp';
import logger from './logger';

const log = logger.getLogger('ImageProcessing');

/**
 * Produces a privacy "blurred derivative" of a profile photo (spec §6):
 * heavily downscaled then Gaussian-blurred and re-encoded as JPEG. The small
 * dimensions mean even an un-blur attempt has almost no detail to recover, so
 * this is a genuine protection layer rather than a CSS overlay.
 *
 * Returns a JPEG buffer, or null if processing fails (caller decides fallback).
 */
export const generateBlurredDerivative = async (input: Buffer): Promise<Buffer | null> => {
    try {
        return await sharp(input)
            .rotate()                 // respect EXIF orientation before stripping metadata
            .resize(64, 64, { fit: 'cover' })
            .blur(8)
            .jpeg({ quality: 40 })
            .toBuffer();
    } catch (error: any) {
        log.error(`Failed to generate blurred derivative: ${error.message}`);
        return null;
    }
};
