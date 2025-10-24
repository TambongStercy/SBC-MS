/**
 * Routes for managing withdrawal sub-admins
 * Only accessible by main ADMIN users
 */

import { Router } from 'express';
import * as subAdminController from '../controllers/sub-admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { UserRole } from '../../database/models/user.model';

const router = Router();

/**
 * @route   POST /api/users/sub-admins
 * @desc    Create a new withdrawal sub-admin
 * @access  Admin only
 */
router.post('/', authenticate as any, authorize([UserRole.ADMIN]) as any, subAdminController.createSubAdmin);

/**
 * @route   GET /api/users/sub-admins
 * @desc    Get all withdrawal sub-admins
 * @access  Admin only
 */
router.get('/', authenticate as any, authorize([UserRole.ADMIN]) as any, subAdminController.getSubAdmins);

/**
 * @route   PUT /api/users/sub-admins/:id
 * @desc    Update sub-admin details
 * @access  Admin only
 */
router.put('/:id', authenticate as any, authorize([UserRole.ADMIN]) as any, subAdminController.updateSubAdmin);

/**
 * @route   PATCH /api/users/sub-admins/:id/block
 * @desc    Block/Unblock sub-admin
 * @access  Admin only
 */
router.patch('/:id/block', authenticate as any, authorize([UserRole.ADMIN]) as any, subAdminController.toggleSubAdminBlock);

/**
 * @route   DELETE /api/users/sub-admins/:id
 * @desc    Delete sub-admin
 * @access  Admin only
 */
router.delete('/:id', authenticate as any, authorize([UserRole.ADMIN]) as any, subAdminController.deleteSubAdmin);

export default router;
