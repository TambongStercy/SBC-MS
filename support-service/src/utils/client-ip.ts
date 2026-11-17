import { Request } from 'express';

/**
 * The visitor's IP. Requests come through Cloudflare → nginx → gateway, so the
 * socket address is the gateway. Cloudflare's CF-Connecting-IP first, then the
 * first X-Forwarded-For entry, then X-Real-IP, then the socket.
 */
export const clientIp = (req: Request): string => {
    const cf = req.header('cf-connecting-ip');
    if (cf) return cf.trim();
    const xff = req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
    const real = req.header('x-real-ip');
    if (real) return real.trim();
    return req.socket?.remoteAddress || 'unknown';
};

export const userAgent = (req: Request): string => (req.header('user-agent') || '').slice(0, 300);
