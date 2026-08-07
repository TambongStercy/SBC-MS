import { Router } from 'express';
import campaignRoutes from './campaign.routes';
import diffuseurRoutes from './diffuseur.routes';
import internalRoutes from './internal.routes';

const router = Router();

router.use('/advertising/campaigns', campaignRoutes);
router.use('/advertising/diffuseurs', diffuseurRoutes);
router.use('/advertising/internal', internalRoutes);

export default router;
