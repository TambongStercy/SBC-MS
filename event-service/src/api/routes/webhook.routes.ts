import { Router } from 'express';
import * as webhookController from '../controllers/webhook.controller';

const router = Router();

router.post('/payment-confirmation', webhookController.paymentConfirmation);

export default router;
