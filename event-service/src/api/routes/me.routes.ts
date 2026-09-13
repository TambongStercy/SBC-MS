import { Router } from 'express';
import * as meController from '../controllers/me.controller';
import * as resaleController from '../controllers/resale.controller';

const router = Router();

router.get('/tickets', meController.listMyTickets);
router.get('/tickets/:id', meController.getMyTicket);
router.get('/orders', meController.listMyOrders);

router.post('/tickets/:ticketId/resale', resaleController.createListing);
router.get('/resale', resaleController.listMyListings);
router.delete('/resale/:listingId', resaleController.cancelListing);

export default router;
