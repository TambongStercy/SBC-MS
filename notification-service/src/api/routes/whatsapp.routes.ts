import { Router } from 'express';
import { testWhatsAppNotification, getWhatsAppQr, streamWhatsAppQr } from '../controllers/whatsapp.controller';

const router = Router();

router.post('/test-notification', testWhatsAppNotification);
router.get('/qr', getWhatsAppQr);
router.get('/qr/stream', streamWhatsAppQr);

export default router; 