import { Request } from 'express';

/**
 * The visitor's IP. Requests reach us through Cloudflare → nginx → gateway,
 * so `req.ip` is always the gateway's address and every visitor would share
 * one rate-limit bucket.
 *
 * Cloudflare's CF-Connecting-IP is the one it sets itself; then the first
 * X-Forwarded-For entry (nginx appends after it, so it is the closest thing
 * to the client — forgeable by a caller who bypasses Cloudflare, which only
 * matters for rate limiting); then X-Real-IP; then the socket.
 */
export const clientIp = (req: Request): string => {
    const cf = req.header('cf-connecting-ip');
    if (cf) return cf.trim();
    const xff = req.header('x-forwarded-for');
    if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
    }
    const real = req.header('x-real-ip');
    if (real) return real.trim();
    return req.ip || req.socket.remoteAddress || 'unknown';
};
