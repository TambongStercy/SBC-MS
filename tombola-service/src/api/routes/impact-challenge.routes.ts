import { Router } from 'express';
import { impactChallengeController } from '../controllers/impact-challenge.controller';
import { authenticate, authorizeAdmin, authenticateServiceRequest } from '../middleware/auth.middleware';

const router = Router();

// ================== PUBLIC ROUTES ==================

// Get current active challenge
router.get('/current', impactChallengeController.getCurrentChallenge.bind(impactChallengeController));

// Get challenge by ID
router.get('/:challengeId', impactChallengeController.getChallengeById.bind(impactChallengeController));

// Get entrepreneurs for a challenge (public - approved only by default)
router.get('/:challengeId/entrepreneurs', impactChallengeController.getEntrepreneurs.bind(impactChallengeController));

// Get leaderboard
router.get('/:challengeId/leaderboard', impactChallengeController.getLeaderboard.bind(impactChallengeController));

// Get entrepreneur by ID
router.get('/entrepreneurs/:entrepreneurId', impactChallengeController.getEntrepreneurById.bind(impactChallengeController));

// ================== VOTING ROUTES (USER) ==================

// Vote for an entrepreneur (authenticated, generates lottery tickets)
router.post('/:challengeId/vote', authenticate, impactChallengeController.initiateVote.bind(impactChallengeController));

// Support an entrepreneur (public, no lottery tickets)
router.post('/:challengeId/support', impactChallengeController.initiateSupport.bind(impactChallengeController));

// Get user's ticket allowance (authenticated)
router.get('/:challengeId/ticket-allowance', authenticate, impactChallengeController.getTicketAllowance.bind(impactChallengeController));

// ================== WEBHOOK ==================

// Payment confirmation webhook (service-to-service)
router.post('/webhooks/payment-confirmation', authenticateServiceRequest, impactChallengeController.handlePaymentWebhook.bind(impactChallengeController));

// ================== ADMIN ROUTES ==================

// Create challenge
router.post('/admin', authenticate, authorizeAdmin, impactChallengeController.createChallenge.bind(impactChallengeController));

// List all challenges
router.get('/admin', authenticate, authorizeAdmin, impactChallengeController.listChallenges.bind(impactChallengeController));

// Get challenge details (admin)
router.get('/admin/:challengeId', authenticate, authorizeAdmin, impactChallengeController.getAdminChallengeDetails.bind(impactChallengeController));

// Update challenge
router.patch('/admin/:challengeId', authenticate, authorizeAdmin, impactChallengeController.updateChallenge.bind(impactChallengeController));

// Update challenge status
router.patch('/admin/:challengeId/status', authenticate, authorizeAdmin, impactChallengeController.updateChallengeStatus.bind(impactChallengeController));

// Delete challenge
router.delete('/admin/:challengeId', authenticate, authorizeAdmin, impactChallengeController.deleteChallenge.bind(impactChallengeController));

// ================== ENTREPRENEUR ADMIN ROUTES ==================

// Add entrepreneur to challenge
router.post('/admin/:challengeId/entrepreneurs', authenticate, authorizeAdmin, impactChallengeController.addEntrepreneur.bind(impactChallengeController));

// Update entrepreneur
router.patch('/admin/entrepreneurs/:entrepreneurId', authenticate, authorizeAdmin, impactChallengeController.updateEntrepreneur.bind(impactChallengeController));

// Approve entrepreneur
router.patch('/admin/entrepreneurs/:entrepreneurId/approve', authenticate, authorizeAdmin, impactChallengeController.approveEntrepreneur.bind(impactChallengeController));

// Delete entrepreneur
router.delete('/admin/entrepreneurs/:entrepreneurId', authenticate, authorizeAdmin, impactChallengeController.deleteEntrepreneur.bind(impactChallengeController));

// ================== FUND DISTRIBUTION ROUTES ==================

// Close voting
router.post('/admin/:challengeId/close-voting', authenticate, authorizeAdmin, impactChallengeController.closeVoting.bind(impactChallengeController));

// Get fund summary
router.get('/admin/:challengeId/fund-summary', authenticate, authorizeAdmin, impactChallengeController.getFundSummary.bind(impactChallengeController));

// Distribute funds
router.post('/admin/:challengeId/distribute-funds', authenticate, authorizeAdmin, impactChallengeController.distributeFunds.bind(impactChallengeController));

// Get analytics
router.get('/admin/:challengeId/analytics', authenticate, authorizeAdmin, impactChallengeController.getChallengeAnalytics.bind(impactChallengeController));

// Get votes
router.get('/admin/:challengeId/votes', authenticate, authorizeAdmin, impactChallengeController.getVotes.bind(impactChallengeController));

export default router;
