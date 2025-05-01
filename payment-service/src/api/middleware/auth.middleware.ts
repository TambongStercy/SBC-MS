import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('AuthMiddleware');

// Extend the Express Request interface to include user information
declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                email: string;
                role: string;
            };
        }
    }
}

/**
 * Middleware to authenticate user requests with JWT
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    try {
        // Get the token from the Authorization header
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // Extract the token (remove Bearer prefix if present)
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

        // Verify token
        const decoded = jwt.verify(token, config.jwt.secret) as {
            userId: string;
            email: string;
            role: string;
        };

        // Set user information on the request object
        req.user = decoded;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            log.warn(`Invalid token: ${error.message}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        } else if (error instanceof jwt.TokenExpiredError) {
            log.warn(`Token expired: ${error.message}`);
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        } else {
            log.error(`Authentication error: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Authentication error'
            });
        }
    }
};

/**
 * Middleware to check for service-to-service authentication
 */
export const authenticateServiceRequest = (req: Request, res: Response, next: NextFunction) => {
    try {
        // Get the token from the Authorization header
        const authHeader = req.header('Authorization');
        const serviceName = req.header('X-Service-Name'); // Optional, for logging

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            log.warn('Service request missing Authorization header');
            return res.status(401).json({
                success: false,
                message: 'Access denied. Invalid service authentication.'
            });
        }

        const token = authHeader.slice(7);

        // Validate the token against the shared service secret
        if (token !== config.services.serviceSecret) { // Use the dedicated service secret
            log.warn('Invalid service token received');
            return res.status(401).json({
                success: false,
                message: 'Invalid service authentication'
            });
        }

        // Optional: Log the calling service
        if (serviceName) {
            log.info(`Service request authenticated from: ${serviceName}`);
        }

        next();
    } catch (error) {
        log.error(`Service authentication error: ${error}`);
        return res.status(500).json({
            success: false,
            message: 'Service authentication error'
        });
    }
};

/**
 * Middleware to check for admin role
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    // Must run after authenticate middleware
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    next();
}; 