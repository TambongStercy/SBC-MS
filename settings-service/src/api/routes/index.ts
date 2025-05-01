import { Router } from 'express';
import settingsRoutes from './settings.routes';
import eventRoutes from './event.routes';

const router = Router();

router.use('/settings', settingsRoutes);
router.use('/events', eventRoutes);

export default router; 