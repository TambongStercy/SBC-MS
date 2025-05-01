import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config'; // Assuming config is here
import { AppError } from '../../utils/errors'; // Assuming AppError exists
import logger from '../../utils/logger';

const log = logger.getLogger('AuthMiddleware');

interface JwtPayload {
    id: string;
    userId: string; // userId same as id
    email: string;
    role: string; // Added role
    iat?: number;
    exp?: number;
}

// Define structure for AuthenticatedRequest again for clarity within middleware
interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}



/**
 * Middleware to authenticate user requests using JWT.
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    // Assume existing implementation for user JWT auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Authentication token required', 401));
    }
    const token = authHeader.split(' ')[1];
    if (!config.jwt.secret) {
        log.error('Tombola JWT Secret is not configured.');
        return next(new AppError('Internal server configuration error', 500));
    }
    try {
        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        // @ts-ignore Possible type issue if Request not extended
        req.user = decoded;
        next();
    } catch (error: any) {
        log.warn('User authentication failed: Token verification error.', { error: error.message });
        next(new AppError('Invalid or expired authentication token', 401));
    }
};

/**
 * Middleware to authorize users based on role.
 * Requires the user to be authenticated beforehand (req.user must be populated).
 */
export const authorizeAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // @ts-ignore Check if user exists and has the admin role
    if (req.user && req.user.role === 'admin') {
        log.debug(`Admin authorization successful for user: ${req.user.userId}`);
        next(); // User has the required role, proceed
    } else {
        log.warn(`Admin authorization failed for user: ${req.user?.userId}. Role: ${req.user?.role}`);
        // Use 403 Forbidden for authenticated users with insufficient permissions
        next(new AppError('Forbidden: Insufficient permissions.', 403));
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

// Optional: Add authorize middleware if needed
// export const authorize = (allowedRoles: string[]) => { ... }; 