import { Router, Response } from 'express';
import { authenticate, authenticateServiceRequest, AuthenticatedRequest, requireAdmin } from '../middleware/auth.middleware';
import mongoose from 'mongoose';
import PushPreferenceModel from '../../database/models/push-preference.model';
import PushAnnouncementModel, { AnnouncementFilter } from '../../database/models/push-announcement.model';
import { userServiceClient } from '../../services/clients/user.service.client';
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
            categories: PUSH_CATEGORIES.map(c => ({ key: c.key, label: c.label, holdAtNight: c.holdAtNight, enabled: !disabled.has(c.key) })),
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

/**
 * Admin announcements. Targeted ones (a filter) are not limited; one to
 * EVERY member with push on is, because past that people stop reading — or
 * switch "Annonces SBC" off, and then nothing reaches them.
 */
export const ANNOUNCEMENTS_TO_ALL_PER_DAY = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A clean filter from the request; null when it asks for nothing (= everyone). */
function filterFrom(raw: any): AnnouncementFilter | null {
    if (!raw || typeof raw !== 'object') return null;
    const countries = Array.isArray(raw.countries)
        ? [...new Set(raw.countries.filter((c: unknown) => typeof c === 'string' && /^[a-z]{2}$/i.test(c)).map((c: string) => c.toUpperCase()))] as string[]
        : [];
    const subscription = raw.subscription === 'subscribed' || raw.subscription === 'unsubscribed' ? raw.subscription : undefined;
    const sex = raw.sex === 'male' || raw.sex === 'female' ? raw.sex : undefined;
    const filter: AnnouncementFilter = { ...(countries.length ? { countries } : {}), ...(subscription ? { subscription } : {}), ...(sex ? { sex } : {}) };
    return Object.keys(filter).length ? filter : null;
}

/** Members with push on that the filter picks; null when user-service cannot say. */
async function audienceFor(filter: AnnouncementFilter | null): Promise<string[] | null> {
    const withPush = await usersWithDevices();
    if (!filter || withPush.length === 0) return withPush;
    return userServiceClient.filterForAnnouncement(withPush, filter);
}

const toAllToday = () => PushAnnouncementModel.countDocuments({ toAll: true, createdAt: { $gte: new Date(Date.now() - DAY_MS) } });

router.get('/admin/announcements', authenticate, requireAdmin, async (_req, res) => {
    const recent = await PushAnnouncementModel.find().sort({ createdAt: -1 }).limit(20).lean();
    res.status(200).json({
        success: true,
        data: { recent, toAllToday: await toAllToday(), toAllPerDay: ANNOUNCEMENTS_TO_ALL_PER_DAY, audience: (await usersWithDevices()).length },
    });
});

/** How many members a filter reaches, for the admin page while it is being set. */
router.post('/admin/audience', authenticate, requireAdmin, async (req, res) => {
    const audience = await audienceFor(filterFrom(req.body?.filter));
    if (!audience) { res.status(503).json({ success: false, message: 'Impossible de compter les membres pour le moment.' }); return; }
    res.status(200).json({ success: true, data: { count: audience.length } });
});

router.post('/admin/announce', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const message = messageFrom(req.body);
    if (!message) { res.status(400).json({ success: false, message: 'Titre et message requis.' }); return; }
    const filter = filterFrom(req.body?.filter);
    const toAll = !filter;
    const sendNow = req.body?.sendNow === true;
    if (toAll && (await toAllToday()) >= ANNOUNCEMENTS_TO_ALL_PER_DAY) {
        res.status(429).json({ success: false, message: `${ANNOUNCEMENTS_TO_ALL_PER_DAY} annonce à tous les membres maximum par 24 h. Ciblez-la avec un filtre, ou attendez.` });
        return;
    }
    const audience = await audienceFor(filter);
    if (!audience) { res.status(503).json({ success: false, message: 'Impossible de trouver les membres ciblés pour le moment.' }); return; }
    const announcement = await PushAnnouncementModel.create({
        by: new mongoose.Types.ObjectId(req.user!.userId), ...message, recipients: audience.length,
        ...(filter ? { filter } : {}), toAll, sendNow,
    });
    // At night an announcement waits for 07:00 (Douala) unless the admin chose to send it now.
    const now = new Date();
    const heldUntil = !sendNow && inQuietHours(now) ? endOfQuietHours(now).toISOString() : null;
    res.status(202).json({ success: true, data: { recipients: audience.length, heldUntil } });
    // Sent after answering: thousands of devices take a while. Each announcement
    // has its own tag — a shared one made the night queue keep only the last
    // announcement of the night, dropping the others.
    const tag = `announcement-${announcement._id.toString()}`;
    void (async () => {
        const counts: Record<string, number> = {};
        for (const id of audience) {
            const outcome = await sendPushToUser(id, { ...message, tag }, { category: 'announcements', sendNow });
            counts[outcome] = (counts[outcome] ?? 0) + 1;
        }
        log.info(`Announcement "${message.title}" to ${audience.length} user(s): ${JSON.stringify(counts)}`);
    })().catch(err => log.error(`Announcement push failed: ${err?.message ?? err}`));
});

export default router;
