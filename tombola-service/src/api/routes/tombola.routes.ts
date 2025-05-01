import { Router } from 'express';
import { tombolaController } from '../controllers/tombola.controller';
import { adminController } from '../controllers/admin.controller'; // Import Admin Controller
import { authenticate, authorizeAdmin, authenticateServiceRequest } from '../middleware/auth.middleware'; // Import Auth Middlewares
// import { verifyPaymentWebhook } from '../middleware/webhook.middleware'; // Import webhook verification

const router = Router();

// === Public User Facing Routes ===

// GET / - List current/past tombolas (Public or Authenticated? Decide later)
router.get('/', tombolaController.getTombolas);

// GET /current - Get details of the current open tombola (Public)
router.get('/current', tombolaController.getCurrentTombola);

// GET /:monthId/winners - Get winners for a specific closed tombola month (Public)
router.get('/:monthId/winners', tombolaController.getWinners);

// POST /current/buy-ticket - Initiate ticket purchase (Requires Auth)
router.post(
    '/current/buy-ticket',
    authenticate, // Apply user authentication middleware
    (req, res, next) => tombolaController.initiatePurchase(req, res, next)
);

// GET /tickets/me - Get tickets purchased by the authenticated user (Paginated)
router.get(
    '/tickets/me',
    authenticate,
    (req, res, next) => tombolaController.getMyTickets(req, res, next)
);

// === Webhook Routes ===

// POST /webhooks/payment-confirmation - Handles confirmation from payment service
router.post(
    '/webhooks/payment-confirmation',
    authenticateServiceRequest,
    // verifyPaymentWebhook, // Verify the webhook source/signature
    (req, res, next) => tombolaController.handlePaymentWebhook(req, res, next)
);

// === Admin Routes ===
const adminRouter = Router();
adminRouter.use(authenticate);   // First, verify JWT
adminRouter.use(authorizeAdmin); // Then, ensure user is admin

// POST /admin/ - Create a new TombolaMonth
adminRouter.post('/', (req, res, next) => adminController.createTombola(req, res, next));

// POST /admin/:monthId/draw - Trigger the winner draw
adminRouter.post(
    '/:monthId/draw',
    (req, res, next) => adminController.performDraw(req, res, next)
);

// GET /admin/ - List all tombola months (for admin view)
adminRouter.get('/', adminController.listTombolas);

// GET /admin/:monthId - Get details for a specific tombola month (admin)
adminRouter.get('/:monthId', adminController.getTombolaDetails);

// GET /admin/:monthId/tickets - List tickets for a specific month (admin)
adminRouter.get('/:monthId/tickets', adminController.listTicketsForMonth);

// GET /admin/:monthId/ticket-numbers - Get all ticket numbers for a specific month (admin)
adminRouter.get('/:monthId/ticket-numbers', adminController.getAllTicketNumbers);

// TODO: Add PUT /admin/:monthId - Update TombolaMonth details (e.g., description, dates)

// DELETE /admin/:monthId - Delete a TombolaMonth
adminRouter.delete(
    '/:monthId',
    (req, res, next) => adminController.deleteTombola(req, res, next)
);

// PATCH /admin/:monthId/status - Update status (OPEN/CLOSED)
adminRouter.patch(
    '/:monthId/status',
    (req, res, next) => adminController.updateTombolaStatus(req, res, next)
);

// Mount the admin router under /admin path
router.use('/admin', adminRouter);


export default router; 