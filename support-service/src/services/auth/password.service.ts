import argon2 from 'argon2';
import fs from 'fs';
import path from 'path';

/** argon2id (OWASP parameters) + a common/breached password list. */
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);

let dummyHash: Promise<string> | null = null;
/** Verifies; with no hash, still burns the same time against a dummy hash (no timing oracle). */
export async function verifyPassword(hash: string | null | undefined, pw: string): Promise<boolean> {
    if (!dummyHash) dummyHash = argon2.hash('dummy-password-for-timing', ARGON_OPTS);
    const target = hash || (await dummyHash);
    try {
        const ok = await argon2.verify(target, pw);
        return Boolean(hash) && ok;
    } catch {
        return false;
    }
}

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
    if (common) return common;
    const candidates = [path.join(__dirname, '../../data/common-passwords.txt'), path.join(__dirname, '../../../src/data/common-passwords.txt')];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) throw new Error('common-passwords.txt missing');
    common = new Set(fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
    return common;
}

const SITE_WORDS = ['sniper', 'sbc', 'support', 'business', 'buisness', 'azerty', 'qwerty', 'motdepasse'];

/** null when acceptable, otherwise the French reason shown to the agent. */
export function passwordProblem(pw: string, ctx: { email?: string; name?: string } = {}): string | null {
    if (typeof pw !== 'string' || pw.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
    if (pw.length > 128) return 'Le mot de passe est trop long (128 caractères au plus).';
    const lower = pw.toLowerCase();
    const list = commonPasswords();
    const base = lower.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
    if (list.has(lower) || (base.length >= 4 && list.has(base))) return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
    if (new Set(lower).size < 5) return 'Ce mot de passe est trop simple.';
    if (SITE_WORDS.some((w) => lower.replace(/[^a-z]/g, '') === w || base === w)) return 'Ce mot de passe est trop simple.';
    const local = (ctx.email || '').split('@')[0].toLowerCase();
    if (local.length >= 4 && lower.includes(local)) return 'Le mot de passe ne doit pas contenir votre adresse email.';
    const first = (ctx.name || '').split(/\s+/)[0]?.toLowerCase() || '';
    if (first.length >= 4 && lower.includes(first)) return 'Le mot de passe ne doit pas contenir votre nom.';
    return null;
}
