import { Response, NextFunction } from 'express';
import { UserRole } from '../../database/models/user.model'; // Import UserRole enum
import { AuthenticatedRequest } from './auth.middleware'; // Import the extended Request type
import logger from '../../utils/logger';

const log = logger.getLogger('RBAC');

/**
 * Middleware factory for Role-Based Access Control (RBAC).
 * Checks if the authenticated user has one of the allowed roles.
 *
 * @param allowedRoles - An array of UserRole enums that are permitted access.
 * @returns Express middleware function.
 */
export const authorize = (allowedRoles: UserRole[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) :any => {
        // Assumes authenticate middleware has run and attached req.user
        const userRole = req.user?.role;

        if (!userRole) {
            // This should not happen if authenticate middleware is working correctly
            log.error("User role not found on request object after authentication");
            return res.status(403).json({ message: 'Forbidden: Role information missing' });
        }

        if (allowedRoles.includes(userRole)) {
            next(); // User has an allowed role, proceed
        } else {
            log.warn(`Access denied for role '${userRole}'. Allowed: ${allowedRoles.join(', ')}`);
            return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
        }
    };
}; 