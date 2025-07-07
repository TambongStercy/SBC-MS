import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';

const router = Router();
const storageController = new StorageController();

/**
 * @route   GET /api/storage/status
 * @desc    Get current storage usage and health status
 * @access  Internal (should be protected in production)
 */
router.get('/status', storageController.getStorageStatus.bind(storageController));

/**
 * @route   POST /api/storage/check
 * @desc    Manually trigger storage monitoring check
 * @access  Internal (should be protected in production)
 */
router.post('/check', storageController.runStorageCheck.bind(storageController));

/**
 * @route   GET /api/storage/cleanup-candidates
 * @desc    Get list of files that can be cleaned up
 * @query   daysOld: number (default: 7) - Files older than this many days
 * @access  Internal (should be protected in production)
 */
router.get('/cleanup-candidates', storageController.getCleanupCandidates.bind(storageController));

export default router; 