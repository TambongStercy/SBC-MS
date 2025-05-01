import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { CustomError } from '../../utils/custom-error';

// Extending Express Request type to include user property
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role: string;
                email: string;
            };
        }
    }
}

/**
 * Middleware to authenticate user based on JWT token
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new CustomError('Unauthorized: Authentication token required', 401);
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        try {
            const decoded = jwt.verify(token, config.jwt.secret) as any;

            req.user = {
                id: decoded.userId,
                role: decoded.role,
                email: decoded.email
            };
            next();
        } catch (error) {
            throw new CustomError('Unauthorized: Invalid token', 401);
        }
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Middleware to authorize based on user roles
 * @param allowedRoles Array of roles that are allowed to access the route
 */
export const authorize = (allowedRoles: string[]): (req: Request, res: Response, next: NextFunction) => Promise<any> => {
    return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
        try {
            // Check if user exists (should be set by authenticate middleware)
            if (!req.user) {
                throw new CustomError('Unauthorized: User not authenticated', 401);
            }

            // Check if user role is in allowed roles
            if (!allowedRoles.includes(req.user.role)) {
                throw new CustomError('Forbidden: Insufficient permissions', 403);
            }

            next();
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };
};

/**
 * Middleware to authenticate service-to-service communication
 */
export const authenticateServiceRequest = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new CustomError('Unauthorized: Service token required', 401);
        }

        const token = authHeader.split(' ')[1];
        // Verify token is the service secret from config
        if (token !== config.services.serviceSecret) {
            throw new CustomError('Unauthorized: Invalid service token', 401);
        }


        // Optional: Check service name header if needed (keep for consistency for now)
        const serviceName = req.headers['x-service-name'];
        if (!serviceName || typeof serviceName !== 'string') {
            // Consider making this optional or removing if only the secret is needed
            throw new CustomError('Unauthorized: Service name header required', 401);
        }

        // Optional: Validate service name if needed
        // const allowedServices = ['user-service', 'payment-service', 'notification-service'];
        // if (!allowedServices.includes(serviceName)) {
        //     throw new CustomError('Forbidden: Unknown service', 403);
        // }

        console.log(`Service-to-service call authenticated (caller: ${serviceName || 'unknown'})`);
        next();
    } catch (error) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
}; 