import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import logger from '../../utils/logger';
import { UnauthorizedError } from '../../utils/errors';

const log = logger.getLogger('AuthMiddleware');

// Extend Express Request interface to include user payload
interface AuthenticatedRequest extends Request {
    user?: { id: string; roles: string[] }; // Adjust payload structure as needed
}

const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log.warn('Authentication failed: No Bearer token provided.');
        return next(new UnauthorizedError('Authentication token is required.'));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret) as { id: string; roles: string[] }; // Adjust payload type
        log.debug(`Token verified successfully for user ID: ${decoded.id}`);
        // Attach user information to the request object
        req.user = decoded;
        next();
    } catch (error) {
        log.error('Authentication failed: Invalid token.', error);
        // Handle specific JWT errors if needed (e.g., TokenExpiredError)
        if (error instanceof jwt.TokenExpiredError) {
            return next(new UnauthorizedError('Token has expired.'));
        }
        return next(new UnauthorizedError('Invalid authentication token.'));
    }
};

/**
 * Middleware for service-to-service authentication
 * This middleware checks for a service token (shared secret) and optional service name
 */
export const authenticateServiceRequest = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        const serviceName = req.headers['x-service-name']; // Optional, for logging/auditing

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            log.warn('No service token provided');
            return res.status(401).json({ success: false, message: 'No service token provided' });
        }

        const token = authHeader.split(' ')[1];

        // Validate service token against the shared secret
        if (token !== config.services.serviceSecret) { // Use the correct config path
            log.warn('Invalid service token');
            return res.status(403).json({ success: false, message: 'Invalid service token' });
        }

        // Optional: Log the calling service name if provided
        if (serviceName && typeof serviceName === 'string') {
            log.info(`Service-to-service request authenticated from: ${serviceName}`);
        } else {
            log.info('Service-to-service request authenticated (service name not provided)');
        }

        // If the token is valid, proceed
        next();
    } catch (error) {
        log.error('Service authentication error:', error);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
}; 

export default authenticate; 