import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { validatePaymentIntent, validatePaymentDetails } from '../middleware/validation';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';

const router = Router();
const adminRouter = Router();
const paymentController = new PaymentController();

// --- Admin Routes --- 
adminRouter.use(authenticate);
adminRouter.use(requireAdmin);

adminRouter.get('/transactions', paymentController.adminListTransactions);

// --- Admin Stats Sub-Router ---
const statsRouter = Router();
statsRouter.get('/total-withdrawals', paymentController.adminGetTotalWithdrawals);
statsRouter.get('/total-revenue', paymentController.adminGetTotalRevenue);
statsRouter.get('/monthly-revenue', paymentController.adminGetMonthlyRevenue);
statsRouter.get('/activity-overview', paymentController.adminGetActivityOverview);

adminRouter.use('/stats', statsRouter); // Mount stats routes under /admin/stats
// --- End Admin Stats ---

router.use('/admin', adminRouter);

// --- Existing Public/General Routes --- 

// Render the custom payment page
router.get('/page/:sessionId', paymentController.renderPaymentPage);

// Create a new payment intent (returns URL to custom payment page)
router.post('/intents', validatePaymentIntent, paymentController.createPaymentIntent);

// Submit payment details and initiate provider payment
router.post('/intents/:sessionId/submit', validatePaymentDetails, paymentController.submitPaymentDetails);

// Check payment status (useful especially for Lygos polling)
router.get('/intents/:sessionId/status', paymentController.getPaymentStatus);

// Feexpay webhook endpoint
router.post('/webhooks/feexpay', paymentController.handleFeexpayWebhook);

// Add route for CinetPay webhook
router.post('/webhooks/cinetpay', paymentController.handleCinetPayWebhook);

export default router; 