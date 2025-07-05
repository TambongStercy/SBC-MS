import { Router } from 'express';
import adminController from '../controllers/admin.controller';

const router = Router();

// Admin endpoints for transaction status management
router.post('/transactions/check-all', adminController.checkAllTransactionStatuses);
router.post('/transactions/check/:transactionId', adminController.checkSpecificTransaction);
router.get('/transactions/processing-stats', adminController.getProcessingTransactionsStats);
router.get('/transactions/details/:transactionId', adminController.getTransactionDetails);

export default router; 