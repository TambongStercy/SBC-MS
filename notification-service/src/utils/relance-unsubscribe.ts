import crypto from 'crypto';
import config from '../config';

/**
 * Signed unsubscribe links for the relance email footer.
 *
 * The footer used to point at `<frontend>/unsubscribe`, a page the app never
 * had. The link carries the address and an HMAC of it, so nobody can
 * unsubscribe an address they only guessed.
 *
 * Deliberately NOT sent as a List-Unsubscribe header: Gmail puts mail with
 * that header in Promotions, where nobody is notified (measured 2026-10-06).
 * Gmail only requires it above 5,000 marketing emails a day to Gmail.
 */

const sign = (email: string) =>
    crypto
        .createHmac('sha256', config.services.serviceSecret)
        .update(`relance-unsubscribe:${email.trim().toLowerCase()}`)
        .digest('base64url')
        .slice(0, 32);

export function relanceUnsubscribeUrl(email: string): string {
    const base = (config.app.frontendUrl || 'https://sniperbuisnesscenter.com').replace(/\/+$/, '');
    return `${base}/api/relance/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${sign(email)}`;
}

export function isValidUnsubscribe(email: unknown, token: unknown): email is string {
    if (typeof email !== 'string' || typeof token !== 'string' || !email.includes('@')) return false;
    const expected = Buffer.from(sign(email));
    const given = Buffer.from(token);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

