import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthenticatedRequest, requireAdmin } from '../middleware/auth.middleware';
import PopupAnnouncementModel, { IPopupAnnouncement, PopupStatus } from '../../database/models/popup-announcement.model';
import PopupAnnouncementViewModel from '../../database/models/popup-announcement-view.model';
import { AnnouncementTargeting, TargetingError, targetingFrom } from '../../services/announcement-targeting';
import { userServiceClient } from '../../services/clients/user.service.client';
import { dateMatch, readAdminFilters } from '../../utils/admin-filters';
import logger from '../../utils/logger';

const log = logger.getLogger('PopupAnnouncementRoutes');

/**
 * Pop-up announcements: the admin writes one, picks who it is for, and each
 * member it targets sees it once when they open the app.
 * Base path: /api/notifications/announcements
 *   member: GET /next, POST /:id/event
 *   admin:  GET /admin, GET /admin/options, POST /admin/audience, POST /admin,
 *           PATCH /admin/:id, DELETE /admin/:id
 */
const router = Router();
router.use(authenticate);

const oid = (id: string) => new mongoose.Types.ObjectId(id);

// ---------------------------------------------------------------------------
// Member side
// ---------------------------------------------------------------------------

/**
 * Does this member match this announcement? user-service answers from the
 * member's profile; the answer is kept 10 min so opening the app again does
 * not ask again. Null = could not tell (not shown, asked again next time).
 */
const MATCH_TTL_MS = 10 * 60_000;
const MATCH_CACHE_MAX = 50_000;
const matchCache = new Map<string, { ok: boolean; at: number }>();

async function memberMatches(userId: string, a: Pick<IPopupAnnouncement, '_id' | 'filter' | 'updatedAt'>): Promise<boolean | null> {
    if (!a.filter || Object.keys(a.filter).length === 0) return true;
    // The announcement's updatedAt is in the key: editing its filter invalidates the cached answers.
    const key = `${userId}:${String(a._id)}:${new Date(a.updatedAt).getTime()}`;
    const hit = matchCache.get(key);
    if (hit && hit.at > Date.now() - MATCH_TTL_MS) return hit.ok;
    const picked = await userServiceClient.filterForAnnouncement([userId], a.filter);
    if (!picked) return null;
    if (matchCache.size >= MATCH_CACHE_MAX) matchCache.clear();
    const ok = picked.includes(userId);
    matchCache.set(key, { ok, at: Date.now() });
    return ok;
}

const liveQuery = (now: Date) => ({
    status: 'active',
    startsAt: { $lte: now },
    $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gt: now } }],
});

const forMember = (a: IPopupAnnouncement) => ({
    id: String(a._id), title: a.title, message: a.message,
    imageUrl: a.imageUrl ?? null, buttonLabel: a.buttonLabel ?? null, buttonUrl: a.buttonUrl ?? null,
});

/** The announcement to show this member now (newest first), or null. */
router.get('/next', async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId || !mongoose.isValidObjectId(userId)) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    try {
        const candidates = await PopupAnnouncementModel.find(liveQuery(new Date())).sort({ startsAt: -1 }).limit(20);
        if (candidates.length === 0) { res.status(200).json({ success: true, data: null }); return; }
        const done = new Set((await PopupAnnouncementViewModel.find({
            userId: oid(userId),
            announcementId: { $in: candidates.map(c => c._id) },
            $or: [{ closedAt: { $exists: true } }, { clickedAt: { $exists: true } }],
        }).select('announcementId').lean()).map(v => String(v.announcementId)));
        for (const a of candidates) {
            if (done.has(String(a._id))) continue;
            if (await memberMatches(userId, a)) { res.status(200).json({ success: true, data: forMember(a) }); return; }
        }
        res.status(200).json({ success: true, data: null });
    } catch (error) {
        log.error(`Next announcement failed: ${(error as Error)?.message ?? error}`);
        // Never block the app over an announcement.
        res.status(200).json({ success: true, data: null });
    }
});

