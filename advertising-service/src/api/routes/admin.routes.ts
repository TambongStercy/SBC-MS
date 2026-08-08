import { Router } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { listForReview, approve, reject, getAnalytics } from '../controllers/admin.controller';

/**
 * Admin-only. Approval here is what lets a creative reach thousands of people's
 * personal WhatsApp statuses, so the role check is not optional on any of these.
 */
const router = Router();

router.use(authenticate, authorizeAdmin);

router.get('/analytics', getAnalytics);
router.get('/campaigns', listForReview);
router.post('/campaigns/:id/approve', approve);
router.post('/campaigns/:id/reject', reject);

export default router;
