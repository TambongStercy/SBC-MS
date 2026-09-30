import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from './auth.middleware';

/**
 * Per-user rate limit for the scan endpoint (spec §27).
 * Keyed on the JWT userId so one abusive scanner can't affect another
 * organizer sharing an IP (LAN behind a NAT).
 */
export const scanLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 2 scans/second sustained is well above realistic gate throughput
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const uid = (req as AuthenticatedRequest).user?.userId;
        return uid ? `scan:${uid}` : `scan:ip:${req.ip}`;
    },
    message: { success: false, message: 'Trop de scans en peu de temps. Ralentissez.' },
});

/**
 * Generic per-IP limiter for public event feed reads. Protects the DB from
 * a scraper cycling filters; real users open the page a few times a minute.
 */
export const publicReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Trop de requêtes. Réessayez dans un instant.' },
});
