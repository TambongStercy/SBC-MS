import { Router } from 'express';
import { testWhatsAppNotification } from '../controllers/whatsapp.controller';

const router = Router();

router.post('/test-notification', testWhatsAppNotification);

export default router; 