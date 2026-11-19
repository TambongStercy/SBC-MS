import { Request, Response, NextFunction } from 'express';
import config from '../../config';
import { secretEquals } from '../../utils/crypto';
import logger from '../../utils/logger';

const log = logger.getLogger('ServiceAuth');

/** Internal routes: Authorization: Bearer <SERVICE_SECRET>, compared in constant time. */
export function requireService(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!secretEquals(token, config.secrets.service)) {
        log.warn('Internal call refused', { path: req.baseUrl + req.path, caller: req.header('x-service-name') || null });
        res.status(401).json({ success: false, message: 'Invalid service authentication', code: 'UNAUTHORIZED' });
        return;
    }
    next();
}