/** shown | closed | clicked. Each counts once per member. */
router.post('/:id/event', async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    const { id } = req.params;
    const type = req.body?.type;
    if (!userId || !mongoose.isValidObjectId(userId)) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    if (!mongoose.isValidObjectId(id) || !['shown', 'closed', 'clicked'].includes(type)) {
        res.status(400).json({ success: false, message: 'Annonce ou événement invalide.' });
        return;
    }
    const field = `${type}At` as 'shownAt' | 'closedAt' | 'clickedAt';
    try {
        if (!(await PopupAnnouncementModel.exists({ _id: oid(id) }))) { res.status(404).json({ success: false, message: 'Annonce introuvable.' }); return; }
        // Set the date only if not set yet, and count only that first time.
        const before = await PopupAnnouncementViewModel.findOneAndUpdate(
            { announcementId: oid(id), userId: oid(userId) },
            { $setOnInsert: { announcementId: oid(id), userId: oid(userId) } },
            { upsert: true, new: false },
        ).lean();
        if (!before?.[field]) {
            const set = await PopupAnnouncementViewModel.updateOne(
                { announcementId: oid(id), userId: oid(userId), [field]: { $exists: false } },
                { $set: { [field]: new Date() } },
            );
            if (set.modifiedCount === 1) await PopupAnnouncementModel.updateOne({ _id: oid(id) }, { $inc: { [`stats.${type}`]: 1 } });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        // Two events at once for a new member: the unique index refuses the second insert. Harmless.
        if ((error as { code?: number })?.code === 11000) { res.status(200).json({ success: true }); return; }
        log.error(`Announcement event failed: ${(error as Error)?.message ?? error}`);
        res.status(500).json({ success: false, message: 'Événement non enregistré.' });
    }
});

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

const admin = Router();
admin.use(requireAdmin);

class ContentError extends Error {}

const text = (v: unknown, label: string, max: number, required: boolean): string | undefined => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        if (required) throw new ContentError(`${label} requis.`);
        return undefined;
    }
    if (typeof v !== 'string') throw new ContentError(`${label} invalide.`);
    const t = v.trim();
    if (t.length > max) throw new ContentError(`${label} : ${max} caractères maximum.`);
    return t;
};

/** An app path (/abonnement) or an https link; never javascript:, //host, http:. */
const isSafeLink = (u: string) => (/^\/(?!\/)/.test(u) && !/\s/.test(u)) || /^https:\/\/[^\s]+$/i.test(u);

const date = (v: unknown, label: string): Date | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) throw new ContentError(`${label} invalide.`);
    return d;
};

interface Content {
    title: string; message: string; imageUrl?: string; buttonLabel?: string; buttonUrl?: string;
    startsAt: Date; endsAt?: Date;
}

/** Checks the editable fields; `current` fills what a PATCH leaves out. */
function contentFrom(body: Record<string, unknown>, current?: IPopupAnnouncement): Content {
    const pick = <K extends keyof Content>(k: K) => (k in body ? body[k] : current?.[k as keyof IPopupAnnouncement]);
    const c: Content = {
        title: text(pick('title'), 'Titre', 120, true)!,
        message: text(pick('message'), 'Message', 1500, true)!,
        imageUrl: text(pick('imageUrl'), "Lien de l'image", 500, false),
        buttonLabel: text(pick('buttonLabel'), 'Texte du bouton', 40, false),
        buttonUrl: text(pick('buttonUrl'), 'Lien du bouton', 500, false),
        startsAt: date(pick('startsAt'), 'Date de début') ?? current?.startsAt ?? new Date(),
        endsAt: date(pick('endsAt'), 'Date de fin'),
    };
    // Uploaded images come back as <admin API origin>/api/settings/files/<id>: plain http only on a local machine.
    if (c.imageUrl && !isSafeLink(c.imageUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/i.test(c.imageUrl)) {
        throw new ContentError("L'image doit être un lien https ou un fichier SBC.");
    }
    if (!!c.buttonLabel !== !!c.buttonUrl) throw new ContentError('Le bouton a besoin d’un texte et d’un lien.');
    if (c.buttonUrl && !isSafeLink(c.buttonUrl)) throw new ContentError('Le lien du bouton doit être une page de l’app (/abonnement) ou un lien https.');
    if (c.endsAt && c.endsAt <= c.startsAt) throw new ContentError('La date de fin doit être après la date de début.');
    return c;
}

const badRequest = (res: Response, e: unknown) => {
    if (e instanceof ContentError || e instanceof TargetingError) { res.status(400).json({ success: false, message: e.message }); return true; }
    return false;
};

/** What the admin list shows: scheduled / live / expired come from the dates. */
const stateOf = (a: IPopupAnnouncement, now = new Date()) =>
    a.status !== 'active' ? a.status
        : a.startsAt > now ? 'scheduled'
            : a.endsAt && a.endsAt <= now ? 'expired'
                : 'live';

const forAdmin = (a: IPopupAnnouncement) => ({ ...a.toObject(), id: String(a._id), state: stateOf(a) });

/**
 * List, newest first.
 * - ?country: announcements for every country, or naming that one.
 * - ?from/?to: creation date. ?status: active | paused | ended.
 */
admin.get('/', async (req, res) => {
    const f = readAdminFilters(req, res); if (!f) return;
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
    const query: Record<string, unknown> = { ...dateMatch('createdAt', f) };
    if (['active', 'paused', 'ended'].includes(String(req.query.status))) query.status = String(req.query.status);
    if (f.country) {
        query.$or = [
            { 'filter.countries': { $in: [f.country] } },
            { 'filter.countries': { $exists: false } },
            { 'filter.countries': { $size: 0 } },
        ];
    }
    try {
        const [items, total, live] = await Promise.all([
            PopupAnnouncementModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            PopupAnnouncementModel.countDocuments(query),
            PopupAnnouncementModel.countDocuments(liveQuery(new Date())),
        ]);
        res.status(200).json({ success: true, data: { items: items.map(forAdmin), total, page, limit, live } });
    } catch (error) {
        log.error(`Admin popup list failed: ${(error as Error)?.message ?? error}`);
        res.status(500).json({ success: false, message: 'Impossible de charger les annonces.' });
    }
});

/** Interests and professions members picked, with how many picked each. */
admin.get('/options', async (_req, res) => {
    const options = await userServiceClient.announcementTargetingOptions();
    if (!options) { res.status(503).json({ success: false, message: 'Impossible de charger les centres d’intérêt et métiers pour le moment.' }); return; }
    res.status(200).json({ success: true, data: options });
});

/** How many members a targeting reaches (read only). */
admin.post('/audience', async (req, res) => {
    let filter: AnnouncementTargeting | null;
    try { filter = targetingFrom(req.body?.filter); } catch (e) { if (badRequest(res, e)) return; throw e; }
    const count = await userServiceClient.countForAnnouncement(filter ?? {});
    if (count === null) { res.status(503).json({ success: false, message: 'Impossible de compter les membres pour le moment.' }); return; }
    res.status(200).json({ success: true, data: { count } });
});

admin.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const content = contentFrom(req.body ?? {});
        const filter = targetingFrom(req.body?.filter);
        const audience = await userServiceClient.countForAnnouncement(filter ?? {});
        if (audience === null) { res.status(503).json({ success: false, message: 'Impossible de compter les membres ciblés pour le moment. Réessayez.' }); return; }
        if (audience === 0) { res.status(400).json({ success: false, message: 'Aucun membre ne correspond à ce ciblage.' }); return; }
        const status: PopupStatus = req.body?.status === 'paused' ? 'paused' : 'active';
        const a = await PopupAnnouncementModel.create({
            by: oid(req.user!.userId), ...content, ...(filter ? { filter } : {}), audience, status,
        });
        log.info(`Popup announcement "${a.title}" created by ${req.user!.userId} for ${audience} member(s)`);
        res.status(201).json({ success: true, data: forAdmin(a) });
    } catch (e) {
        if (badRequest(res, e)) return;
        log.error(`Popup create failed: ${(e as Error)?.message ?? e}`);
        res.status(500).json({ success: false, message: 'Annonce non enregistrée.' });
    }
});

