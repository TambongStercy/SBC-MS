import { Router } from 'express';
import { ContactController } from '../controllers/contact.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';
import { ssoBearer } from '../middleware/sso-bearer.middleware';

const router = Router();
const contactController = new ContactController();

/**
 * @route   GET /api/contacts/search
 * @desc    Search for user contacts with filtering (Requires CIBLE subscription for advanced filters)
 * @access  Private (requires authentication + active subscription)
 */
router.get('/search', authenticate as any, requireActiveSubscription as any, generalLimiter, (req: any, res, next) => {
    contactController.searchContacts(req, res);
});

/**
 * @route   GET /api/contacts/export
 * @desc    Export filtered contacts as VCF file (Requires CLASSIQUE or CIBLE)
 * @access  Private (requires authentication + active subscription)
 */
router.get('/export', authenticate as any, requireActiveSubscription as any, generalLimiter, (req: any, res) => {
    contactController.exportContacts(req, res);
});

/**
 * The same two endpoints, for an SSO client acting on behalf of its user.
 *
 * SBC Contacts (Slade, 2026-09-05) needs a live contact list rather than a
 * one-off export. Going through SSO means each SBC member authorises the app
 * themselves and the app sees exactly what that member is entitled to —
 * requireActiveSubscription and the CIBLE/CLASSIQUE filter rules are the same
 * middleware as the first-party routes above, not a re-implementation that could
 * drift from them.
 *
 * Deliberately NOT a bulk export of the member base: there is no endpoint here
 * that returns contacts without a specific user's token behind it.
 */
router.get(
    '/sso/search',
    ssoBearer('contacts.read') as any,
    requireActiveSubscription as any,
    generalLimiter,
    (req: any, res) => {
        contactController.searchContacts(req, res);
    },
);

router.get(
    '/sso/export',
    ssoBearer('contacts.read') as any,
    requireActiveSubscription as any,
    generalLimiter,
    (req: any, res) => {
        contactController.exportContacts(req, res);
    },
);

export default router; 