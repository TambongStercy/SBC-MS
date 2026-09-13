import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// payment-service posts terminal payment status here for order + resale settlement.
router.post('/payment-confirmation', notImplemented('payment webhook'));

export default router;
