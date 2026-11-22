import { NextFunction, Request, Response } from 'express';
import { ipGeoStats, lookupIp } from '../../services/ip-geo';

/**
 * Fills the country and network headers every service reads, from the IP files
 * (services/ip-geo.ts), before anything else uses them:
 *
 *   X-SBC-ASN  ALWAYS set from our own lookup once the files are loaded. nginx copies it from
 *              X-CF-ASN, which only a Cloudflare transform rule would make trustworthy; without
 *              one a client could send any value. Our lookup replaces it (or removes it when
 *              the address is in no known network).
 *   X-SBC-Geo  set only when Cloudflare gave no country (empty or XX): Cloudflare's is better
 *              (it sees the connection) and cannot be forged (nginx overwrites the header).
 *              T1 (Tor) is kept. `X-SBC-Geo-Source: ipdb` marks a filled one.
 *
 * The visitor's address is X-Real-IP (nginx, after its real_ip module has taken
 * CF-Connecting-IP from Cloudflare's ranges only), else the socket's. Client-sent
 * X-SBC-Geo-Source is dropped. No await, no I/O: a lookup is a bisection in memory.
 */
const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : '';
};

export const ipGeo = (req: Request, _res: Response, next: NextFunction) => {
    delete req.headers['x-sbc-geo-source'];
    if (!ipGeoStats.loaded || !req.originalUrl.startsWith('/api/')) return next();
    try {
        const ip = header(req, 'x-real-ip') || req.socket?.remoteAddress || '';
        const g = lookupIp(ip.trim());
        if (g.asn) req.headers['x-sbc-asn'] = String(g.asn);
        else delete req.headers['x-sbc-asn'];
        const cf = header(req, 'x-sbc-geo').trim().toUpperCase();
        if ((!cf || cf === 'XX') && g.country) {
            req.headers['x-sbc-geo'] = g.country;
            req.headers['x-sbc-geo-source'] = 'ipdb';
        }
    } catch { /* never in the request's way */ }
    return next();
};
