import crypto from 'crypto';
import config from '../config';

// Encryption-at-rest for SBC Love message content (AES-256-GCM).
// The server holds the key (config.love.encryptionKey), so this protects
// against DB/disk theft, not against the server itself — matching the chosen
// "encrypted at rest + TLS" model (not zero-knowledge E2EE).
//
// Packed format: enc:v1:<ivB64>:<tagB64>:<ciphertextB64>
// Any-length secret is accepted; we derive a stable 32-byte key via SHA-256.

const PREFIX = 'enc:v1:';

// ponytail: sha256(secret) so any env secret length works; upgrade to a KDF
// (scrypt/argon2) only if the secret becomes user-supplied/low-entropy.
function key(): Buffer {
    return crypto.createHash('sha256').update(config.love.encryptionKey).digest();
}

export function isEncrypted(value: string | undefined | null): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12); // 96-bit nonce, standard for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(packed: string): string {
    if (!isEncrypted(packed)) return packed; // tolerate legacy/plaintext
    const [ivB64, tagB64, ctB64] = packed.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// Runnable self-check: `ts-node src/utils/loveCrypto.ts`
if (require.main === module) {
    const samples = ['hello 💙', '', 'a'.repeat(5000), 'ligne\nmultiligne'];
    for (const s of samples) {
        const packed = encrypt(s);
        if (!isEncrypted(packed)) throw new Error('packed value not recognized as encrypted');
        if (packed.includes(s) && s.length > 3) throw new Error('plaintext leaked into ciphertext');
        if (decrypt(packed) !== s) throw new Error('roundtrip mismatch');
    }
    // Tampering must fail (GCM auth).
    const p = encrypt('secret');
    const parts = p.slice(PREFIX.length).split(':');
    const badCt = Buffer.from(parts[2], 'base64'); badCt[0] ^= 0xff;
    parts[2] = badCt.toString('base64');
    let threw = false;
    try { decrypt(PREFIX + parts.join(':')); } catch { threw = true; }
    if (!threw) throw new Error('tampered ciphertext did not fail auth');
    // Legacy plaintext passes through untouched.
    if (decrypt('plain text') !== 'plain text') throw new Error('legacy passthrough broke');
    console.log('loveCrypto self-check OK');
}
