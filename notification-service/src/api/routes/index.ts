import { Router } from 'express';
import notificationRoutes from './notification.routes';
import whatsappRoutes from './whatsapp.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

router.use('/notifications', notificationRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/webhook', webhookRoutes);

export default router;