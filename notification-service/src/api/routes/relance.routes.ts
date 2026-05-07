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
 * @route   GET /api/relance/status
 * @desc    Check relance configuration status (email-based)
 * @access  Private
 */
router.get('/status', authenticate, (req, res) =>
    relanceController.getStatus(req, res)
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
 * @route   GET /api/relance/message-templates
 * @desc    Get user's saved message templates for pre-filling campaign forms
 * @access  Private
 */
router.get('/message-templates', authenticate, (req, res) =>
    relanceController.getSavedMessageTemplates(req, res)
);

/**
 * @route   PUT /api/relance/message-templates
 * @desc    Save user's message templates for future campaigns
 * @access  Private
 */
router.put('/message-templates', authenticate, (req, res) =>
    relanceController.saveMessageTemplates(req, res)
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
 * @route   GET /api/relance/messages/recent
 * @desc    Get last N messages sent across all relances/campaigns
 * @access  Private
 */
router.get('/messages/recent', authenticate, (req, res) =>
    relanceCampaignController.getRecentMessages(req, res)
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
 * @route   POST /api/relance/admin/messages/preview
 * @desc    Generate a real-time preview of the relance email template
 * @access  Admin
 */
router.post('/admin/messages/preview', authenticate, (req, res) =>
    relanceController.previewMessage(req, res)
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
 * @route   GET /api/relance/admin/campaigns/:id/stats
 * @desc    Get campaign stats by ID (admin)
 * @access  Admin
 */
router.get('/admin/campaigns/:id/stats', authenticate, (req, res) =>
    relanceCampaignController.getCampaignStatsById(req, res)
);

/**
 * @route   GET /api/relance/admin/campaigns/:id/messages/recent
 * @desc    Get recent messages for a campaign (admin)
 * @access  Admin
 */
router.get('/admin/campaigns/:id/messages/recent', authenticate, (req, res) =>
    relanceCampaignController.getCampaignRecentMessages(req, res)
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

// ===== PACK (CREDIT) ROUTES =====

/**
 * @route   GET /api/relance/packs
 * @desc    List available email and SMS packs with prices
 * @access  Private
 */
router.get('/packs', authenticate, (req, res) =>
    relanceController.listPacks(req, res)
);

/**
 * @route   POST /api/relance/packs/purchase
 * @desc    Initiate a pack purchase (creates PaymentIntent, returns sessionId + checkoutUrl)
 * @access  Private
 */
router.post('/packs/purchase', authenticate, (req, res) =>
    relanceController.purchasePack(req, res)
);

/**
 * @route   GET /api/relance/balance
 * @desc    Get current email and SMS credit balances
 * @access  Private
 */
router.get('/balance', authenticate, (req, res) =>
    relanceController.getBalance(req, res)
);

// ===== SMS LINK ROUTES =====

/**
 * @route   GET /api/relance/sms-links
 * @desc    Get user's per-day SMS links (auto + manual)
 * @access  Private
 */
router.get('/sms-links', authenticate, (req, res) =>
    relanceController.getSmsLinks(req, res)
);

/**
 * @route   PUT /api/relance/sms-links
 * @desc    Update one or multiple per-day SMS links
 * @access  Private
 */
router.put('/sms-links', authenticate, (req, res) =>
    relanceController.updateSmsLinks(req, res)
);

// ===== ADMIN SMS TEMPLATE ROUTES =====

/**
 * @route   GET /api/relance/admin/sms-templates
 * @desc    List all predefined SMS templates
 * @access  Admin
 */
router.get('/admin/sms-templates', authenticate, (req, res) =>
    relanceController.listSmsTemplates(req, res)
);

/**
 * @route   PUT /api/relance/admin/sms-templates/:type/:day
 * @desc    Update a predefined SMS template
 * @access  Admin
 */
router.put('/admin/sms-templates/:type/:day', authenticate, (req, res) =>
    relanceController.updateSmsTemplate(req, res)
);

/**
 * @route   POST /api/relance/admin/sms-templates/preview
 * @desc    Preview a SMS template with a sample link
 * @access  Admin
 */
router.post('/admin/sms-templates/preview', authenticate, (req, res) =>
    relanceController.previewSmsTemplate(req, res)
);

/**
 * @route   PUT /api/relance/admin/configs/:userId
 * @desc    Admin: update a user's relance config (smsEnabled, maxMessagesPerDay, etc.)
 * @access  Admin
 */
router.put('/admin/configs/:userId', authenticate, (req, res) =>
    relanceController.adminUpdateConfig(req, res)
);

// ===== INTERNAL ROUTES (Service-to-service) =====

/**
 * @route   POST /api/relance/internal/exit-user
 * @desc    Remove user from relance loop (when they pay)
 * @access  Internal
 */
router.post('/internal/exit-user', (req, res) =>
    relanceController.exitUserFromLoop(req, res)
);

/**
 * @route   POST /api/relance/internal/credit-pack
 * @desc    Credit user's email or SMS balance after successful pack payment
 * @access  Internal (called by payment-service)
 */
router.post('/internal/credit-pack', (req, res) =>
    relanceController.creditPack(req, res)
);

export default router;