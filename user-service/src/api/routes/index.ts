import { Router } from 'express';
import userRoutes from './user.routes';
import contactRoutes from './contact.routes';
import subscriptionRoutes from './subscription.routes';
import dailyWithdrawalRoutes from './daily-withdrawal.routes';
import adminRoutes from './admin.routes';
const router = Router();



// Mount routes
router.use('/users/admin', adminRoutes);
router.use('/users', userRoutes);
router.use('/contacts', contactRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/withdrawals', dailyWithdrawalRoutes);

export default router;