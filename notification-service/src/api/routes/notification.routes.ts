import { Router, Request, Response, NextFunction } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';
import whatsappServiceFactory from '../../services/whatsapp-service-factory';
import config from '../../config';

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
router.post('/internal/email/account-activation', authenticateServiceRequest, (req, res, next) => notificationController.handleAccountActivationEmail(req, res, next));
router.post('/internal/email/welcome', authenticateServiceRequest, (req, res, next) => notificationController.handleWelcomeEmail(req, res, next));
// Contact export email route
router.post('/contact-export-email', authenticateServiceRequest, (req, res, next) => notificationController.handleContactExportEmail(req, res, next));
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
    // QR code functionality is only available for Bailey implementation
    if (config.whatsapp.enableCloudApi) {
        return res.status(404).json({
            success: false,
            message: 'QR code is not available when using WhatsApp Cloud API. Please use the Meta Business Manager to configure your WhatsApp Business account.'
        });
    }

    const service = whatsappServiceFactory.getService() as any;

    // Check if the service has the getLatestQr method (Bailey-specific)
    if (!service.getLatestQr) {
        return res.status(404).json({ success: false, message: 'QR code functionality not available' });
    }

    const { qr, timestamp } = service.getLatestQr();
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
    // QR code functionality is only available for Bailey implementation
    if (config.whatsapp.enableCloudApi) {
        return res.status(404).json({
            success: false,
            message: 'QR code streaming is not available when using WhatsApp Cloud API. Please use the Meta Business Manager to configure your WhatsApp Business account.'
        });
    }

    const service = whatsappServiceFactory.getService() as any;

    // Check if the service has the required methods (Bailey-specific)
    if (!service.getLatestQr || !service.on || !service.off) {
        return res.status(404).json({ success: false, message: 'QR code streaming functionality not available' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    // Send the latest QR immediately if available
    const { qr, timestamp } = service.getLatestQr();
    if (qr) {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr, timestamp })}\n\n`);
    }
    // Listen for new QR codes
    const onQr = (newQr: string) => {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr: newQr, timestamp: Date.now() })}\n\n`);
    };
    service.on('qr', onQr);
    // Clean up on client disconnect
    req.on('close', () => {
        service.off('qr', onQr);
    });
});

export default router; 