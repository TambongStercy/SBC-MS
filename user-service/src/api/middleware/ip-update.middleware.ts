import { Response, NextFunction } from 'express';
import { userRepository } from '../../database/repositories/user.repository';
import { AuthenticatedRequest } from './auth.middleware';
import logger from '../../utils/logger';

const log = logger.getLogger('IP-Update');

/**
 * Middleware to update the user's last known IP address.
 * Runs after the 'authenticate' middleware.
 * Updates the IP asynchronously and does not block the request flow.
 */
export const updateLastIp = (req: AuthenticatedRequest, res: Response, next: NextFunction) : any => {
    // Check if user is authenticated and IP is available
    if (req.user?.userId && req.ip) {
        const userId = req.user.userId;
        const currentIp = req.ip;

        // Fetch user quickly to compare IP, but don't block request
        userRepository.findById(userId)
            .then(user => {
                if (user && user.ipAddress !== currentIp) {
                    // If IP changed, update it in the background
                    userRepository.updateIpAddress(userId, { ipAddress: currentIp })
                        .catch(err => {
                            log.error(`Failed to update IP for user ${userId}`, err);
                        });
                }
            })
            .catch(err => {
                // Log error if user fetch fails, but don't block
                log.error(`Failed to fetch user ${userId} for IP check`, err);
            });
    }

    next(); // Always proceed to the next middleware/handler immediately
}; 