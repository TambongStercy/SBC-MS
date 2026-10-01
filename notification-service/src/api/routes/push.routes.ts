import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import config from '../../config';
import { pushEnabled, removeSubscription, saveSubscription } from '../../services/push.service';

/**
 * Web push for the app installed on (or open in) a phone's browser.
 * Base path: /api/notifications/push
 */
const router = Router();

// The app needs the public key to subscribe; null means push is off on this server.
router.get('/public-key', (_req, res) => {
    res.status(200).json({ success: true, data: { publicKey: pushEnabled() ? config.push.publicKey : null } });
});

router.post('/subscribe', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    if (!pushEnabled()) { res.status(503).json({ success: false, message: 'Notifications indisponibles.' }); return; }
    const ok = await saveSubscription(userId, req.body?.subscription, req.get('user-agent'));
    if (!ok) { res.status(400).json({ success: false, message: 'Abonnement invalide.' }); return; }
    res.status(200).json({ success: true });
});

router.post('/unsubscribe', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    if (typeof req.body?.endpoint === 'string') await removeSubscription(userId, req.body.endpoint);
    res.status(200).json({ success: true });
});

export default router;
