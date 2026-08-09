import { Router } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import {
    listForReview,
    approve,
    reject,
    getAnalytics,
    getCampaignPerformance,
    listDiffuseurs,
    getTestCampaignConfig,
    saveTestCampaign,
    removeTestCampaign,
} from '../controllers/admin.controller';

/**
 * Admin-only. Approval here is what lets a creative reach thousands of people's
 * personal WhatsApp statuses, so the role check is not optional on any of these.
 */
const router = Router();

router.use(authenticate, authorizeAdmin);

router.get('/analytics', getAnalytics);
router.get('/campaigns', listForReview);
router.get('/diffuseurs', listDiffuseurs);

// The test campaign: SBC's own, used to measure a new diffuseur's real audience
// before they are trusted with work an annonceur paid for.
router.get('/test-campaign', getTestCampaignConfig);
router.put('/test-campaign', saveTestCampaign);
router.delete('/test-campaign', removeTestCampaign);
router.get('/campaigns/:id/performance', getCampaignPerformance);
router.post('/campaigns/:id/approve', approve);
router.post('/campaigns/:id/reject', reject);

export default router;
