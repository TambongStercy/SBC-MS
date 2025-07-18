import { Router } from 'express';
import { 
    testWhatsAppNotification, 
    getWhatsAppQr, 
    streamWhatsAppQr,
    getWhatsAppStatus,
    logoutWhatsApp
} from '../controllers/whatsapp.controller';

const router = Router();

router.post('/test-notification', testWhatsAppNotification);
router.get('/qr', getWhatsAppQr);
router.get('/qr/stream', streamWhatsAppQr);
router.get('/status', getWhatsAppStatus);
router.post('/logout', logoutWhatsApp);

export default router; 