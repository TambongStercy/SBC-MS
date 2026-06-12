import { Router } from 'express';
import { partnerController } from '../controllers/partner.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware'; // Apply general rate limiting

const router = Router();

// Apply authentication + active-subscription gate to all partner routes
// (the entire Partner Space is behind RequireSubscription on the frontend)
router.use(authenticate as any);
router.use(requireActiveSubscription as any);
router.use(generalLimiter); // Apply general rate limit

// Route for partners to get their own details
router.get('/me', (req, res, next) => partnerController.getMyPartnerDetails(req as AuthenticatedRequest, res, next));

// Route for partners to get their commission transactions
router.get('/me/transactions', (req, res, next) => partnerController.getMyPartnerTransactions(req as AuthenticatedRequest, res, next));

export default router; 