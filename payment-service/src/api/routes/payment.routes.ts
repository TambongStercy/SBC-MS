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

adminRouter.post('/reprocess-feexpay-payments/user/:userId', paymentController.adminReprocessFeexpayUserPayments);

// Manual payment intent creation for recovery
adminRouter.post('/create-manual-intent', paymentController.createManualPaymentIntent);

// Search and recover existing payment intents
adminRouter.get('/search-payment-intent/:reference', paymentController.searchPaymentIntent);
adminRouter.post('/recover-payment-intent', paymentController.recoverExistingPaymentIntent);

router.use('/admin', adminRouter);

// --- Existing Public/General Routes --- 

// Render the custom payment page
router.get('/page/:sessionId', paymentController.renderPaymentPage);
// Same as above due to errors in the frontend
router.get('/process/:sessionId', paymentController.renderPaymentPage);

// Create a new payment intent (returns URL to custom payment page)
router.post('/intents', validatePaymentIntent, paymentController.createPaymentIntent);

// Submit payment details and initiate provider payment
router.post('/intents/:sessionId/submit', validatePaymentDetails, paymentController.submitPaymentDetails);

// Check payment status (useful especially for Lygos polling)
router.get('/intents/:sessionId/status', paymentController.getPaymentStatus);

// NEW Public FeexPay Status Endpoint (using sessionId)
router.get('/intents/:sessionId/feexpay-status', paymentController.getUserFeexpayStatus);

// Route for Feexpay payment webhook endpoint
router.post('/webhooks/feexpay', paymentController.handleFeexpayWebhook);

// Route for CinetPay payment webhook endpoint
router.post('/webhooks/cinetpay', paymentController.handleCinetPayWebhook);

// Webhook for CinetPay Transfer (Payout) status updates
router.post('/webhooks/cinetpay/transfer-status', paymentController.handleCinetpayTransferWebhook);

// Route for NOWPayments crypto webhook endpoint
router.post('/webhooks/nowpayments', paymentController.handleNowPaymentsWebhook);

// Route for NOWPayments payout webhook endpoint
router.post('/webhooks/nowpayments/payout', paymentController.handleNowPaymentsPayoutWebhook);

// --- Crypto Payment Routes ---

// Get available cryptocurrencies
router.get('/crypto/currencies', paymentController.getAvailableCryptoCurrencies);

// Get crypto payment estimate
router.post('/crypto-estimate', paymentController.getCryptoEstimate);
router.get('/crypto/estimate', paymentController.getCryptoPaymentEstimate);

// Create crypto payment intent
router.post('/crypto-payment', paymentController.createCryptoPayment);

// Get payment status
router.get('/status/:sessionId', paymentController.getPaymentStatus);

// Create crypto payout (requires authentication)
router.post('/crypto/payout', authenticate, paymentController.createCryptoPayout);

// Debug NOWPayments connection
router.get('/crypto/debug', paymentController.debugNowPayments);

export default router; 