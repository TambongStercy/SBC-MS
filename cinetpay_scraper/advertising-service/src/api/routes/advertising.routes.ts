import { Router } from 'express';
import { advertisingController } from '../controllers/advertising.controller';
// Assume an authentication middleware exists, adjust the import path as needed
import { authenticate } from '../middleware/auth.middleware';
// Import service auth middleware (assuming it will be created)
// import { authenticateServiceRequest } from '../middleware/auth.middleware';

const router = Router();

// --- Public Routes --- 

/**
 * @route   GET /api/advertising/packs
 * @desc    Get all active advertising packs
 * @access  Public
 */
router.get('/packs', advertisingController.getAdPacks);

/**
 * @route   GET /api/advertising/ads/display
 * @desc    Get ads for display
 * @access  Public
 */
router.get('/ads/display', advertisingController.getAdvertisementsForDisplay);

// --- Payment Webhook Route (Internal/Specific Auth) --- 
// TODO: Apply appropriate service authentication middleware here if needed
// router.post('/webhooks/payment', authenticateServiceRequest, advertisingController.handlePaymentWebhook);
// For now, leaving it open or relying on network-level security/obscurity
router.post('/webhooks/payment', advertisingController.handlePaymentWebhook);

// --- Authenticated User Routes --- 
router.use(authenticate); // Apply user authentication for subsequent routes

/**
 * @route   POST /api/advertising/ads
 * @desc    Create a new advertisement (initiates payment)
 * @access  Private
 */
router.post('/ads', advertisingController.createAdvertisement);

router.get('/ads/me', advertisingController.getUserAdvertisements);

// Route to get a specific advertisement by ID
router.get('/ads/:advertisementId', advertisingController.getAdvertisementById);

// Route to update a specific advertisement by ID
router.put('/ads/:advertisementId', advertisingController.updateAdvertisement);


export default router; 