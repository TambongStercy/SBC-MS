import { Router } from 'express';
import { 
    testWhatsAppNotification, 
    getWhatsAppQr, 
    streamWhatsAppQr,
    getWhatsAppStatus,
    logoutWhatsApp,
    forceReconnectWhatsApp
} from '../controllers/whatsapp.controller';

const router = Router();

router.post('/test-notification', testWhatsAppNotification);
router.get('/qr', getWhatsAppQr);
router.get('/qr/stream', streamWhatsAppQr);
router.get('/status', getWhatsAppStatus);
router.post('/logout', logoutWhatsApp);
router.post('/reconnect', forceReconnectWhatsApp);


export default router; 