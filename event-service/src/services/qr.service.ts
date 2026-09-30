import crypto from 'crypto';
import QRCode from 'qrcode';
import config from '../config';

/**
 * Opaque, unpredictable per-ticket token. Never encodes any ticket/user/event id —
 * the server looks up the record by this token alone (spec §11). Signed with
 * HMAC so a leaked-then-modified token can't be forged into a different ticket.
 */
export const generateQrToken = (): string => {
    const random = crypto.randomBytes(16).toString('base64url');
    if (!config.qrTokenSecret) return random;
    const sig = crypto.createHmac('sha256', config.qrTokenSecret).update(random).digest('base64url').slice(0, 12);
    return `${random}.${sig}`;
};

export const verifyQrToken = (token: string): boolean => {
    if (!token || !token.includes('.')) return false;
    if (!config.qrTokenSecret) return false;
    const [random, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', config.qrTokenSecret).update(random).digest('base64url').slice(0, 12);
    // Timing-safe compare on same-length strings
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

/** Emit the QR image as a data-URL (base64 PNG) for API responses. */
export const renderQrDataUrl = async (token: string): Promise<string> => {
    return QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 1, width: 512 });
};
