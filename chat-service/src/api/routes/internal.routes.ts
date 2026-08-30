import { Router, Request, Response } from 'express';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { conversationService } from '../../services/conversation.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ChatInternalRoutes');
const router = Router();

// All internal routes require the shared service secret.
router.use(authenticateServiceRequest);

/**
 * POST /api/chat/internal/love-conversation
 * Get-or-create the LOVE conversation for a contact-unlocked match.
 * Called by sbclove-service (which owns the eligibility decision).
 * Body: { userId1, userId2, matchId }
 */
router.post('/love-conversation', async (req: Request, res: Response) => {
    try {
        const { userId1, userId2, matchId } = req.body || {};
        if (!userId1 || !userId2 || !matchId) {
            return res.status(400).json({ success: false, message: 'userId1, userId2 and matchId are required' });
        }
        const conversation = await conversationService.getOrCreateLoveConversation(userId1, userId2, matchId);
        return res.status(200).json({ success: true, data: { conversationId: conversation._id.toString() } });
    } catch (error: any) {
        log.error('Error creating love conversation:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to create love conversation' });
    }
});

export default router;
