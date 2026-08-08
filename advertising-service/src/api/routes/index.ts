import { Router } from 'express';
import adminRoutes from './admin.routes';
import campaignRoutes from './campaign.routes';
import diffuseurRoutes from './diffuseur.routes';
import internalRoutes from './internal.routes';
import verificationRoutes from './verification.routes';

const router = Router();

router.use('/advertising/admin', adminRoutes);
router.use('/advertising/campaigns', campaignRoutes);
router.use('/advertising/diffuseurs', diffuseurRoutes);
router.use('/advertising/verification', verificationRoutes);
router.use('/advertising/internal', internalRoutes);

export default router;
