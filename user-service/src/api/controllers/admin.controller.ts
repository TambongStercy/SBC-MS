import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';
import { userService } from '../../services/user.service';
import { UserRole, IUser } from '../../database/models/user.model';
import { PaginationOptions } from '../../types/express';
import { ContactSearchFilters } from '../../types/contact.types'; // Assuming filters might be reused
import { isValidObjectId } from 'mongoose';
import { SubscriptionType } from '../../database/models/subscription.model'; // Import enum

// Define AuthenticatedRequest if not globally available
interface AuthenticatedRequest extends Request {
    user?: {
        id: string; // Usually the JWT 'sub' or primary key
        userId: string; // Often redundant with id, depends on token structure
        email: string;
        role: string;
    };
}

const log = logger.getLogger('AdminController');

class AdminController {

    /**
     * Admin Login - Existing
     * @route POST /api/admin/login
     */
    async loginAdmin(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body;
            const result = await userService.loginAdmin(email, password, req.ip);
            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            log.error('Admin login failed:', error);
            res.status(401).json({ success: false, message: error.message || 'Admin login failed' });
        }
    }

    /**
     * Export Unpaid Initial Users - Implemented
     * @route GET /api/admin/users/unpaid-initial
     */
    async exportUnpaidInitialUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request received for exporting unpaid initial users');
        try {
            const users: Partial<IUser>[] = await userService.findUsersWithoutInitialSubscription();

            if (!users || users.length === 0) {
                res.status(404).json({ success: false, message: 'No users found matching the criteria.' });
                return;
            }

            // --- Generate CSV ---
            const csvHeader = 'UserID,Name,Email,PhoneNumber,Region,Country,RegistrationDate\n';
            const csvRows = users.map(user => {
                // Escape commas in fields and wrap in quotes if necessary
                const name = `"${(user.name || '').replace(/"/g, '""')}"`;
                const email = `"${(user.email || '').replace(/"/g, '""')}"`;
                const phone = `"${(user.phoneNumber || '').toString().replace(/"/g, '""')}"`; // Ensure phone is string
                const region = `"${(user.region || '').replace(/"/g, '""')}"`;
                const country = `"${(user.country || '').replace(/"/g, '""')}"`;
                const regDate = user.createdAt ? new Date(user.createdAt).toISOString() : '';
                return [
                    user._id?.toString() || '',
                    name,
                    email,
                    phone,
                    region,
                    country,
                    regDate
                ].join(',');
            }).join('\n');

            const csvData = csvHeader + csvRows;
            // --- End Generate CSV ---

            // Set headers for CSV download
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="unpaid_initial_users_${new Date().toISOString().split('T')[0]}.csv"`
            );
            res.status(200).send(csvData);

        } catch (error: any) {
            log.error('Error exporting unpaid initial users:', error);
            // Pass error to middleware or send a generic server error
            res.status(500).json({ success: false, message: error.message || 'Failed to export users' });
            // next(error); // Alternative: use error handling middleware
        }
    }

    /**
     * List Users (Admin)
     * @route GET /api/admin/users
     */
    async listUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request to list users');
        try {
            const { page = 1, limit = 20, status, role, search } = req.query;
            const pagination: PaginationOptions = {
                page: parseInt(page as string, 10) || 1,
                limit: parseInt(limit as string, 10) || 10,
            };
            const filters = {
                status: status as string | undefined,
                role: role as string | undefined,
                search: search as string | undefined
            };
            log.debug('Filtering users with:', { filters, pagination });

            const result = await userService.adminListUsers(filters, pagination);

            res.status(200).json({ success: true, data: result.users, pagination: result.paginationInfo });
        } catch (error) {
            log.error('Error listing users (admin):', error);
            next(error); // Pass to error handling middleware
        }
    }

    /**
     * Get User Details (Admin)
     * @route GET /api/admin/users/:userId
     */
    async getUserDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        log.info(`Admin request to get details for user: ${userId}`);
        try {
            const user = await userService.adminGetUserById(userId);
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }
            res.status(200).json({ success: true, data: user });
        } catch (error) {
            log.error(`Error getting user details for ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
     * Update User (Admin)
     * @route PUT /api/admin/users/:userId
     */
    async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        const updateData = req.body;
        log.info(`Admin request to update user: ${userId} with data:`, updateData);
        try {
            const updatedUser = await userService.adminUpdateUser(userId, updateData);
            if (!updatedUser) {
                // Service layer might throw error for not found, but check anyway
                res.status(404).json({ success: false, message: 'User not found or update failed' });
                return;
            }
            res.status(200).json({ success: true, data: updatedUser });
        } catch (error: any) {
            log.error(`Error updating user ${userId} (admin):`, error);
            // Send specific error message if available (e.g., validation errors from service)
            res.status(error.message.includes('Invalid') || error.message.includes('duplicate') ? 400 : 500)
                .json({ success: false, message: error.message || 'Failed to update user' });
        }
    }

    /**
     * Block User (Admin)
     * @route PATCH /api/admin/users/:userId/block
     */
    async blockUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        log.info(`Admin request to block user: ${userId}`);
        try {
            await userService.adminSetBlockStatus(userId, true);
            res.status(200).json({ success: true, message: 'User blocked successfully' });
        } catch (error) {
            log.error(`Error blocking user ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
     * Unblock User (Admin)
     * @route PATCH /api/admin/users/:userId/unblock
     */
    async unblockUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        log.info(`Admin request to unblock user: ${userId}`);
        try {
            await userService.adminSetBlockStatus(userId, false);
            res.status(200).json({ success: true, message: 'User unblocked successfully' });
        } catch (error) {
            log.error(`Error unblocking user ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
     * Delete User (Admin) - Soft Delete
     * @route DELETE /api/admin/users/:userId
     */
    async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        const adminUserId = req.user?.userId || 'Unknown Admin'; // Get admin ID for reason
        log.info(`Admin ${adminUserId} request to soft-delete user: ${userId}`);
        try {
            await userService.softDeleteUser(userId, `Deleted by admin ${adminUserId}`);
            res.status(200).json({ success: true, message: 'User soft-deleted successfully' });
        } catch (error) {
            log.error(`Error soft-deleting user ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
    * Restore User (Admin)
    * @route PATCH /api/admin/users/:userId/restore
    */
    async restoreUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        log.info(`Admin request to restore user: ${userId}`);
        try {
            await userService.restoreUser(userId);
            res.status(200).json({ success: true, message: 'User restored successfully' });
        } catch (error) {
            log.error(`Error restoring user ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
     * Manually Adjust Balance (Admin)
     * @route POST /api/admin/users/:userId/adjust-balance
     */
    async adjustBalance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        const { amount, reason } = req.body;
        const adminUserId = req.user?.userId;

        if (!adminUserId) {
            res.status(401).json({ success: false, message: 'Admin user ID not found in token.' });
            return;
        }

        log.info(`Admin ${adminUserId} request to adjust balance for user: ${userId} by ${amount}. Reason: ${reason}`);
        try {
            // Basic validation moved to service, but keep null/type check here
            if (typeof amount !== 'number' || !reason) {
                res.status(400).json({ success: false, message: 'Invalid input: amount (number) and reason (string) are required.' });
                return;
            }
            const newBalance = await userService.adminAdjustBalance(userId, amount, reason, adminUserId);

            if (newBalance === null) {
                // Service logs warning, controller returns 404
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }
            res.status(200).json({ success: true, message: 'Balance adjusted successfully', newBalance });
        } catch (error: any) {
            log.error(`Error adjusting balance for user ${userId} (admin):`, error);
            res.status(error.message.includes('Invalid') || error.message.includes('required') ? 400 : 500)
                .json({ success: false, message: error.message || 'Failed to adjust balance' });
        }
    }

    /**
    * Get User Subscriptions (Admin)
    * @route GET /api/admin/users/:userId/subscriptions
    */
    async getUserSubscriptions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }
        log.info(`Admin request to get subscriptions for user: ${userId}`);
        try {
            // TODO: Implement call to subscriptionService.adminGetUserSubscriptions(userId) when available
            // const subscriptions = await subscriptionService.getUserSubscriptions(userId);
            // res.status(200).json({ success: true, data: subscriptions });
            res.status(501).json({ success: false, message: 'Get User Subscriptions (Admin): Not Implemented Yet', userId });
        } catch (error) {
            log.error(`Error getting subscriptions for user ${userId} (admin):`, error);
            next(error);
        }
    }

    /**
     * [Admin] Get total user balance aggregated by country.
     * @route GET /api/admin/stats/balance-by-country
     */
    async getBalanceByCountryStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request for total balance by country stats');
        try {
            const stats = await userService.getAggregatedBalanceByCountry();
            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            log.error('Error getting balance by country stats:', error);
            next(error);
        }
    }

    /**
     * [Admin] Get monthly user registration and subscription activity.
     * @route GET /api/admin/stats/monthly-activity
     */
    async getMonthlyActivity(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request for monthly activity stats');
        try {
            const monthsQuery = req.query.months as string | undefined;
            const months = monthsQuery ? parseInt(monthsQuery, 10) : 12; // Default to 12 months

            if (isNaN(months) || months <= 0) {
                res.status(400).json({ success: false, message: 'Invalid months parameter. Must be a positive integer.' });
                return;
            }

            const stats = await userService.getMonthlyActivityStats(months);
            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            log.error('Error getting monthly activity stats:', error);
            next(error);
        }
    }

    /**
     * [Admin] Get User Summary Statistics
     * @route GET /api/admin/stats/user-summary
     */
    async getUserSummaryStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request for user summary stats');
        try {
            const stats = await userService.adminGetUserSummaryStats();
            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            log.error('Error getting user summary stats (controller):', error);
            next(error); // Pass to error handling middleware
        }
    }

    /**
     * [Admin] Set User Subscription Status/Type
     * @route PATCH /api/admin/users/:userId/subscription
     */
    async adminSetUserSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const { userId } = req.params;
        const { type } = req.body; // Expecting { type: 'CLASSIQUE' | 'CIBLE' | 'NONE' }

        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid User ID format' });
            return;
        }

        // Validate the type parameter
        const validTypes = [...Object.values(SubscriptionType), 'NONE'];
        if (!type || !validTypes.includes(type)) {
            res.status(400).json({ success: false, message: `Invalid subscription type provided. Must be one of: ${validTypes.join(', ')}` });
            return;
        }

        log.info(`Admin request to set subscription for user ${userId} to type: ${type}`);
        try {
            await userService.adminSetSubscription(userId, type as SubscriptionType | 'NONE');
            res.status(200).json({ success: true, message: `Subscription set to ${type} successfully.` });
        } catch (error) {
            log.error(`Error setting user subscription (controller) for user ${userId}:`, error);
            next(error);
        }
    }

    /**
     * [Admin] Get aggregated data for the main dashboard.
     * @route GET /api/admin/dashboard
     */
    async getDashboardData(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request for dashboard data');
        try {
            const dashboardData = await userService.adminGetDashboardData();
            res.status(200).json({ success: true, data: dashboardData });
        } catch (error) {
            log.error('Error getting admin dashboard data (controller):', error);
            // Send a 503 Service Unavailable if the error message indicates service communication issues
            const isServiceError = error instanceof Error && error.message.includes('service might be unavailable');
            res.status(isServiceError ? 503 : 500).json({ success: false, message: error instanceof Error ? error.message : 'Failed to retrieve dashboard data' });
            // Alternatively use next(error) to pass to a generic error handler
        }
    }
}

export const adminController = new AdminController(); 