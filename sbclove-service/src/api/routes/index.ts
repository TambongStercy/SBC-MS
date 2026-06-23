import { Router } from 'express';
import profileRoutes from './profile.routes';
import interestRoutes from './interest.routes';
import matchRoutes from './match.routes';
import adminRoutes from './admin.routes';

const router = Router();

// All SBCLOVE resources live under /sbclove (gateway proxies /api/sbclove here).
router.use('/sbclove/profiles', profileRoutes);
router.use('/sbclove/interests', interestRoutes);
router.use('/sbclove/matches', matchRoutes);
router.use('/sbclove/admin', adminRoutes);

export default router;
