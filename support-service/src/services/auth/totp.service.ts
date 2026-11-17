import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import config from '../../config';
import { decrypt, encrypt, hmacHex } from '../../utils/crypto';

authenticator.options = { window: 1, step: 30, digits: 6 };

export const generateSecret = () => authenticator.generateSecret(20);
export const encryptSecret = (secret: string) => encrypt(secret, config.secrets.totpEncKey);
export const decryptSecret = (blob: string) => decrypt(blob, config.secrets.totpEncKey);

export async function enrollmentPayload(secret: string, email: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
    const otpauthUrl = authenticator.keyuri(email, 'SBC Support', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    return { otpauthUrl, qrDataUrl };
}

/**
 * Checks a 6-digit code (±1 step). Returns the time step it matched, or null.
 * Callers refuse a step ≤ the last one used, so a code is never accepted twice.
 */
export function verifyTotp(secret: string, code: string): number | null {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return null;
    const delta = authenticator.checkDelta(c, secret);
    if (delta === null || delta === undefined) return null;
    return Math.floor(Date.now() / 1000 / 30) + delta;
}

const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 10 backup codes like "K7QX-M2PA-9TRB" (60 bits each); only their HMAC is stored. */
export function generateBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
        const bytes = crypto.randomBytes(12);
        const chars = Array.from(bytes).map((b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('');
        codes.push(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
    }
    return { codes, hashes: codes.map(hashBackupCode) };
}

export const normalizeBackupCode = (c: string) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashBackupCode = (c: string) => hmacHex(config.secrets.totpEncKey, `backup:${normalizeBackupCode(c)}`);
