import { Router } from 'express';
import { authenticate, authenticateServiceRequest, authorize } from '../middleware/auth.middleware'; // Assuming authorize middleware exists
import { flashSaleController } from '../controllers/flashsale.controller'; // To be created

const router = Router();
const adminRouter = Router(); // Create a separate router for admin routes

// --- Admin Routes --- 
// Apply authentication and admin authorization to the admin router
adminRouter.use(authenticate); // Ensure user is logged in
adminRouter.use(authorize(['admin'])); // Use authorize with the admin role

// GET /api/flash-sales/admin - List all flash sales with pagination/filtering
adminRouter.get('/', flashSaleController.adminListFlashSales);

// GET /api/flash-sales/admin/:flashSaleId - Get specific flash sale details
adminRouter.get('/:flashSaleId', flashSaleController.adminGetFlashSaleDetails);

// PUT /api/flash-sales/admin/:flashSaleId - Update any flash sale
adminRouter.put('/:flashSaleId', flashSaleController.adminUpdateFlashSale);

// DELETE /api/flash-sales/admin/:flashSaleId - Delete/cancel any flash sale
adminRouter.delete('/:flashSaleId', flashSaleController.adminDeleteFlashSale);

// PATCH /api/flash-sales/admin/:flashSaleId/status - Manually update status (e.g., approve, expire)
adminRouter.patch('/:flashSaleId/status', flashSaleController.adminUpdateFlashSaleStatus);

// Mount the admin router under the /admin path
router.use('/admin', adminRouter);

// --- Internal Routes (e.g., for payment service webhook/callback) ---
// Apply service-to-service authentication middleware here
router.post(
    '/internal/update-payment-status',
    authenticateServiceRequest, // <-- Apply service auth middleware
    flashSaleController.updateFlashSalePaymentStatus
);

// --- Public Routes ---
router.get('/', flashSaleController.getActiveFlashSales); // Get active flash sales
// Tracking endpoints (Public)
router.post('/:flashSaleId/track-view', flashSaleController.trackFlashSaleView);
router.post('/:flashSaleId/track-whatsapp-click', flashSaleController.trackWhatsappClick);

// --- Authenticated Routes ---
router.use(authenticate);

router.post('/', flashSaleController.createFlashSale);        // Create a new flash sale
router.get('/my', flashSaleController.getMyFlashSales);       // Get my flash sales
router.put('/:flashSaleId', flashSaleController.updateFlashSale); // Update my flash sale
router.delete('/:flashSaleId', flashSaleController.cancelFlashSale); // Cancel my flash sale

export default router; 