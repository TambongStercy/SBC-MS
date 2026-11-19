import crypto from 'crypto';

/** Constant-time comparison of a presented secret with the expected one (phase 0 helper). */
export function secretEquals(presented: string | undefined | null, expected: string | undefined | null): boolean {
    if (!presented || !expected) return false;
    const a = crypto.createHash('sha256').update(presented).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

export const sha256Hex = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export const hmacHex = (key: Buffer | string, s: string): string => crypto.createHmac('sha256', key).update(s).digest('hex');

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** AES-256-GCM; output "v1:<iv>:<tag>:<ciphertext>" (base64url parts). */
export function encrypt(plain: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(blob: string, key: Buffer): string {
    const [v, iv, tag, ct] = blob.split(':');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** Canonical JSON: keys sorted at every level, Dates as ISO strings, undefined dropped. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
    if (typeof value === 'object') {
        const v = value as Record<string, unknown>;
        if (typeof (v as any).toHexString === 'function') return (v as any).toHexString();
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) {
            if (v[k] === undefined) continue;
            out[k] = normalize(v[k]);
        }
        return out;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
}

/** A JSON-safe deep copy (what gets stored is exactly what gets hashed). */
export const toPlainJson = <T>(v: T): T => (v === undefined ? (null as any) : JSON.parse(canonicalJson(v)));
