import { authenticate, requireAdmin } from '../middleware/auth.middleware';
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

// Admin only: until 2026-11-16 anyone could read the QR code, log the server's
// WhatsApp out or force a reconnect (no authentication at all).
router.use(authenticate, requireAdmin);

router.post('/test-notification', testWhatsAppNotification);
router.get('/qr', getWhatsAppQr);
router.get('/qr/stream', streamWhatsAppQr);
router.get('/status', getWhatsAppStatus);
router.post('/logout', logoutWhatsApp);
router.post('/reconnect', forceReconnectWhatsApp);


export default router; 