import { Router } from 'express';
import transactionRoutes from './transaction.routes';
import paymentRoutes from './payment.routes';
import internalRoutes from './internal.routes';
import payoutRoutes from './payout.routes';
import withdrawalRoutes from './withdrawal.routes';
import withdrawalApprovalRoutes from './withdrawal-approval.routes';
import adminRoutes from './admin.routes';
import recoveryRoutes from './recovery.routes';
import supportRoutes from './support.routes';

const router = Router();

router.use('/transactions', transactionRoutes);
router.use('/payments', paymentRoutes);
// SBC Support (contract §2.2), before /internal so its own auth and logging apply.
router.use('/internal/support', supportRoutes);
router.use('/internal', internalRoutes);
router.use('/payouts', payoutRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/admin/withdrawals', withdrawalApprovalRoutes); // Admin withdrawal approval routes
router.use('/admin', adminRoutes);
router.use('/', recoveryRoutes); // Recovery routes include both /internal and /admin prefixes

export default router;