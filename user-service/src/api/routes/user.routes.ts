import { Router, Request, Response, NextFunction } from 'express';
import {
    userController
} from '../controllers/user.controller';
import { authenticate, AuthenticatedRequest, authenticateServiceRequest } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { updateLastIp } from '../middleware/ip-update.middleware';
import { UserRole } from '../../database/models/user.model';
import logger from '../../utils/logger'; // Import logger
import { uploadAvatar } from '../middleware/upload.middleware'; // Corrected import path
import { strictLimiter, mediumLimiter, generalLimiter, uploadLimiter } from '../middleware/rate-limit.middleware'; // Import limiters

const router = Router();
const log = logger.getLogger('UserRoutes'); // Create logger instance

// === Internal Routes (Service-to-Service) ===
const serviceRouter = Router();
serviceRouter.use(authenticateServiceRequest); // Apply service auth HERE

// Balance routes
serviceRouter.get('/:userId/balance', (req, res) => userController.getUserBalance(req, res));
serviceRouter.post('/:userId/balance', (req, res) => userController.updateUserBalance(req, res));

// Validation route
serviceRouter.get('/:userId/validate', (req, res) => userController.validateUser(req, res));

// Withdrawal limits route
serviceRouter.post('/:userId/withdrawal-limits/check', (req, res) => userController.checkWithdrawalLimits(req, res));

// Internal route to get referrer IDs for commission
serviceRouter.get('/:userId/referrers', (req, res) => userController.getReferrerIdsForCommission(req, res));

// Internal route to find users by criteria
serviceRouter.post('/find-by-criteria', (req, res, next) => userController.findUsersByCriteria(req, res, next));

// Internal route to get multiple users by IDs
serviceRouter.post('/batch-details', (req, res) => userController.getUsersDetailsByIds(req, res));

// Internal route to search user IDs by name/email/phone
serviceRouter.get('/search-ids', (req, res, next) => userController.findUserIdsBySearchTerm(req, res, next));

// Mount the service router under a dedicated path *before* user auth middleware
router.use('/internal', serviceRouter);

// === Public routes ===
router.post('/register', mediumLimiter, (req, res) => userController.register(req, res));
router.post('/login', strictLimiter, (req, res) => userController.login(req, res));
router.post('/verify-otp', strictLimiter, (req, res) => userController.verifyOtp(req, res));
// Resend OTP Route (Public, but rate limited)
router.post('/resend-otp', mediumLimiter, (req, res, next) => userController.resendOtp(req, res, next));
// Request OTP for Password Reset (Public, but rate limited)
router.post('/request-password-reset', mediumLimiter, (req, res, next) => userController.requestPasswordResetOtp(req, res, next));

// Get user information by affiliation code
router.get('/get-affiliation', (req, res) => userController.getAffiliation(req, res));

// --- Avatar Proxy Route (Public) ---
router.get('/avatar/:fileId', (req, res, next) => userController.getAvatar(req, res, next));
// --- End Avatar Proxy ---

// === Authenticated User Routes ===

// Apply user authenticate and IP update middleware ONLY to subsequent routes
router.use(authenticate as any, updateLastIp as any);
router.use(generalLimiter); // Apply general limiter to all authenticated user routes

router.get('/me', (req, res) => userController.getMe(req as AuthenticatedRequest, res));
router.post('/logout', (req, res) => userController.logout(req as AuthenticatedRequest, res));
router.get('/affiliator', (req, res) => userController.getAffiliator(req as AuthenticatedRequest, res));
router.put('/me', (req, res) => userController.modify(req as AuthenticatedRequest, res));

// --- Avatar Upload Route ---
// Apply upload limiter before the upload middleware
router.put('/me/avatar', uploadLimiter, uploadAvatar, (req, res, next) => userController.uploadAvatar(req as AuthenticatedRequest, res, next));
// --- End Avatar Upload ---

router.get('/get-refered-users', (req, res) => userController.getReferredUsers(req as AuthenticatedRequest, res));
router.get('/get-referals', (req, res) => userController.getReferredUsersInfo(req as AuthenticatedRequest, res));
router.get('/get-products', (req, res) => userController.getUserProducts(req as AuthenticatedRequest, res));
router.get('/get-product', (req, res) => userController.getUserProduct(req as AuthenticatedRequest, res));

// --- Public Profile View Route ---
router.get('/:userId', (req, res, next) => userController.viewUserProfile(req, res, next));
// --- End Public Profile View ---

// Request OTP for Email Change (Authenticated)
router.post('/request-change-email', (req, res, next) => userController.requestChangeEmailOtp(req as AuthenticatedRequest, res, next));

export default router; 