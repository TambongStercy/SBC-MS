import { Router } from 'express';
import adminRoutes from './admin.routes';
import campaignRoutes from './campaign.routes';
import diffuseurRoutes from './diffuseur.routes';
import internalRoutes from './internal.routes';
import verificationRoutes from './verification.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

router.use('/advertising/admin', adminRoutes);
router.use('/advertising/campaigns', campaignRoutes);
router.use('/advertising/diffuseurs', diffuseurRoutes);
router.use('/advertising/verification', verificationRoutes);
router.use('/advertising/internal', internalRoutes);
router.use('/advertising/webhooks', webhookRoutes);

export default router;
