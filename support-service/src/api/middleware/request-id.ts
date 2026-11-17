import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../utils/request-context';
import { clientIp } from '../../utils/client-ip';
import logger from '../../utils/logger';

const log = logger.getLogger('HTTP');
const VALID_ID = /^[A-Za-z0-9._-]{8,100}$/;

/** x-request-id in (or a new one), echoed back, attached to every log line and outbound call. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', id);
    (req as any).requestId = id;
    const start = Date.now();
    requestContext.run({ requestId: id }, () => {
        res.on('finish', () => {
            if (req.path.endsWith('/health')) return;
            // Path only: query strings can carry search terms (names, numbers).
            log.info('request', { method: req.method, path: req.baseUrl + req.path, status: res.statusCode, ms: Date.now() - start, ip: clientIp(req) });
        });
        next();
    });
}
