import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('AuthMiddleware');

interface JwtPayload {
    id: string;
    userId: string;
    email: string;
    role: string;
    iat?: number;
    exp?: number;
}

export interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Authentication token required', 401));
    }
    const token = authHeader.split(' ')[1];
    if (!config.jwt.secret) {
        log.error('JWT Secret is not configured.');
        return next(new AppError('Internal server configuration error', 500));
    }
    try {
        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        if (!decoded.userId && decoded.id) decoded.userId = decoded.id;
        (req as AuthenticatedRequest).user = decoded;
        next();
    } catch (error: any) {
        log.warn('User authentication failed: Token verification error.', { error: error.message });
        next(new AppError('Invalid or expired authentication token', 401));
    }
};

export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (user && (user.role === 'admin' || user.role === 'tester')) {
        next();
    } else {
        log.warn(`Admin authorization failed for user: ${user?.userId}. Role: ${user?.role}`);
        next(new AppError('Forbidden: Insufficient permissions.', 403));
    }
};

export const authenticateServiceRequest = (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.header('Authorization');
        const serviceName = req.header('X-Service-Name');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            log.warn('Service request missing Authorization header');
            return res.status(401).json({ success: false, message: 'Access denied. Invalid service authentication.' });
        }

        const token = authHeader.slice(7);
        if (token !== config.services.serviceSecret) {
            log.warn('Invalid service token received');
            return res.status(401).json({ success: false, message: 'Invalid service authentication' });
        }

        if (serviceName) log.info(`Service request authenticated from: ${serviceName}`);
        next();
    } catch (error) {
        log.error(`Service authentication error: ${error}`);
        return res.status(500).json({ success: false, message: 'Service authentication error' });
    }
};

/**
 * Feature-flag gate. Admins/testers always pass; everyone else waits until
 * config.launchAt (ISO instant) has arrived. Empty = live for everyone.
 */
export const requireLaunched = (req: Request, res: Response, next: NextFunction) => {
    if (!config.launchAt) return next();
    const user = (req as AuthenticatedRequest).user;
    if (user && (user.role === 'admin' || user.role === 'tester')) return next();
    const openAt = new Date(config.launchAt).getTime();
    if (Number.isNaN(openAt) || Date.now() >= openAt) return next();
    return next(new AppError('SBC Event is not open yet', 423));
};
