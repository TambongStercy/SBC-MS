import { Router } from 'express';
import { adminController } from '../controllers/admin.controller'; // Import admin controller
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware'; // Assuming RBAC middleware exists
import { UserRole, ADMIN_CAPABLE_ROLES } from '../../database/models/user.model'; // Import UserRole enum
import { adminAccessController } from '../controllers/admin-access.controller';
import { adminAuthController, requireAdminSession } from '../controllers/admin-auth.controller';
import { protectAdminAccounts } from '../middleware/protect-admin-accounts.middleware';
import { adminLimiter, strictLimiter } from '../middleware/rate-limit.middleware'; // Import limiters
import { getActivityBoard, getActivityList } from '../controllers/activity.controller';
import {
    downloadDormantExport, getDormantExport, getDormantList, getDormantSummary, postDormantChecked, postDormantExport, postDormantFreezeRequest,
    getReactivationCampaigns, getReactivationTextHandler, postApproveReactivationText, postCancelReactivationCampaign, postReactivationCampaign,
    postReactivationPreview, putReactivationDraft,
} from '../controllers/dormancy.controller';
import { requireAdminStepUp } from '../middleware/admin-step-up.middleware';

const router = Router();

// --- Public Admin Routes (e.g., Login) ---
// Apply strict limiter to admin login
// Password, then the authenticator app (first time: the emailed code, then the
// authenticator is set up). services/admin-auth.service.ts
router.post('/login', strictLimiter, adminAuthController.login);
router.post('/login/email-code', strictLimiter, adminAuthController.verifyEmailCode);
router.post('/login/enroll/start', strictLimiter, adminAuthController.enrollStart);
router.post('/login/enroll/confirm', strictLimiter, adminAuthController.enrollConfirm);
router.post('/login/totp', strictLimiter, adminAuthController.completeTotp);

// --- Protected Admin Routes ---
// Apply authentication and admin authorization middleware AFTER public routes
// Cast middleware to any to resolve potential type conflicts
router.use(authenticate as any);
// Every account that signs in to the admin; the gateway decides which module
// and whether read or write (config/admin-modules.ts). Team and role changes
// below stay super-admin only here too.
router.use(authorize(ADMIN_CAPABLE_ROLES) as any);
// Only a token from the admin sign-in, on a session that is still open (not a member-app token).
router.use(requireAdminSession as any);
router.use(adminLimiter); // Apply general admin limiter to all subsequent routes
const superAdminOnly = authorize([UserRole.ADMIN]) as any;
// Changes to an admin-team account (admin, staff, ...) stay super-admin only.
const notOnAdminAccounts = protectAdminAccounts() as any;

// --- Admin access (per-module rights) ---
router.get('/me/access', adminAccessController.getMyAccess as any);
router.post('/logout', adminAuthController.logout as any);
router.get('/me/security', adminAuthController.mySecurity as any);
router.post('/me/backup-codes', strictLimiter, adminAuthController.regenerateBackupCodes as any);
router.post('/staff/:userId/reset-authenticator', superAdminOnly, adminAuthController.resetAuthenticator as any);
router.get('/staff', superAdminOnly, adminAccessController.listStaff as any);
router.put('/staff/:userId', superAdminOnly, adminAccessController.setStaffAccess as any);
router.delete('/staff/:userId', superAdminOnly, adminAccessController.revokeStaff as any);

// --- Daily activity (Security plan Phase 11; gateway module: dashboard) ---
router.get('/activity', getActivityBoard as any);
router.get('/activity/list', getActivityList as any);

// --- Authenticator adoption (Security plan Phase 3 rollout; gateway module: dashboard) ---
router.get('/security/authenticator-adoption', (async (req: any, res: any) => {
    const { adoptionHistory } = await import('../../services/authenticator-adoption.service');
    res.json({ success: true, data: await adoptionHistory(Number(req.query.days) || 30) });
}) as any);

