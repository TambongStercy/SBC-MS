import { Router } from 'express';
import { vcfCacheController } from '../controllers/vcf-cache.controller';
import { authenticate } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/admin/vcf-cache/status
 * @desc    Get VCF cache status and statistics
 * @access  Private (Admin only)
 */
router.get('/status', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.getCacheStatus(req, res);
});

/**
 * @route   POST /api/admin/vcf-cache/regenerate
 * @desc    Manually trigger VCF cache regeneration
 * @access  Private (Admin only)
 */
router.post('/regenerate', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.regenerateCache(req, res);
});

/**
 * @route   DELETE /api/admin/vcf-cache
 * @desc    Delete the cached VCF file
 * @access  Private (Admin only)
 */
router.delete('/', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.deleteCache(req, res);
});

/**
 * @route   GET /api/admin/vcf-cache/download
 * @desc    Download the current cached VCF file (for admin inspection)
 * @access  Private (Admin only)
 */
router.get('/download', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.downloadCache(req, res);
});

/**
 * @route   GET /api/admin/vcf-cache/popular-filters
 * @desc    Get popular filter cache statistics
 * @access  Private (Admin only)
 */
router.get('/popular-filters', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.getPopularFiltersStats(req, res);
});

/**
 * @route   DELETE /api/admin/vcf-cache/popular-filters
 * @desc    Clear popular filter cache
 * @access  Private (Admin only)
 */
router.delete('/popular-filters', authenticate as any, generalLimiter, (req, res) => {
    vcfCacheController.clearPopularFiltersCache(req, res);
});

export default router;
