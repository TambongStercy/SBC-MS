import { Router } from 'express';
import { adminController } from '../controllers/admin.controller'; // Import admin controller
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware'; // Assuming RBAC middleware exists
import { UserRole } from '../../database/models/user.model'; // Import UserRole enum
import { adminLimiter, strictLimiter } from '../middleware/rate-limit.middleware'; // Import limiters

const router = Router();

// --- Public Admin Routes (e.g., Login) ---
// Apply strict limiter to admin login
router.post('/login', strictLimiter, adminController.loginAdmin);

// --- Protected Admin Routes ---
// Apply authentication and admin authorization middleware AFTER public routes
// Cast middleware to any to resolve potential type conflicts
router.use(authenticate as any);
router.use(authorize([UserRole.ADMIN]) as any);
router.use(adminLimiter); // Apply general admin limiter to all subsequent routes

// --- Dashboard Route ---
router.get('/dashboard', adminController.getDashboardData as any); // GET /api/admin/dashboard

// --- User Management Routes ---
router.get('/users', adminController.listUsers as any); // GET /api/admin/users
router.get('/users/unpaid-initial', adminController.exportUnpaidInitialUsers as any); // Existing route
router.get('/users/:userId', adminController.getUserDetails as any); // GET /api/admin/users/:userId
router.put('/users/:userId', adminController.updateUser as any); // PUT /api/admin/users/:userId
router.patch('/users/:userId/block', adminController.blockUser as any); // PATCH /api/admin/users/:userId/block
router.patch('/users/:userId/unblock', adminController.unblockUser as any); // PATCH /api/admin/users/:userId/unblock
router.delete('/users/:userId', adminController.deleteUser as any); // DELETE /api/admin/users/:userId (Soft Delete)
router.patch('/users/:userId/restore', adminController.restoreUser as any); // PATCH /api/admin/users/:userId/restore
router.post('/users/:userId/adjust-balance', adminController.adjustBalance as any); // POST /api/admin/users/:userId/adjust-balance

// Route to set/update subscription type
router.patch('/users/:userId/subscription', adminController.adminSetUserSubscription as any); // PATCH /api/admin/users/:userId/subscription

// Route to set/update user role (e.g., assign tester role)
router.patch('/users/:userId/role', adminController.setUserRole as any); // PATCH /api/admin/users/:userId/role

// --- Subscription Management (Related to Users) ---
router.get('/users/:userId/subscriptions', adminController.getUserSubscriptions as any); // GET /api/admin/users/:userId/subscriptions

// --- Partner Management Routes (Admin Only) ---
router.post('/partners/set-user-partner', adminController.setUserAsPartner as any); // POST /api/admin/partners/set-user-partner
router.patch('/partners/:userId/deactivate', adminController.deactivatePartner as any); // PATCH /api/admin/partners/:userId/deactivate

// --- Route to list all partners ---
router.get('/partners', adminController.listPartners as any); // GET /api/admin/partners

// --- Route for partner summary stats ---
router.get('/partners/summary', adminController.getPartnerSummaryStats as any); // GET /api/admin/partners/summary

// --- Dashboard Statistics Routes ---
router.get('/stats/user-summary', adminController.getUserSummaryStats as any); // GET /api/admin/stats/user-summary
router.get('/stats/balance-by-country', adminController.getBalanceByCountryStats as any); // GET /api/admin/stats/balance-by-country
router.get('/stats/monthly-activity', adminController.getMonthlyActivity as any); // GET /api/admin/stats/monthly-activity?months=6

// Add other protected admin routes here (e.g., manage site settings, view logs)

export default router; 