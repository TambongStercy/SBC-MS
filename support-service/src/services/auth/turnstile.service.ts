import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('Turnstile');

/** Cloudflare Turnstile check. Skipped (true) when TURNSTILE_SECRET is unset. */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
    if (!config.turnstileSecret) return true;
    if (!token) return false;
    try {
        const body = new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip });
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body, signal: AbortSignal.timeout(5000),
        });
        const json: any = await res.json().catch(() => null);
        return Boolean(json?.success);
    } catch (err) {
        // Fail closed: an unverifiable challenge is a failed challenge.
        log.warn('Turnstile verification unreachable', { message: (err as Error).message });
        return false;
    }
}
