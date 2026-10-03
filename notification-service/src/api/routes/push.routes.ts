import { Router, Response } from 'express';
import { authenticate, authenticateServiceRequest, AuthenticatedRequest, requireAdmin } from '../middleware/auth.middleware';
import mongoose from 'mongoose';
import PushPreferenceModel from '../../database/models/push-preference.model';
import PushAnnouncementModel from '../../database/models/push-announcement.model';
import { endOfQuietHours, inQuietHours, isPushCategory, PUSH_CATEGORIES, QUIET_FROM_H, QUIET_UNTIL_H } from '../../services/push-categories';
import logger from '../../utils/logger';
import config from '../../config';
import { PushMessage, pushEnabled, removeSubscription, saveSubscription, sendPushToUser, usersWithDevices } from '../../services/push.service';

const log = logger.getLogger('PushRoutes');

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

// What a user receives: every kind of push, on or off. Applies to all their devices.
router.get('/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    const pref = await PushPreferenceModel.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    const disabled = new Set(pref?.disabled ?? []);
    res.status(200).json({
        success: true,
        data: {
            categories: PUSH_CATEGORIES.map(c => ({ key: c.key, label: c.label, urgent: c.urgent, enabled: !disabled.has(c.key) })),
            quietHours: { from: QUIET_FROM_H, until: QUIET_UNTIL_H },
        },
    });
});

router.put('/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    const disabled = Array.isArray(req.body?.disabled) ? [...new Set(req.body.disabled.filter(isPushCategory))] : null;
    if (!disabled) { res.status(400).json({ success: false, message: 'disabled doit être une liste.' }); return; }
    await PushPreferenceModel.updateOne({ userId: new mongoose.Types.ObjectId(userId) }, { $set: { disabled } }, { upsert: true });
    res.status(200).json({ success: true, data: { disabled } });
});

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const messageFrom = (b: any): PushMessage | null => {
    const title = text(b?.title, 120);
    const body = text(b?.body, 400);
    if (!title || !body) return null;
    return {
        title,
        body,
        ...(typeof b.url === 'string' && b.url.startsWith('/') ? { url: b.url } : {}),
        ...(typeof b.tag === 'string' ? { tag: b.tag.slice(0, 120) } : {}),
        ...(typeof b.icon === 'string' && /^(https:\/\/|\/)/.test(b.icon) ? { icon: b.icon.slice(0, 500) } : {}),
        ...(b.renotify === true ? { renotify: true } : {}),
        ...(typeof b.cta === 'string' && b.cta.trim() ? { cta: b.cta.trim().slice(0, 30) } : {}),
    };
};

/**
 * Other services send push through here: { userId | userIds, category, title,
 * body, url?, tag?, icon?, renotify? }. Best-effort for the caller — a 2xx
 * with counts, never a failure because one user has no device.
 */
router.post('/internal/send', authenticateServiceRequest, async (req, res) => {
    const { category } = req.body ?? {};
    const message = messageFrom(req.body);
    const ids: string[] = (Array.isArray(req.body?.userIds) ? req.body.userIds : [req.body?.userId])
        .filter((id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id))
        .slice(0, 1000);
    if (!isPushCategory(category) || !message || ids.length === 0) {
        res.status(400).json({ success: false, message: 'userId(s), category, title and body are required.' });
        return;
    }
    const counts: Record<string, number> = {};
    for (const id of ids) {
        const outcome = await sendPushToUser(id, message, { category });
        counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
    res.status(200).json({ success: true, data: counts });
});

/** Admin announcements to everyone with push. Capped: people stop reading — or turn it off — past a few a week. */
export const ANNOUNCEMENTS_PER_WEEK = 3;

router.get('/admin/announcements', authenticate, requireAdmin, async (_req, res) => {
    const recent = await PushAnnouncementModel.find().sort({ createdAt: -1 }).limit(20).lean();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const usedThisWeek = recent.filter(a => a.createdAt >= weekAgo).length;
    res.status(200).json({ success: true, data: { recent, usedThisWeek, perWeek: ANNOUNCEMENTS_PER_WEEK, audience: (await usersWithDevices()).length } });
});

router.post('/admin/announce', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const message = messageFrom(req.body);
    if (!message) { res.status(400).json({ success: false, message: 'Titre et message requis.' }); return; }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if ((await PushAnnouncementModel.countDocuments({ createdAt: { $gte: weekAgo } })) >= ANNOUNCEMENTS_PER_WEEK) {
        res.status(429).json({ success: false, message: `${ANNOUNCEMENTS_PER_WEEK} annonces maximum par semaine.` });
        return;
    }
    const audience = await usersWithDevices();
    const announcement = await PushAnnouncementModel.create({ by: new mongoose.Types.ObjectId(req.user!.userId), ...message, recipients: audience.length });
    // At night it waits for 07:00 (Douala) like every non-urgent push; say so.
    const now = new Date();
    const heldUntil = inQuietHours(now) ? endOfQuietHours(now).toISOString() : null;
    res.status(202).json({ success: true, data: { recipients: audience.length, heldUntil } });
    // Sent after answering: thousands of devices take a while. Each announcement
    // has its own tag — a shared one made the night queue keep only the last
    // announcement of the night, dropping the others.
    const tag = `announcement-${announcement._id.toString()}`;
    void (async () => {
        const counts: Record<string, number> = {};
        for (const id of audience) {
            const outcome = await sendPushToUser(id, { ...message, tag }, { category: 'announcements' });
            counts[outcome] = (counts[outcome] ?? 0) + 1;
        }
        log.info(`Announcement "${message.title}" to ${audience.length} user(s): ${JSON.stringify(counts)}`);
    })().catch(err => log.error(`Announcement push failed: ${err?.message ?? err}`));
});

export default router;
