import { Router } from 'express';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { activateCampaign, reallocateCampaign } from '../controllers/internal.controller';
import { internalList, internalDetail, internalDecision } from '../controllers/manual-verification.controller';

/**
 * Service-to-service only, guarded by SERVICE_SECRET. Activation moves a campaign
 * to ACTIVE and is what makes it visible to diffuseurs, so it must never be
 * reachable with a user token.
 */
const router = Router();

router.use(authenticateServiceRequest);

router.post('/campaigns/:id/activate', activateCampaign);
router.post('/campaigns/:id/reallocate', reallocateCampaign);

// SBC Support: video proofs (contract §2.3). Decisions are taken there.
router.get('/manual-verifications', internalList);
router.get('/manual-verifications/:id', internalDetail);
router.post('/manual-verifications/:id/decision', internalDecision);

export default router;
