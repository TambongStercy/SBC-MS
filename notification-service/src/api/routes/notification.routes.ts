import { Router, Request, Response, NextFunction } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';
import whatsappService from '../../services/whatsapp.service';

const router = Router();

// Routes for authenticated users
router.get('/me', authenticate, (req, res) => notificationController.getUserNotifications(req, res));
router.get('/me/stats', authenticate, (req, res) => notificationController.getUserNotificationStats(req, res));

// Routes for inter-service communication (secure these with API keys in production)
router.post('/otp', authenticateServiceRequest, (req, res) => notificationController.sendOtp(req, res));
router.post('/internal/create', authenticateServiceRequest, (req, res) => notificationController.createInternalNotification(req, res));

// NEW internal route for broadcasting
router.post('/internal/broadcast', authenticateServiceRequest, (req, res, next) => notificationController.handleBroadcastNotification(req, res, next));

// --- NEW EMAIL ROUTES (INTERNAL) ---
router.post('/internal/email/commission-earned', authenticateServiceRequest, (req, res, next) => notificationController.handleCommissionEarnedEmail(req, res, next));
router.post('/internal/email/transaction-successful', authenticateServiceRequest, (req, res, next) => notificationController.handleTransactionSuccessEmail(req, res, next));
router.post('/internal/email/transaction-failed', authenticateServiceRequest, (req, res, next) => notificationController.handleTransactionFailureEmail(req, res, next));
// --- END NEW EMAIL ROUTES ---

// Admin-only routes
router.post('/custom', authenticate, (req, res) => notificationController.sendCustomNotification(req, res));
router.post('/templated', authenticate, (req, res) => notificationController.sendTemplatedNotification(req, res));

// Route for initiating follow-up campaigns (Admin only)
router.post('/follow-up', authenticate, (req, res) => notificationController.sendFollowUpNotifications(req, res));

// NEW ROUTE: Send email with attachment
router.post('/send-email-attachment', (req: Request, res: Response, next: NextFunction) =>
    notificationController.sendEmailWithAttachment(req, res, next)
);

// Queue monitoring route (admin/internal use)
router.get('/queue/stats', authenticateServiceRequest, (req, res) => notificationController.getQueueStats(req, res));

// WhatsApp QR code endpoint
router.get('/whatsapp/qr', (req, res) => {
    const { qr, timestamp } = whatsappService.getLatestQr();
    if (!qr) {
        return res.status(404).json({ success: false, message: 'No QR code available' });
    }
    // Return as image/png
    const base64 = qr.replace(/^data:image\/png;base64,/, '');
    const img = Buffer.from(base64, 'base64');
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': img.length,
        'Cache-Control': 'no-cache',
        'X-QR-Timestamp': timestamp.toString(),
    });
    res.end(img);
});

// WhatsApp QR code SSE stream
router.get('/whatsapp/qr/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    // Send the latest QR immediately if available
    const { qr, timestamp } = whatsappService.getLatestQr();
    if (qr) {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr, timestamp })}\n\n`);
    }
    // Listen for new QR codes
    const onQr = (newQr: string) => {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr: newQr, timestamp: Date.now() })}\n\n`);
    };
    whatsappService.on('qr', onQr);
    // Clean up on client disconnect
    req.on('close', () => {
        whatsappService.off('qr', onQr);
    });
});

export default router; 