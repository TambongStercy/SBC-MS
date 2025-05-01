import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config'; // Adjust path if config is located differently
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('AuthMiddleware');

// Define the expected structure of the JWT payload
interface JwtPayload {
    id: string;
    userId: string;
    email: string;
    role: string; // Or specific roles like 'user' | 'admin'
    // Add other fields included in your JWT payload
}

// Extend the Express Request interface to include the user property
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload; // Add user property to Request
        }
    }
}

/**
 * Middleware to authenticate requests using JWT.
 * Verifies the token from the Authorization header and attaches the decoded payload to req.user.
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log.warn('Authentication failed: No Bearer token provided.');
        return next(new AppError('Authentication token required', 401));
    }

    const token = authHeader.split(' ')[1];

    if (!config.jwt.secret) {
        log.error('JWT Secret is not configured in the environment variables.');
        return next(new AppError('Internal server configuration error', 500));
    }

    try {
        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

        // Optional: Basic validation of payload structure
        if (!decoded.userId || !decoded.email || !decoded.role) {
            log.warn('Authentication failed: Invalid token payload structure.', { payload: decoded });
            return next(new AppError('Invalid authentication token', 401));
        }

        // Attach user payload to the request object
        req.user = decoded;
        log.debug(`User authenticated: ${decoded.userId} (${decoded.email})`);
        next();
    } catch (error: any) {
        log.warn('Authentication failed: Token verification error.', { error: error.message });
        if (error instanceof jwt.TokenExpiredError) {
            return next(new AppError('Authentication token expired', 401));
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new AppError('Invalid authentication token', 401));
        }
        // Handle other unexpected errors during verification
        next(new AppError('Authentication failed', 401));
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

// TODO: Add authorize middleware if role-based access control is needed
// export const authorize = (allowedRoles: string[]) => {
//     return (req: Request, res: Response, next: NextFunction) => {
//         if (!req.user || !req.user.role || !allowedRoles.includes(req.user.role)) {
//              log.warn(`Authorization failed: User ${req.user?.userId} role '${req.user?.role}' not in allowed roles [${allowedRoles.join(',')}]`);
//              return next(new AppError('Forbidden', 403));
//         }
//         next();
//     };
// }; 