import { Request, Response, NextFunction } from 'express';
import { userServiceClient } from '../../services/clients/user.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('RequireActiveSubscription');

/**
 * Paywall enforcement middleware for payment-service. Pair with `authenticate` first.
 * Mirrors user-service's middleware of the same name — same response contract so the
 * frontend can react identically regardless of which service rejected.
 *
 * Distinct responses:
 *   - 401                                          → handled upstream by authenticate
 *   - 403 { code: SUBSCRIPTION_REQUIRED }          → no active subscription, redirect to /abonnement
 *   - 503 { code: SUBSCRIPTION_CHECK_UNAVAILABLE } → user-service call failed, retry
 *
 * Calls user-service via HTTP. Adds ~20-40ms per protected request. No local cache —
 * frontend Claude pushed back on this when scoping (the lesson from PR #35 is that
 * caching subscription state is exactly how cross-user leaks happen). Add a cache
 * only after load-testing and only with a tight TTL keyed on userId.
 */
export const requireActiveSubscription = async (
    req: Request,
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
        const hasActive = await userServiceClient.hasActiveSubscription(userId);
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
