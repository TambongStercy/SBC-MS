import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

const log = logger.getLogger('ErrorMiddleware');

/** A service behind the gateway that cannot be reached: an outage, not a bug (failure drills, 2026-11-22). */
const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ESOCKETTIMEDOUT']);

/**
 * Global error handling middleware
 */
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // A service down answers 503 (retry later), so monitoring and the apps tell an outage from a bug.
    const code = (err as any)?.code;
    if (code && UNREACHABLE.has(code)) {
        log.warn(`Service unreachable (${code}) for ${req.method} ${req.path}`);
        if (!res.headersSent) {
            res.status(503).set('Retry-After', '30').json({
                success: false, code: 'SERVICE_UNAVAILABLE',
                message: 'Ce service est momentanément indisponible. Réessayez dans un instant.',
            });
        }
        return;
    }

    // Log the error
    log.error(`Unhandled error: ${err.message}`, {
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    // Don't send error details in production
    const isDev = process.env.NODE_ENV === 'development';

    // Send standard error response
    if (!res.headersSent) {
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: isDev ? err.message : undefined,
            stack: isDev ? err.stack : undefined
        });
    }
}; 