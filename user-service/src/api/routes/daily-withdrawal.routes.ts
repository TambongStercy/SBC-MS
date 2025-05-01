import { Router } from 'express';
import { dailyWithdrawalController } from '../controllers/daily-withdrawal.controller';
import { authenticate } from '../middleware/auth.middleware';
import { UserRole } from '../../database/models/user.model';

const router = Router();

// Admin-only routes 
router.get('/', authenticate as any, (req, res) =>
    dailyWithdrawalController.getAllWithdrawals(req, res)
);

router.get('/date-range', authenticate as any , (req, res) =>
    dailyWithdrawalController.getWithdrawalsInDateRange(req, res)
);

router.get('/stats', authenticate as any, (req, res) =>
    dailyWithdrawalController.getWithdrawalStats(req, res)
);

export default router; 