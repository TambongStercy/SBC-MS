import { Router } from 'express';
import notificationRoutes from './notification.routes';
import whatsappRoutes from './whatsapp.routes';
import webhookRoutes from './webhook.routes';
import relanceRoutes from './relance.routes';
import pushRoutes from './push.routes';
import inboxRoutes from './inbox.routes';
import sendgridWebhookRoutes from './sendgrid-webhook.routes';

const router = Router();

router.use('/notifications/push', pushRoutes);
router.use('/notifications/inbox', inboxRoutes);
router.use('/notifications', notificationRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/webhook', webhookRoutes);
router.use('/relance', relanceRoutes);
router.use('/webhooks/sendgrid', sendgridWebhookRoutes);

export default router;