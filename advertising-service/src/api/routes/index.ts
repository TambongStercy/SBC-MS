import { Router } from 'express';
import adminRoutes from './admin.routes';
import campaignRoutes from './campaign.routes';
import diffuseurRoutes from './diffuseur.routes';
import internalRoutes from './internal.routes';
import verificationRoutes from './verification.routes';
import webhookRoutes from './webhook.routes';
import { requireLaunched, isLaunched, launchAt } from '../middleware/launch.middleware';

const router = Router();

/** Unauthenticated: the app asks this to decide between the network and a countdown. */
router.get('/advertising/launch', (_req, res) => res.json({
    success: true,
    data: { launched: isLaunched(), launchAt: launchAt()?.toISOString() ?? null },
}));

router.use('/advertising/admin', adminRoutes);
// Participation is gated until launch; admin, landing pages, click tracking
// and internal service calls are not (see launch.middleware).
router.use('/advertising/campaigns', requireLaunched, campaignRoutes);
router.use('/advertising/diffuseurs', requireLaunched, diffuseurRoutes);
router.use('/advertising/verification', requireLaunched, verificationRoutes);
router.use('/advertising/internal', internalRoutes);
router.use('/advertising/webhooks', webhookRoutes);

export default router;
