import { Router } from 'express';
import storageController from '../controllers/storage.controller';
import authenticateJWT, { requireAdmin } from '../middleware/auth.middleware';

const router = Router();

/**
 * @route GET /api/settings/storage/status
 * @desc Get comprehensive storage status including usage, costs, and recommendations
 * @access Protected
 */
router.get('/status', authenticateJWT, requireAdmin, storageController.getStorageStatus.bind(storageController));

/**
 * @route POST /api/settings/storage/check
 * @desc Run a manual storage check and return updated status
 * @access Protected
 */
router.post('/check', authenticateJWT, requireAdmin, storageController.runStorageCheck.bind(storageController));

/**
 * @route GET /api/settings/storage/cleanup-candidates
 * @desc Get cleanup candidates with potential cost savings
 * @query daysOld - Files older than this many days (default: 7)
 * @access Protected
 */
router.get('/cleanup-candidates', authenticateJWT, requireAdmin, storageController.getCleanupCandidates.bind(storageController));

export default router; 