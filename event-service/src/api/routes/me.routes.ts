import { Router } from 'express';
import * as meController from '../controllers/me.controller';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

router.get('/tickets', meController.listMyTickets);
router.get('/tickets/:id', meController.getMyTicket);
router.get('/orders', meController.listMyOrders);

// Resale-side: still V1 stubs (will land in a follow-up commit)
router.post('/tickets/:id/resale', notImplemented('create resale listing'));
router.get('/resale', notImplemented('list my resale listings'));
router.delete('/resale/:listingId', notImplemented('cancel my resale listing'));

export default router;
