import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// Mes billets
router.get('/tickets', notImplemented('list my tickets'));
router.get('/tickets/:id', notImplemented('my ticket detail (QR)'));
router.post('/tickets/:id/resale', notImplemented('create resale listing'));
router.get('/resale', notImplemented('list my resale listings'));
router.delete('/resale/:listingId', notImplemented('cancel my resale listing'));
router.get('/orders', notImplemented('list my orders'));

export default router;
