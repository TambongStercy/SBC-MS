import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';

// Define JWT payload interface
interface JwtPayload {
    userId: string;
    email: string;
    role: string;
}

// Extend Express Request type to include user
interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

// Type guard to check if payload is JwtPayload
function isJwtPayload(payload: any): payload is JwtPayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        typeof payload.userId === 'string' &&
        typeof payload.email === 'string' &&
        typeof payload.role === 'string'
    );
}

/**
 * Middleware to authenticate requests using JWT
 */
export const authenticate = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        // Extract token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // Check if Authorization header has Bearer format
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token format. Use Bearer format.'
            });
        }

        // Extract token from header
        const token = authHeader.substring(7);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // Verify and decode token
        const decoded = jwt.verify(token, config.jwt.secret);

        // Check if decoded payload has expected structure
        if (!isJwtPayload(decoded)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token payload.'
            });
        }

        // Attach user info to request
        req.user = decoded;

        // Proceed to the route handler
        next(); 
    } catch (error: any) {
        console.error('[AuthMiddleware]: Token verification error:', error.message);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired.'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Authentication error.'
        });
    }
};

/**
 * Middleware for service-to-service authentication
 * This middleware checks for a service token (shared secret) and optional service name
 */
export const authenticateServiceRequest = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;
        const serviceName = req.headers['x-service-name']; // Optional, for logging/auditing

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No service token provided' });
        }

        const token = authHeader.split(' ')[1];

        // Validate service token against the shared secret
        if (token !== config.services.serviceSecret) { // Use the correct config path
            return res.status(403).json({ success: false, message: 'Invalid service token' });
        }

        // Optional: Log the calling service name if provided
        if (serviceName && typeof serviceName === 'string') {
            console.log(`Service-to-service request authenticated from: ${serviceName}`); // Use console.log or logger
        } else {
            console.log('Service-to-service request authenticated (service name not provided)');
        }

        // If the token is valid, proceed
        next();
    } catch (error) {
        console.error('Service authentication error:', error);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
}; 