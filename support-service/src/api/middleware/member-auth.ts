import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { hit } from '../../lib/rate-limit';
import { tooMany, unauthorized } from '../../utils/errors';

export interface Member { userId: string; role?: string; email?: string }

export interface MemberRequest extends Request { member?: Member }

export const memberOf = (req: Request): Member => {
    const m = (req as MemberRequest).member;
    if (!m) throw unauthorized('Connectez-vous pour continuer.');
    return m;
};

/** Member JWT from the app (Bearer, JWT_SECRET), verified like the other services. Any role. */
export function requireMember(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header('authorization') || '';
    if (!header.startsWith('Bearer ')) return next(unauthorized('Connectez-vous pour continuer.'));
    try {
        const decoded = jwt.verify(header.slice(7), config.secrets.memberJwt, { algorithms: ['HS256'] }) as jwt.JwtPayload;
        // An agent token is never a member token.
        if (decoded.aud === config.auth.audience) throw new Error('agent token');
        const userId = String(decoded.userId || decoded.id || '');
        if (!/^[a-f0-9]{24}$/i.test(userId)) throw new Error('no user id');
        (req as MemberRequest).member = { userId, role: decoded.role, email: decoded.email };
        next();
    } catch {
        next(unauthorized('Session expirée. Reconnectez-vous.'));
    }
}

/** Per-member Redis limit on a route. */
export function memberLimit(name: string, limit: number | (() => Promise<number>), windowSec: number, message: string) {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const m = memberOf(req);
            const max = typeof limit === 'number' ? limit : await limit();
            const r = await hit(`member:${name}:${m.userId}`, max, windowSec);
            if (!r.allowed) throw tooMany(message, r.retryAfterSec);
            next();
        } catch (err) {
            next(err);
        }
    };
}
