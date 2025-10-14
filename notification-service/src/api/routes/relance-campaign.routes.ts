import { Router } from 'express';
import { relanceCampaignController } from '../controllers/relance-campaign.controller';

const router = Router();

/**
 * Campaign Management Routes
 * Base path: /api/relance/campaigns
 */

// Preview filter results (with sample users)
router.post('/preview', (req, res) => relanceCampaignController.previewFilterResults(req, res));

// Create new campaign
router.post('/', (req, res) => relanceCampaignController.createCampaign(req, res));

// Get all campaigns for user
router.get('/', (req, res) => relanceCampaignController.getCampaigns(req, res));

// Get campaign details
router.get('/:id', (req, res) => relanceCampaignController.getCampaignById(req, res));

// Get campaign targets
router.get('/:id/targets', (req, res) => relanceCampaignController.getCampaignTargets(req, res));

// Campaign actions
router.post('/:id/start', (req, res) => relanceCampaignController.startCampaign(req, res));
router.post('/:id/pause', (req, res) => relanceCampaignController.pauseCampaign(req, res));
router.post('/:id/resume', (req, res) => relanceCampaignController.resumeCampaign(req, res));
router.post('/:id/cancel', (req, res) => relanceCampaignController.cancelCampaign(req, res));

export default router;
