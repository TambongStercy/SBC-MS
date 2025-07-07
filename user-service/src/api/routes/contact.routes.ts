import { Router } from 'express';
import { ContactController } from '../controllers/contact.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const contactController = new ContactController();

/**
 * @route   GET /api/contacts/search
 * @desc    Search for user contacts with filtering (Requires CIBLE subscription for advanced filters)
 * @access  Private (requires authentication)
 */
router.get('/search', authenticate as any, generalLimiter, (req: any, res, next) => {
    contactController.searchContacts(req, res);
});

/**
 * @route   GET /api/contacts/export
 * @desc    Export filtered contacts as VCF file (Requires CLASSIQUE or CIBLE)
 * @access  Private (requires authentication)
 */
router.get('/export', authenticate as any, generalLimiter, (req: any, res) => {
    contactController.exportContacts(req, res);
});

export default router; 