import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../../utils/jwt'; // Adjust path as needed
import config from '../../config';
import { UserRole } from '../../database/models/user.model'; // Import UserRole enum
import { userRepository } from '../../database/repositories/user.repository'; // Import repository
import logger from '../../utils/logger';
import { bannedBody, hasBanFlag } from '../../services/account-ban.service';

const log = logger.getLogger('Auth');

// Define the expected structure of the JWT payload
interface JwtPayload {
    id: string;
    userId: string; // userId same as id
    email: string;
    role: UserRole; // Added role
    iat?: number;
    exp?: number;
}

// Extend Express Request interface to include typed user payload
// Export this interface so other modules can use it
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload; // Use the specific JwtPayload interface
}



export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<any> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication token required' });
    }

    const token = authHeader.split(' ')[1];


    try {
        const decoded = verifyToken(token);

        // Type guard to check if the decoded object has the required properties
        // Check for userId and role
        if (
            typeof decoded !== 'object' ||
            decoded === null ||
            typeof (decoded as JwtPayload).userId !== 'string' ||
            !Object.values(UserRole).includes((decoded as JwtPayload).role) // Check if role is a valid enum value
        ) {
            throw new Error('Invalid token payload structure');
        }

        // Cast to the specific payload type after validation
        const decodedPayload = decoded as JwtPayload;

        // // --- Validate token against database --- 
        // const user = await userRepository.findByIdAndValidateToken(decodedPayload.userId, token);
        // if (!user) {
        //     log.warn(`Token validation failed for user ${decodedPayload.userId} - Token not found or user deleted`);
        //     return res.status(401).json({ message: 'Authentication failed: Invalid or revoked token' });
        // }
        // // --- End DB Validation --- 

        // A suspended member (services/account-ban.service.ts) is refused at once, whatever token
        // they still hold. Redis flag only (fails open); /me, refresh and sign-in also read the database.
        if (decodedPayload.role === UserRole.USER && await hasBanFlag(decodedPayload.userId)) {
            return res.status(403).json(bannedBody());
        }

        // Attach user payload to the request object
        req.user = decodedPayload;

        next(); // Proceed to the next middleware or route handler
    } catch (error: any) {
        log.error("Token verification failed", error);
        // Handle specific errors like expired token if needed
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid token' });
        }
        return res.status(401).json({ message: 'Authentication failed' });
    }
};

/** Constant-time comparison of a presented secret with the expected one. */
function secretEquals(presented: string | undefined, expected: string | undefined): boolean {
    if (!presented || !expected) return false;
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}

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
        if (!secretEquals(token, config.services.serviceSecret)) { // constant-time: no timing leak of the secret
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