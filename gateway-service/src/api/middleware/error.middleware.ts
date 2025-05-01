import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

const log = logger.getLogger('ErrorMiddleware');

/**
 * Global error handling middleware
 */
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
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