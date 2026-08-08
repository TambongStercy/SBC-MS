import { Router } from 'express';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { handlePaymentConfirmation } from '../controllers/internal.controller';

/**
 * Called by payment-service, not by browsers. Kept separate from /internal because
 * the URL is baked into payment intents as `metadata.callbackPath` — moving it
 * silently strands every intent already in flight.
 */
const router = Router();

router.use(authenticateServiceRequest);

router.post('/payment-confirmation', handlePaymentConfirmation);

export default router;
