import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../../utils/jwt';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('AuthMiddleware');

export interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}

/**
 * User authentication middleware
 */
export const authenticate = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<any> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication token required'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (error: any) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Authentication failed'
        });
    }
};

/**
 * Service-to-service authentication middleware
 */
export const authenticateServiceRequest = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        const serviceName = req.headers['x-service-name'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No service token provided'
            });
        }

        const token = authHeader.split(' ')[1];

        if (token !== config.services.serviceSecret) {
            return res.status(403).json({
                success: false,
                message: 'Invalid service token'
            });
        }

        if (serviceName && typeof serviceName === 'string') {
            log.debug(`Service-to-service request from: ${serviceName}`);
        }

        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

/**
 * Admin role check middleware
 */
export const requireAdmin = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<any> => {
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

/**
 * Restricts the WhatsApp-style status feature to staff.
 *
 * Status media is the single most expensive thing SBC serves: 121 MiB of live
 * files generating ~65 GiB of Cloud Storage egress a day, because every viewer
 * pulls every author's photos and videos. Sterling turned the feature off for
 * ordinary members on 2026-09-08 while the storage bill is brought under control
 * and the media is migrated off Google Cloud.
 *
 * Testers are included alongside admins so the feature can still be exercised on
 * the real app rather than only in preprod.
 *
 * Set STATUS_FEATURE_ENABLED=true to open it back up to everyone — no deploy
 * needed, which is the point: this is a switch, not a removal.
 */
const STATUS_ROLES = new Set(['admin', 'tester']);

export const requireStatusAccess = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<any> => {
    if (process.env.STATUS_FEATURE_ENABLED === 'true') return next();

    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!STATUS_ROLES.has(String(req.user.role))) {
        return res.status(403).json({
            success: false,
            code: 'STATUS_FEATURE_DISABLED',
            message: "Les statuts sont temporairement indisponibles. Merci de votre patience.",
        });
    }

    next();
};
