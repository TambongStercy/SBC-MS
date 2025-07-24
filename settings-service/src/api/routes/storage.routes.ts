import { Router } from 'express';
import storageController from '../controllers/storage.controller';
import authenticateJWT from '../middleware/auth.middleware';

const router = Router();

/**
 * @route GET /api/settings/storage/status
 * @desc Get comprehensive storage status including usage, costs, and recommendations
 * @access Protected
 */
router.get('/status', authenticateJWT, storageController.getStorageStatus.bind(storageController));

/**
 * @route POST /api/settings/storage/check
 * @desc Run a manual storage check and return updated status
 * @access Protected
 */
router.post('/check', authenticateJWT, storageController.runStorageCheck.bind(storageController));

/**
 * @route GET /api/settings/storage/cleanup-candidates
 * @desc Get cleanup candidates with potential cost savings
 * @query daysOld - Files older than this many days (default: 7)
 * @access Protected
 */
router.get('/cleanup-candidates', authenticateJWT, storageController.getCleanupCandidates.bind(storageController));

export default router; 