import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

router.get('/dashboard', adminController.dashboard);

router.get('/organizers', adminController.listOrganizers);
router.post('/organizers/:id/approve', adminController.approveOrganizer);
router.post('/organizers/:id/suspend', adminController.suspendOrganizer);

router.get('/events', adminController.listEvents);
router.get('/events/:id', adminController.getEvent);
router.post('/events/:id/suspend', adminController.suspendEvent);
router.post('/events/:id/cancel', adminController.cancelEvent);

router.post('/orders/:id/refund', adminController.refundOrder);

// Still stubs — landing in a follow-up commit
router.get('/orders', notImplemented('admin list orders'));
router.get('/resale-listings', notImplemented('admin list resale listings'));
router.post('/resale-listings/:id/suspend', notImplemented('admin suspend listing'));
router.delete('/resale-listings/:id', notImplemented('admin remove listing'));
router.get('/disputes', notImplemented('admin list disputes'));
router.post('/disputes/:id/resolve', notImplemented('admin resolve dispute'));
router.get('/commission-config', notImplemented('admin get commission config'));
router.patch('/commission-config', notImplemented('admin update commission config'));

export default router;
