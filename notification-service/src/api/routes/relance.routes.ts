import { Router } from 'express';
import path from 'path';
import { relanceController } from '../controllers/relance.controller';
import { relanceCampaignController } from '../controllers/relance-campaign.controller';
import { authenticate } from '../middleware/auth.middleware';
import { uploadRelanceMedia } from '../middleware/upload.middleware';
import campaignRoutes from './relance-campaign.routes';

const router = Router();

// ===== USER ROUTES (Authenticated) =====

/**
 * @route   POST /api/relance/connect
 * @desc    Generate QR code for WhatsApp connection
 * @access  Private
 */
router.post('/connect', authenticate, (req, res) =>
    relanceController.connectWhatsApp(req, res)
);

/**
 * @route   GET /api/relance/status
 * @desc    Check WhatsApp connection status
 * @access  Private
 */
router.get('/status', authenticate, (req, res) =>
    relanceController.getStatus(req, res)
);

/**
 * @route   DELETE /api/relance/disconnect
 * @desc    Disconnect WhatsApp session
 * @access  Private
 */
router.delete('/disconnect', authenticate, (req, res) =>
    relanceController.disconnectWhatsApp(req, res)
);

/**
 * @route   PUT /api/relance/settings
 * @desc    Update pause settings (enrollment/sending)
 * @access  Private
 */
router.put('/settings', authenticate, (req, res) =>
    relanceController.updateSettings(req, res)
);

/**
 * @route   GET /api/relance/targets
 * @desc    Get user's active relance targets (referrals in loop)
 * @access  Private
 */
router.get('/targets', authenticate, (req, res) =>
    relanceController.getMyTargets(req, res)
);

/**
 * @route   PATCH /api/relance/config
 * @desc    Update relance configuration (campaign settings, limits)
 * @access  Private
 */
router.patch('/config', authenticate, (req, res) =>
    relanceCampaignController.updateConfig(req, res)
);

// ===== CAMPAIGN ROUTES =====
router.use('/campaigns', authenticate, campaignRoutes);

// ===== ADMIN ROUTES =====

/**
 * @route   GET /api/relance/admin/messages
 * @desc    Get all relance messages (Day 1-7)
 * @access  Admin
 */
router.get('/admin/messages', authenticate, (req, res) =>
    relanceController.getAllMessages(req, res)
);

/**
 * @route   GET /api/relance/admin/messages/:day
 * @desc    Get specific day message
 * @access  Admin
 */
router.get('/admin/messages/:day', authenticate, (req, res) =>
    relanceController.getMessage(req, res)
);

/**
 * @route   POST /api/relance/admin/messages
 * @desc    Create/update relance message for a specific day
 * @access  Admin
 */
router.post('/admin/messages', authenticate, (req, res) =>
    relanceController.upsertMessage(req, res)
);

/**
 * @route   DELETE /api/relance/admin/messages/:day
 * @desc    Deactivate relance message for a specific day
 * @access  Admin
 */
router.delete('/admin/messages/:day', authenticate, (req, res) =>
    relanceController.deactivateMessage(req, res)
);

/**
 * @route   GET /api/relance/admin/stats
 * @desc    Get relance statistics (users, messages sent, etc.)
 * @access  Admin
 */
router.get('/admin/stats', authenticate, (req, res) =>
    relanceController.getStats(req, res)
);

/**
 * @route   GET /api/relance/admin/logs
 * @desc    Get relance activity logs
 * @access  Admin
 */
router.get('/admin/logs', authenticate, (req, res) =>
    relanceController.getLogs(req, res)
);

/**
 * @route   GET /api/relance/admin/targets
 * @desc    Get active targets with pagination
 * @access  Admin
 */
router.get('/admin/targets', authenticate, (req, res) =>
    relanceController.getActiveTargets(req, res)
);

/**
 * @route   GET /api/relance/admin/configs
 * @desc    Get all active relance configs
 * @access  Admin
 */
router.get('/admin/configs', authenticate, (req, res) =>
    relanceController.getActiveConfigs(req, res)
);

/**
 * @route   GET /api/relance/admin/campaigns
 * @desc    Get all campaigns (with filters)
 * @access  Admin
 */
router.get('/admin/campaigns', authenticate, (req, res) =>
    relanceCampaignController.getCampaigns(req, res)
);

/**
 * @route   GET /api/relance/admin/campaigns/stats
 * @desc    Get campaign statistics
 * @access  Admin
 */
router.get('/admin/campaigns/stats', authenticate, (req, res) =>
    relanceCampaignController.getCampaignStats(req, res)
);

/**
 * @route   GET /api/relance/admin/campaigns/:id
 * @desc    Get campaign by ID (admin)
 * @access  Admin
 */
router.get('/admin/campaigns/:id', authenticate, (req, res) =>
    relanceCampaignController.getCampaignById(req, res)
);

/**
 * @route   GET /api/relance/admin/campaigns/:id/targets
 * @desc    Get campaign targets (admin)
 * @access  Admin
 */
router.get('/admin/campaigns/:id/targets', authenticate, (req, res) =>
    relanceCampaignController.getCampaignTargets(req, res)
);

/**
 * @route   POST /api/relance/admin/campaigns/:id/pause
 * @desc    Pause campaign (admin)
 * @access  Admin
 */
router.post('/admin/campaigns/:id/pause', authenticate, (req, res) =>
    relanceCampaignController.pauseCampaign(req, res)
);

/**
 * @route   POST /api/relance/admin/campaigns/:id/resume
 * @desc    Resume campaign (admin)
 * @access  Admin
 */
router.post('/admin/campaigns/:id/resume', authenticate, (req, res) =>
    relanceCampaignController.resumeCampaign(req, res)
);

/**
 * @route   POST /api/relance/admin/campaigns/:id/cancel
 * @desc    Cancel campaign (admin)
 * @access  Admin
 */
router.post('/admin/campaigns/:id/cancel', authenticate, (req, res) =>
    relanceCampaignController.cancelCampaign(req, res)
);

/**
 * @route   POST /api/relance/admin/upload-media
 * @desc    Upload media file for relance messages (images/videos/PDFs)
 * @access  Admin
 */
router.post('/admin/upload-media', authenticate, uploadRelanceMedia.single('file'), (req, res) =>
    relanceController.uploadMedia(req, res)
);

/**
 * @route   GET /api/relance/media/:filename
 * @desc    Serve uploaded media files
 * @access  Public
 */
router.get('/media/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, '../../../uploads/relance-media', filename);
    res.sendFile(filepath);
});

// ===== INTERNAL ROUTES (Service-to-service) =====

/**
 * @route   POST /api/relance/internal/exit-user
 * @desc    Remove user from relance loop (when they pay)
 * @access  Internal
 */
router.post('/internal/exit-user', (req, res) =>
    relanceController.exitUserFromLoop(req, res)
);

export default router;