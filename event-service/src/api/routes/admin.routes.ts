import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';

const router = Router();

router.get('/dashboard', adminController.dashboard);

router.get('/organizers', adminController.listOrganizers);
router.post('/organizers/:id/approve', adminController.approveOrganizer);
router.post('/organizers/:id/suspend', adminController.suspendOrganizer);

router.get('/events', adminController.listEvents);
router.get('/events/:id', adminController.getEvent);
router.post('/events/:id/suspend', adminController.suspendEvent);
router.post('/events/:id/cancel', adminController.cancelEvent);

router.get('/orders', adminController.listOrders);
router.post('/orders/:id/refund', adminController.refundOrder);

router.get('/tickets', adminController.listTickets);

router.get('/resale-listings', adminController.listResaleListings);
router.post('/resale-listings/:id/suspend', adminController.suspendResaleListing);
router.delete('/resale-listings/:id', adminController.removeResaleListing);

router.get('/disputes', adminController.listDisputes);
router.post('/disputes/:id/resolve', adminController.resolveDispute);

router.get('/commission-config', adminController.getCommissionConfigController);
router.patch('/commission-config', adminController.bustCommissionConfigCache);

export default router;
