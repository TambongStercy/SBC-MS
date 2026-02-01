import { Router } from 'express';
import { relanceCampaignController } from '../controllers/relance-campaign.controller';

const router = Router();

/**
 * Campaign Management Routes
 * Base path: /api/relance/campaigns
 */

// Default relance (auto-enrollment without campaign)
router.get('/default/stats', (req, res) => relanceCampaignController.getDefaultRelanceStats(req, res));
router.get('/default/targets', (req, res) => relanceCampaignController.getDefaultRelanceTargets(req, res));

// Preview filter results (with sample users)
router.post('/preview', (req, res) => relanceCampaignController.previewFilterResults(req, res));

// Create new campaign
router.post('/', (req, res) => relanceCampaignController.createCampaign(req, res));

// Get all campaigns for user
router.get('/', (req, res) => relanceCampaignController.getCampaigns(req, res));

// Get campaign stats (must be before /:id catch-all)
router.get('/:id/stats', (req, res) => relanceCampaignController.getCampaignStatsById(req, res));

// Get campaign recent messages (must be before /:id catch-all)
router.get('/:id/messages/recent', (req, res) => relanceCampaignController.getCampaignRecentMessages(req, res));

// Get campaign details
router.get('/:id', (req, res) => relanceCampaignController.getCampaignById(req, res));

// Get campaign targets
router.get('/:id/targets', (req, res) => relanceCampaignController.getCampaignTargets(req, res));

// Campaign actions
router.post('/:id/start', (req, res) => relanceCampaignController.startCampaign(req, res));
router.post('/:id/pause', (req, res) => relanceCampaignController.pauseCampaign(req, res));
router.post('/:id/resume', (req, res) => relanceCampaignController.resumeCampaign(req, res));
router.post('/:id/cancel', (req, res) => relanceCampaignController.cancelCampaign(req, res));
router.delete('/:id', (req, res) => relanceCampaignController.deleteCampaign(req, res));

export default router;
