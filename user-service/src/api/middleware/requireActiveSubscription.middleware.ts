import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { subscriptionRepository } from '../../database/repositories/subscription.repository';
import logger from '../../utils/logger';

const log = logger.getLogger('RequireActiveSubscription');

/**
 * Paywall enforcement middleware. Pair with `authenticate` first.
 *
 * Three distinct response shapes so the frontend can react correctly:
 *   - 401 (delegated to authenticate)            → session expired, log out
 *   - 403 { code: SUBSCRIPTION_REQUIRED }        → no active subscription, redirect to /abonnement
 *   - 503 { code: SUBSCRIPTION_CHECK_UNAVAILABLE } → repo failed, retry (DO NOT redirect; user might be subscribed)
 *
 * The 503 case is load-bearing: if MongoDB blips, we must not bounce subscribed users
 * to /abonnement — that would look like spontaneous unsubscribing. Fail-closed on
 * access, fail-loud on the verification check itself.
 *
 * No local cache (deliberate — frontend Claude pushed back on this when scoping). Every
 * protected request hits the DB. Add caching only after middleware is proven and we
 * have a real load test.
 */
export const requireActiveSubscription = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
        // authenticate should have rejected already; defensive belt
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return;
    }

    try {
        const hasActive = await subscriptionRepository.hasActiveSubscription(userId);
        if (!hasActive) {
            res.status(403).json({
                success: false,
                code: 'SUBSCRIPTION_REQUIRED',
                message: "Un abonnement actif est requis pour accéder à cette ressource.",
            });
            return;
        }
        next();
    } catch (error: any) {
        log.error(`Subscription check failed for user ${userId}: ${error.message}`);
        res.status(503).json({
            success: false,
            code: 'SUBSCRIPTION_CHECK_UNAVAILABLE',
            message: "Impossible de vérifier votre abonnement. Veuillez réessayer.",
        });
    }
};
