import { Router } from 'express';
import transactionRoutes from './transaction.routes';
import paymentRoutes from './payment.routes';
import internalRoutes from './internal.routes';

const router = Router();

router.use('/transactions', transactionRoutes);
router.use('/payments', paymentRoutes);
router.use('/internal', internalRoutes);

export default router; 