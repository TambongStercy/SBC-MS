import { Router } from 'express';
import settingsRoutes from './settings.routes';
import eventRoutes from './event.routes';
import storageRoutes from './storage.routes';

const router = Router();

// Settings routes (including file uploads)
router.use('/settings', settingsRoutes);

// Storage monitoring routes (under settings)
router.use('/settings/storage', storageRoutes);

// Event routes  
router.use('/events', eventRoutes);

export default router; 