// --- Dormant accounts (Security plan Phase 7; gateway module: finance) ---
// Phase 7 part 2: réactivation campaign (before /dormant-accounts/:userId/…).
router.get('/dormant-accounts/reactivation/text', getReactivationTextHandler as any);
router.put('/dormant-accounts/reactivation/text/draft', superAdminOnly, putReactivationDraft as any);
router.post('/dormant-accounts/reactivation/text/approve', superAdminOnly, postApproveReactivationText as any);
router.post('/dormant-accounts/reactivation/preview', postReactivationPreview as any); // read-only POST at the gateway
router.get('/dormant-accounts/reactivation/campaigns', getReactivationCampaigns as any);
router.post('/dormant-accounts/reactivation/campaigns', requireAdminStepUp('reactivation_campaign'), postReactivationCampaign as any);
router.post('/dormant-accounts/reactivation/campaigns/:campaignId/cancel', postCancelReactivationCampaign as any);
router.get('/dormant-accounts/summary', getDormantSummary as any);
router.get('/dormant-accounts', getDormantList as any);
router.post('/dormant-accounts/export', postDormantExport as any); // read-only POST at the gateway
router.get('/dormant-accounts/exports/:exportId', getDormantExport as any);
router.get('/dormant-accounts/exports/:exportId/download', downloadDormantExport as any);
router.post('/dormant-accounts/:userId/checked', postDormantChecked as any);
router.post('/dormant-accounts/:userId/freeze-request', postDormantFreezeRequest as any);

// --- Dashboard Route ---
router.get('/dashboard', adminController.getDashboardData as any); // GET /api/admin/dashboard

// --- Leaderboard bonus (monthly, credited to the ACTIVATION balance) ---
// Run/replay a month, or read what was paid. Both admin-only, like everything
// below this point.
router.post('/leaderboard-bonus/run', adminController.runLeaderboardBonus as any);
router.get('/leaderboard-bonus', adminController.listLeaderboardBonuses as any);

// --- User Management Routes ---
router.get('/users', adminController.listUsers as any); // GET /api/admin/users
router.get('/users/unpaid-initial', adminController.exportUnpaidInitialUsers as any); // Existing route
router.get('/users/:userId', adminController.getUserDetails as any); // GET /api/admin/users/:userId
router.get('/users/:userId/referrals', adminController.getUserReferrals as any); // a member's filleuls, for the admin member page
router.put('/users/:userId', notOnAdminAccounts, adminController.updateUser as any); // PUT /api/admin/users/:userId
router.patch('/users/:userId/block', notOnAdminAccounts, adminController.blockUser as any); // PATCH /api/admin/users/:userId/block
router.patch('/users/:userId/unblock', notOnAdminAccounts, adminController.unblockUser as any); // PATCH /api/admin/users/:userId/unblock
router.delete('/users/:userId', notOnAdminAccounts, adminController.deleteUser as any); // DELETE /api/admin/users/:userId (Soft Delete)
router.patch('/users/:userId/restore', notOnAdminAccounts, adminController.restoreUser as any); // PATCH /api/admin/users/:userId/restore
router.post('/users/:userId/adjust-balance', notOnAdminAccounts, requireAdminStepUp('balance_adjust'), adminController.adjustBalance as any); // POST /api/admin/users/:userId/adjust-balance
router.post('/users/:userId/cancel-activation-transfer', notOnAdminAccounts, requireAdminStepUp('activation_reversal'), adminController.cancelActivationTransfer as any); // POST /api/admin/users/:userId/cancel-activation-transfer

// Route to set/update subscription type
router.patch('/users/:userId/subscription', notOnAdminAccounts, adminController.adminSetUserSubscription as any); // PATCH /api/admin/users/:userId/subscription

// Route to set/update user role (e.g., assign tester role)
router.patch('/users/:userId/role', superAdminOnly, adminController.setUserRole as any); // PATCH /api/admin/users/:userId/role

// --- Subscription Management (Related to Users) ---
router.get('/users/:userId/subscriptions', adminController.getUserSubscriptions as any); // GET /api/admin/users/:userId/subscriptions

// --- Partner Management Routes (Admin Only) ---
router.post('/partners/set-user-partner', protectAdminAccounts('body') as any, adminController.setUserAsPartner as any); // POST /api/admin/partners/set-user-partner
router.patch('/partners/:userId/deactivate', notOnAdminAccounts, adminController.deactivatePartner as any); // PATCH /api/admin/partners/:userId/deactivate

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