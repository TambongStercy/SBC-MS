import { Router } from 'express';
import { profileController } from '../controllers/profile.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

// GET /interests/me - interests sent by the caller + remaining weekly quota
router.get('/me', (req, res, next) => profileController.getMyInterests(req, res, next));

export default router;
