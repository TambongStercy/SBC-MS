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

export default authenticate; 