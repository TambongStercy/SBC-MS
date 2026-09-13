import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

router.get('/dashboard', notImplemented('admin dashboard stats'));

router.get('/organizers', notImplemented('admin list organizers'));
router.post('/organizers/:id/approve', notImplemented('admin approve organizer'));
router.post('/organizers/:id/suspend', notImplemented('admin suspend organizer'));

router.get('/events', notImplemented('admin list events'));
router.get('/events/:id', notImplemented('admin get event'));
router.post('/events/:id/suspend', notImplemented('admin suspend event'));
router.post('/events/:id/cancel', notImplemented('admin cancel event'));

router.get('/orders', notImplemented('admin list orders'));
router.post('/orders/:id/refund', notImplemented('admin refund order'));

router.get('/resale-listings', notImplemented('admin list resale listings'));
router.post('/resale-listings/:id/suspend', notImplemented('admin suspend listing'));
router.delete('/resale-listings/:id', notImplemented('admin remove listing'));

router.get('/disputes', notImplemented('admin list disputes'));
router.post('/disputes/:id/resolve', notImplemented('admin resolve dispute'));

router.get('/commission-config', notImplemented('admin get commission config'));
router.patch('/commission-config', notImplemented('admin update commission config'));

export default router;
