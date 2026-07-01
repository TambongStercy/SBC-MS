import { Router, Request, Response } from 'express';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { matchService } from '../../services/match.service';
import logger from '../../utils/logger';

const log = logger.getLogger('SbcloveInternalRoutes');
const router = Router();

// All internal routes require the shared service secret (chat-service caller).
router.use(authenticateServiceRequest);

/**
 * GET /sbclove/internal/can-chat?matchId=&userId=
 * Authority for chat-service's LOVE send gate: consent still unlocked + window open.
 */
router.get('/can-chat', async (req: Request, res: Response) => {
    try {
        const matchId = String(req.query.matchId ?? '');
        const userId = String(req.query.userId ?? '');
        if (!matchId || !userId) {
            return res.status(400).json({ success: false, message: 'matchId and userId are required' });
        }
        const result = await matchService.canChat(matchId, userId);
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        log.error('can-chat error:', error);
        return res.status(500).json({ success: false, message: error.message || 'can-chat failed' });
    }
});

/**
 * GET /sbclove/internal/window — the weekly window flag alone.
 */
router.get('/window', async (_req: Request, res: Response) => {
    try {
        const isOpen = await matchService.isChatWindowOpen();
        return res.status(200).json({ success: true, data: { isOpen } });
    } catch (error: any) {
        log.error('window error:', error);
        return res.status(500).json({ success: false, message: error.message || 'window check failed' });
    }
});

export default router;
