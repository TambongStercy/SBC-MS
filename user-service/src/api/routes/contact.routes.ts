import { Router } from 'express';
// Remove ContactController if no longer used
// import { ContactController } from '../controllers/contact.controller';
// Import UserController for the export method
import { userController } from '../controllers/user.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware'; // Import limiter

const router = Router();
// Remove instance if not used
// const contactController = new ContactController();

/**
 * @route   GET /api/contacts/search
 * @desc    Search for user contacts with filtering (Requires CIBLE subscription)
 * @access  Private (requires authentication)
 */
// Ensure this uses the correct controller method if it was moved
// Apply general limiter after authentication
router.get('/search', authenticate as any, generalLimiter, (req: any, res, next) => {
    userController.searchContactUsers(req, res, next);
});

/**
 * @route   GET /api/contacts/export
 * @desc    Export filtered contacts as CSV (Requires CLASSIQUE or CIBLE)
 * @access  Private (requires authentication)
 */
// Added the export route here
// Apply general limiter after authentication
router.get('/export', authenticate as any, generalLimiter, (req: any, res) => {
    userController.exportContacts(req, res);
});

export default router; 