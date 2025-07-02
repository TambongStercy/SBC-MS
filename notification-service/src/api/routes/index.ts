import { Router } from 'express';
import notificationRoutes from './notification.routes';
import whatsappRoutes from './whatsapp.routes';
const router = Router();

router.use('/notifications', notificationRoutes);
router.use('/whatsapp', whatsappRoutes);

export default router;