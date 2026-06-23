import { Router } from 'express';
import { moduleController } from '../controllers/module.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

// GET /sbclove/status - module availability (kill-switch + weekly window)
router.get('/status', (req, res, next) => moduleController.getStatus(req, res, next));

export default router;
