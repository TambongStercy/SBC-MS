import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('LaunchGate');

/** The instant the network opens, or null when no gate is configured. */
export const launchAt = (): Date | null => {
    if (!config.launchAt) return null;
    const at = new Date(config.launchAt);
    return Number.isNaN(at.getTime()) ? null : at;
};

export const isLaunched = (): boolean => {
    const at = launchAt();
    return !at || Date.now() >= at.getTime();
};

/**
 * Holds the network shut until launch.
 *
 * Applied to the routes that let someone *participate* — enrolling, creating a
 * campaign, accepting an offer. Landing pages and click tracking stay open:
 * links shown during the presentation have to work, and they expose nothing.
 *
 * Admins pass through, so the whole flow can be rehearsed on production before
 * it is opened to anyone else.
 */
export const requireLaunched = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (isLaunched()) return next();

    const role = req.user?.role;
    if (role === 'admin' || role === 'withdrawal_admin') return next();

    log.info(`Pre-launch request refused: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({
        success: false,
        message: 'SBC Ads Network ouvre bientôt. Revenez au lancement.',
        data: { launched: false, launchAt: launchAt()?.toISOString() ?? null },
    });
};
