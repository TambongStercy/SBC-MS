import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';

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
// --- END NEW EMAIL ROUTES ---

// Admin-only routes
router.post('/custom', authenticate, (req, res) => notificationController.sendCustomNotification(req, res));
router.post('/templated', authenticate, (req, res) => notificationController.sendTemplatedNotification(req, res));

// Route for initiating follow-up campaigns (Admin only)
router.post('/follow-up', authenticate, (req, res) => notificationController.sendFollowUpNotifications(req, res));

export default router; 