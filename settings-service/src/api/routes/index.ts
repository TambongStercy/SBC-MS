import { Router } from 'express';
import settingsRoutes from './settings.routes';
import eventRoutes from './event.routes';
import storageRoutes from './storage.routes';

const router = Router();

router.use('/settings', settingsRoutes);
router.use('/events', eventRoutes);
router.use('/storage', storageRoutes);

export default router; 