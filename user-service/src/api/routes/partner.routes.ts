import { Router } from 'express';
import { partnerController } from '../controllers/partner.controller';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware'; // Apply general rate limiting

const router = Router();

// Apply authentication middleware to all partner routes
router.use(authenticate as any);
router.use(generalLimiter); // Apply general rate limit

// Route for partners to get their own details
router.get('/me', (req, res, next) => partnerController.getMyPartnerDetails(req as AuthenticatedRequest, res, next));

// Route for partners to get their commission transactions
router.get('/me/transactions', (req, res, next) => partnerController.getMyPartnerTransactions(req as AuthenticatedRequest, res, next));

export default router; 