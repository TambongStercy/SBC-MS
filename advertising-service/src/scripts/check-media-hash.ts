/**
 * Asserts the perceptual hash actually does its job.
 *
 * The whole point is surviving WhatsApp's recompression while still telling
 * unrelated images apart. If it fails either way it is worse than useless: too
 * strict and honest diffuseurs get rejected, too loose and anyone can paste the
 * tracking link onto any photo.
 *
 *   npx ts-node src/scripts/check-media-hash.ts
 */
import sharp from 'sharp';
import { perceptualHash, hammingDistance, compareMedia } from '../services/media-hash.service';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

/** Deterministic synthetic image; no fixtures to keep in the repo. */
const makeImage = (seed: number, size = 600) =>
    sharp({
        create: {
            width: size,
            height: size,
            channels: 3,
            background: { r: (seed * 37) % 256, g: (seed * 91) % 256, b: (seed * 53) % 256 },
        },
    })
        .composite([{
            input: Buffer.from(
                `<svg width="${size}" height="${size}">
                    <circle cx="${100 + seed * 20}" cy="${150 + seed * 10}" r="${60 + seed * 5}" fill="white"/>
                    <rect x="${seed * 15}" y="${300}" width="${200}" height="${120}" fill="black"/>
                    <text x="30" y="${520}" font-size="70" fill="white">SBC ${seed}</text>
                 </svg>`,
            ),
            top: 0,
            left: 0,
        }])
        .jpeg({ quality: 95 })
        .toBuffer();

const main = async () => {
    const original = await makeImage(1);

    // WhatsApp shrinks and re-encodes at lower quality. This approximates it.
    const recompressed = await sharp(original)
        .resize(480)
        .jpeg({ quality: 55 })
        .toBuffer();

    const harsher = await sharp(original)
        .resize(320)
        .jpeg({ quality: 35 })
        .toBuffer();

    const different = await makeImage(7);

    const hOriginal = await perceptualHash(original);
    const hRecompressed = await perceptualHash(recompressed);
    const hHarsher = await perceptualHash(harsher);
    const hDifferent = await perceptualHash(different);

    check('hashes an image', hOriginal !== null && hOriginal.length === 16, hOriginal ?? 'null');
    check('identical bytes give distance 0', hammingDistance(hOriginal!, hOriginal!) === 0);

    const dRecompressed = hammingDistance(hOriginal!, hRecompressed!);
    check(
        'survives WhatsApp-style recompression',
        compareMedia(hOriginal, hRecompressed).matches === true,
        `distance ${dRecompressed}`,
    );

    const dHarsher = hammingDistance(hOriginal!, hHarsher!);
    check(
        'survives harsher recompression',
        compareMedia(hOriginal, hHarsher).matches === true,
        `distance ${dHarsher}`,
    );

    const dDifferent = hammingDistance(hOriginal!, hDifferent!);
    check(
        'rejects an unrelated image',
        compareMedia(hOriginal, hDifferent).matches === false,
        `distance ${dDifferent}`,
    );

    // The gap between "same picture, recompressed" and "different picture" is what
    // makes the threshold safe. If these ever converge, the check is meaningless.
    check(
        'clear separation between same and different',
        dDifferent! > dHarsher! * 2,
        `${dHarsher} vs ${dDifferent}`,
    );

    // Unknown must never read as a mismatch: refusing to pay because we could not
    // process a format would punish the diffuseur for our limitation.
    check('missing hash yields unknown, not false', compareMedia(null, hOriginal).matches === null);
    check('unhashable input yields null', (await perceptualHash(Buffer.from('not an image'))) === null);

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
