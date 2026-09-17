import { Router } from 'express';
import * as resaleController from '../controllers/resale.controller';

const router = Router();

// POST /api/tickets/resale/:listingId/buy — initiate purchase of a resale ticket
router.post('/:listingId/buy', resaleController.buyListing);

export default router;
