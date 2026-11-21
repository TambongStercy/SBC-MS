import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

/** Service-to-service calls only: `Authorization: Bearer <SERVICE_SECRET>`, compared in constant time. */
export function requireService(req: Request, res: Response, next: NextFunction): void {
    const h = req.header('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const a = Buffer.from(token);
    const b = Buffer.from(config.serviceSecret);
    if (!token || a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    next();
}