/** Edit the text, dates or targeting, or change the status (active / paused / ended). */
admin.patch('/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ success: false, message: 'Annonce invalide.' }); return; }
    try {
        const a = await PopupAnnouncementModel.findById(req.params.id);
        if (!a) { res.status(404).json({ success: false, message: 'Annonce introuvable.' }); return; }
        const body = req.body ?? {};
        const content = contentFrom(body, a);
        a.set(content);
        if ('endsAt' in body && !content.endsAt) a.set('endsAt', undefined);
        if ('filter' in body) {
            const filter = targetingFrom(body.filter);
            const audience = await userServiceClient.countForAnnouncement(filter ?? {});
            if (audience === null) { res.status(503).json({ success: false, message: 'Impossible de compter les membres ciblés pour le moment. Réessayez.' }); return; }
            if (audience === 0) { res.status(400).json({ success: false, message: 'Aucun membre ne correspond à ce ciblage.' }); return; }
            a.set('filter', filter ?? undefined);
            a.audience = audience;
        }
        if ('status' in body) {
            if (!['active', 'paused', 'ended'].includes(body.status)) { res.status(400).json({ success: false, message: 'Statut invalide.' }); return; }
            a.status = body.status;
        }
        await a.save();
        res.status(200).json({ success: true, data: forAdmin(a) });
    } catch (e) {
        if (badRequest(res, e)) return;
        log.error(`Popup update failed: ${(e as Error)?.message ?? e}`);
        res.status(500).json({ success: false, message: 'Annonce non modifiée.' });
    }
});

/** Deletes the announcement and who saw it. To keep the figures, end it instead. */
admin.delete('/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ success: false, message: 'Annonce invalide.' }); return; }
    const deleted = await PopupAnnouncementModel.findByIdAndDelete(req.params.id);
    if (!deleted) { res.status(404).json({ success: false, message: 'Annonce introuvable.' }); return; }
    await PopupAnnouncementViewModel.deleteMany({ announcementId: deleted._id });
    res.status(200).json({ success: true });
});

router.use('/admin', admin);

export default router;
