import { Router, Request, Response, NextFunction } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authenticateServiceRequest, requireAdmin } from '../middleware/auth.middleware';
import whatsappServiceFactory from '../../services/whatsapp-service-factory';
import config from '../../config';
import { otpDeliveryFor } from '../../services/otp-delivery.service';
import { reactivationReach, sendReactivation } from '../../services/reactivation.service';

const router = Router();

// Routes for authenticated users
router.get('/me', authenticate, (req, res) => notificationController.getUserNotifications(req, res));
router.get('/me/stats', authenticate, (req, res) => notificationController.getUserNotificationStats(req, res));

// Routes for inter-service communication (secure these with API keys in production)
router.post('/otp', authenticateServiceRequest, (req, res) => notificationController.sendOtp(req, res));
router.post('/internal/create', authenticateServiceRequest, (req, res) => notificationController.createInternalNotification(req, res));

// Security plan Phase 11: delivery facts of sign-in codes (no code, body or recipient).
router.post('/internal/otp-delivery', authenticateServiceRequest, async (req: Request, res: Response) => {
    try {
        const since = req.body?.since ? new Date(req.body.since) : undefined;
        const data = await otpDeliveryFor(Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [], since);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'otp delivery lookup failed' });
    }
});

// Security plan Phase 7 part 2: one member of a dormant-account « réactivation » campaign
// (user-service owns the campaign, the approved text and the once-per-30-days rule).
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
router.post('/internal/reactivation/send', authenticateServiceRequest, async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const input = {
        campaignId: str(b.campaignId, 64), userId: str(b.userId, 64), email: str(b.email, 254) || null, name: str(b.name, 120) || null,
        subject: str(b.subject, 160), body: str(b.body, 3000), pushTitle: str(b.pushTitle, 120), pushBody: str(b.pushBody, 400),
    };
    if (!input.campaignId || !/^[a-f0-9]{24}$/i.test(input.userId) || !input.subject || !input.body || !input.pushTitle || !input.pushBody) {
        res.status(400).json({ success: false, message: 'campaignId, userId, subject, body, pushTitle and pushBody are required' });
        return;
    }
    try {
        res.json({ success: true, data: await sendReactivation(input) });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'reactivation send failed' });
    }
});
router.post('/internal/reactivation/reach', authenticateServiceRequest, async (req: Request, res: Response) => {
    try {
        const emails = Array.isArray(req.body?.emails) ? req.body.emails.map(String) : [];
        const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
        res.json({ success: true, data: await reactivationReach(emails, userIds) });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'reach lookup failed' });
    }
});

// NEW internal route for broadcasting
router.post('/internal/broadcast', authenticateServiceRequest, (req, res, next) => notificationController.handleBroadcastNotification(req, res, next));

// --- NEW EMAIL ROUTES (INTERNAL) ---
// No commission email: commissions are push + in-app notifications only (2026-10-07).
router.post('/internal/email/transaction-successful', authenticateServiceRequest, (req, res, next) => notificationController.handleTransactionSuccessEmail(req, res, next));
router.post('/internal/email/transaction-failed', authenticateServiceRequest, (req, res, next) => notificationController.handleTransactionFailureEmail(req, res, next));
router.post('/internal/email/account-activation', authenticateServiceRequest, (req, res, next) => notificationController.handleAccountActivationEmail(req, res, next));
router.post('/internal/email/welcome', authenticateServiceRequest, (req, res, next) => notificationController.handleWelcomeEmail(req, res, next));
// Contact export email route
router.post('/contact-export-email', authenticateServiceRequest, (req, res, next) => notificationController.handleContactExportEmail(req, res, next));
// --- END NEW EMAIL ROUTES ---

// Admin-only routes
router.post('/custom', authenticate, requireAdmin, (req, res) => notificationController.sendCustomNotification(req, res));
router.post('/templated', authenticate, requireAdmin, (req, res) => notificationController.sendTemplatedNotification(req, res));

// Route for initiating follow-up campaigns (Admin only)
router.post('/follow-up', authenticate, requireAdmin, (req, res) => notificationController.sendFollowUpNotifications(req, res));

// NEW ROUTE: Send email with attachment
// Service only (user-service's contact exports). It had no authentication: anyone
// could have mailed any attachment through our server.
router.post('/send-email-attachment', authenticateServiceRequest, (req: Request, res: Response, next: NextFunction) =>
    notificationController.sendEmailWithAttachment(req, res, next)
);

// Queue monitoring route (admin/internal use)
router.get('/queue/stats', authenticateServiceRequest, (req, res) => notificationController.getQueueStats(req, res));

// WhatsApp QR code endpoint
router.get('/whatsapp/qr', authenticate, requireAdmin, (req, res) => {
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
router.get('/whatsapp/qr/stream', authenticate, requireAdmin, (req, res) => {
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