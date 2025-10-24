/**
 * Controller for managing withdrawal sub-admins
 * Only accessible by main ADMIN users
 */

import { Request, Response } from 'express';
import User, { UserRole } from '../../database/models/user.model';
import logger from '../../utils/logger';
import bcrypt from 'bcrypt';

/**
 * Create a new withdrawal sub-admin
 * POST /api/users/sub-admins
 */
export async function createSubAdmin(req: Request, res: Response): Promise<void> {
    try {
        const { name, email, password, phoneNumber } = req.body;

        // Validate required fields
        if (!name || !email || !password || !phoneNumber) {
            res.status(400).json({
                success: false,
                message: 'Name, email, password, and phone number are required'
            });
            return;
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
            return;
        }

        // Check if phone number already exists
        const existingPhone = await User.findOne({ phoneNumber });
        if (existingPhone) {
            res.status(400).json({
                success: false,
                message: 'Phone number already exists'
            });
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create sub-admin user
        const subAdmin = new User({
            name,
            email: email.toLowerCase(),
            phoneNumber,
            password: hashedPassword,
            role: UserRole.WITHDRAWAL_ADMIN,
            isVerified: true, // Sub-admins are pre-verified
            region: req.body.region || 'Admin',
            country: req.body.country || 'N/A'
        });

        await subAdmin.save();

        logger.info(`[SubAdminController] Sub-admin created: ${email} by admin ${req.user?.email}`);

        res.status(201).json({
            success: true,
            message: 'Withdrawal sub-admin created successfully',
            data: {
                _id: subAdmin._id,
                name: subAdmin.name,
                email: subAdmin.email,
                phoneNumber: subAdmin.phoneNumber,
                role: subAdmin.role,
                createdAt: subAdmin.createdAt
            }
        });
    } catch (error: any) {
        logger.error('[SubAdminController] Error creating sub-admin:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create sub-admin',
            error: error.message
        });
    }
}

/**
 * Get all withdrawal sub-admins
 * GET /api/users/sub-admins
 */
export async function getSubAdmins(req: Request, res: Response): Promise<void> {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const subAdmins = await User.find({ role: UserRole.WITHDRAWAL_ADMIN })
            .select('_id name email phoneNumber createdAt blocked')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await User.countDocuments({ role: UserRole.WITHDRAWAL_ADMIN });

        res.status(200).json({
            success: true,
            data: {
                subAdmins,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: limit
                }
            }
        });
    } catch (error: any) {
        logger.error('[SubAdminController] Error getting sub-admins:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve sub-admins',
            error: error.message
        });
    }
}

/**
 * Update sub-admin details
 * PUT /api/users/sub-admins/:id
 */
export async function updateSubAdmin(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        const { name, email, phoneNumber, password } = req.body;

        const subAdmin = await User.findOne({ _id: id, role: UserRole.WITHDRAWAL_ADMIN });

        if (!subAdmin) {
            res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
            return;
        }

        // Update fields
        if (name) subAdmin.name = name;
        if (email) subAdmin.email = email.toLowerCase();
        if (phoneNumber) subAdmin.phoneNumber = phoneNumber;

        // Update password if provided
        if (password) {
            subAdmin.password = await bcrypt.hash(password, 10);
        }

        await subAdmin.save();

        logger.info(`[SubAdminController] Sub-admin updated: ${id} by admin ${req.user?.email}`);

        res.status(200).json({
            success: true,
            message: 'Sub-admin updated successfully',
            data: {
                _id: subAdmin._id,
                name: subAdmin.name,
                email: subAdmin.email,
                phoneNumber: subAdmin.phoneNumber
            }
        });
    } catch (error: any) {
        logger.error('[SubAdminController] Error updating sub-admin:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update sub-admin',
            error: error.message
        });
    }
}

/**
 * Block/Unblock sub-admin
 * PATCH /api/users/sub-admins/:id/block
 */
export async function toggleSubAdminBlock(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        const { blocked } = req.body;

        if (typeof blocked !== 'boolean') {
            res.status(400).json({
                success: false,
                message: 'Blocked status must be a boolean'
            });
            return;
        }

        const subAdmin = await User.findOne({ _id: id, role: UserRole.WITHDRAWAL_ADMIN });

        if (!subAdmin) {
            res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
            return;
        }

        subAdmin.blocked = blocked;
        await subAdmin.save();

        logger.info(`[SubAdminController] Sub-admin ${blocked ? 'blocked' : 'unblocked'}: ${id}`);

        res.status(200).json({
            success: true,
            message: `Sub-admin ${blocked ? 'blocked' : 'unblocked'} successfully`,
            data: {
                _id: subAdmin._id,
                blocked: subAdmin.blocked
            }
        });
    } catch (error: any) {
        logger.error('[SubAdminController] Error toggling sub-admin block:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update sub-admin status',
            error: error.message
        });
    }
}

/**
 * Delete sub-admin
 * DELETE /api/users/sub-admins/:id
 */
export async function deleteSubAdmin(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const result = await User.deleteOne({ _id: id, role: UserRole.WITHDRAWAL_ADMIN });

        if (result.deletedCount === 0) {
            res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
            return;
        }

        logger.info(`[SubAdminController] Sub-admin deleted: ${id} by admin ${req.user?.email}`);

        res.status(200).json({
            success: true,
            message: 'Sub-admin deleted successfully'
        });
    } catch (error: any) {
        logger.error('[SubAdminController] Error deleting sub-admin:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete sub-admin',
            error: error.message
        });
    }
}
