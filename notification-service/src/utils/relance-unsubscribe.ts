import crypto from 'crypto';
import config from '../config';

/**
 * Signed one-click unsubscribe links for relance emails.
 *
 * The footer used to point at `<frontend>/unsubscribe`, a page the app never
 * had. Gmail and Yahoo also require a working one-click unsubscribe
 * (List-Unsubscribe + List-Unsubscribe-Post) from anyone sending this kind of
 * mail in volume. The link carries the address and an HMAC of it, so nobody
 * can unsubscribe an address they only guessed.
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

/** Headers that let Gmail show its own "Unsubscribe" button and POST to us in one click. */
export function relanceUnsubscribeHeaders(email: string): Record<string, string> {
    return {
        'List-Unsubscribe': `<${relanceUnsubscribeUrl(email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
}
