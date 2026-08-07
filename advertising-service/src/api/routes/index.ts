import { Router } from 'express';
import campaignRoutes from './campaign.routes';
import diffuseurRoutes from './diffuseur.routes';

const router = Router();

router.use('/advertising/campaigns', campaignRoutes);
router.use('/advertising/diffuseurs', diffuseurRoutes);

export default router;
