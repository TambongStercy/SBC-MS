import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import {
    IImpactShowcase, IImpactShowcaseUpdate, ImpactCandidate, ImpactEdition, ImpactShowcase, ImpactShowcaseUpdate,
    ImpactSubmission,
} from '../models';
import { CandidateStatus, settingsOf, SubmissionKind, SubmissionStatus } from '../types';
import { Actor, audit, notifyCandidate } from '../lib';
import { getEdition } from './edition.service';

const log = logger.getLogger('ImpactShowcase');

/**
 * « SBC Impact » (spec §14): after the final, the finalists stay on show for
 * at least settings.showcaseMonths (12): profile, project, result, video,
 * podcast, YouTube, shop link, and the project's news. The pages are created
 * when the result is published (and can be created again for an edition
 * whose result predates this phase). Past their end date they move to the
 * archive; nothing is deleted.
 *
 * Updates: the administration publishes at once; a finalist proposes, and the
 * administration validates before anyone sees it.
 */

const oid = (v: unknown, what = 'Ressource') => {
    if (!Types.ObjectId.isValid(String(v))) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(String(v));
};
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-./]{2,299}$/;
const KINDS = ['STEP', 'PRODUCT', 'ACHIEVEMENT', 'NEWS', 'RESULT'] as const;

const httpsUrl = (v: unknown, field: string, hosts?: RegExp): string | undefined => {
    const raw = String(v ?? '').trim();
    if (!raw) return undefined;
    let u: URL;
    try { u = new URL(raw); } catch { throw new AppError('Adresse web invalide.', 400, true, 'INVALID_URL', { field }); }
    if (u.protocol !== 'https:') throw new AppError('L’adresse doit commencer par https://.', 400, true, 'INVALID_URL', { field });
    if (hosts && !hosts.test(u.hostname)) throw new AppError('Ce lien n’est pas une adresse YouTube.', 400, true, 'INVALID_URL', { field });
    if (raw.length > 400) throw new AppError('Adresse trop longue.', 400, true, 'INVALID_URL', { field });
    return u.toString();
};
const YOUTUBE = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

const addMonths = (d: Date, months: number) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + months);
    return x;
};

const isActive = (s: { visibleUntil: Date; hiddenAt?: Date | null }, now = new Date()) => !s.hiddenAt && s.visibleUntil > now;
/** Past its end date (a hidden page is « hidden », not « archived »). */
const isArchived = (s: { visibleUntil: Date }, now = new Date()) => s.visibleUntil <= now;
const frDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' });

/**
 * Creates the pages of an edition's finalists from its published result.
 * Idempotent: a finalist who already has a page is left as is.
 */
export const createForEdition = async (editionId: Types.ObjectId | string, actor?: Actor): Promise<number> => {
    const e = await ImpactEdition.findById(editionId);
    if (!e?.result?.publishedAt) throw new AppError('Le résultat de cette édition n’est pas publié.', 409, true, 'NO_RESULT');
    const months = settingsOf(e.settings).showcaseMonths;
    let created = 0;
    for (const r of e.result.rows) {
        if (await ImpactShowcase.exists({ candidateId: r.candidateId })) continue;
        const c = await ImpactCandidate.findById(r.candidateId).lean();
        if (!c) continue;
        const videos = await ImpactSubmission.find({ candidateId: c._id, current: true, status: SubmissionStatus.ACCEPTED }).lean();
        const video = videos.find((v) => v.kind === SubmissionKind.VIDEO)?.video?.videoFileId
            ?? videos.find((v) => v.kind === SubmissionKind.PROJECT)?.project?.videoFileId;
        try {
            const s = await ImpactShowcase.create({
                editionId: e._id, candidateId: c._id, userId: c.userId,
                profile: {
                    name: c.profile.name, photoFileId: c.profile.photoFileId, activity: c.profile.activity, category: c.profile.category,
                    country: c.profile.country, city: c.profile.city, presentation: c.profile.presentation,
                    projectName: c.profile.projectName, projectDescription: c.profile.projectDescription, sbcId: c.sbcId,
                },
                result: { rank: r.rank, score: r.score, winner: r.rank === 1, editionName: e.name, decidedAt: e.result.publishedAt },
                videoFileId: video,
                shopUrl: c.profile.link,
                visibleFrom: e.result.publishedAt,
                visibleUntil: addMonths(e.result.publishedAt, months),
            });
            created++;
            await notifyCandidate({ _id: s._id, userId: c.userId } as any, 'impact-showcase-live', 'SBC Impact : votre page est en ligne',
                `Votre page SBC Impact est en ligne pour au moins ${months} mois. Proposez-y des nouvelles de votre projet depuis votre espace.`);
        } catch (err: any) {
            if (err?.code !== 11000) throw err; // a concurrent run created it
        }
    }
    if (created) await audit({ actor: actor ?? { role: 'system' }, action: 'showcase.created', editionId: e._id, after: { created } });
    log.info(`Edition ${e._id}: ${created} SBC Impact page(s) created`);
    return created;
};

// ---------- Presentation ----------

const presentUpdate = (u: IImpactShowcaseUpdate | Record<string, any>, opts: { admin?: boolean } = {}) => ({
    _id: String(u._id), kind: u.kind, title: u.title, body: u.body, imageFileId: u.imageFileId ?? null, link: u.link ?? null,
    publishedAt: u.publishedAt ?? null,
    ...(opts.admin || u.status !== 'PUBLISHED'
        ? { status: u.status, authorRole: u.authorRole, review: u.review ? { reason: u.review.reason ?? null, at: u.review.at } : null, createdAt: u.createdAt }
        : {}),
});

const presentShowcase = (s: IImpactShowcase | Record<string, any>, opts: { admin?: boolean; minVisibleUntil?: Date } = {}) => ({
    _id: String(s._id), editionId: String(s.editionId), candidateId: String(s.candidateId),
    profile: s.profile, result: s.result,
    videoFileId: s.videoFileId ?? null, podcast: s.podcast?.url ? s.podcast : null, youtubeUrl: s.youtubeUrl ?? null, shopUrl: s.shopUrl ?? null,
    visibleFrom: s.visibleFrom, visibleUntil: s.visibleUntil,
    archived: isArchived(s as any),
    ...(opts.admin ? {
        userId: String(s.userId), hidden: Boolean(s.hiddenAt), hiddenAt: s.hiddenAt ?? null, hiddenReason: s.hiddenReason ?? null,
        minVisibleUntil: opts.minVisibleUntil ?? null,
    } : {}),
});

// ---------- Public ----------

/**
 * The SBC Impact space: the pages on show (winner first, newest edition first),
 * and the archive (past their end date). Hidden pages appear nowhere.
 */
export const publicList = async () => {
    const all = await ImpactShowcase.find({ hiddenAt: { $exists: false } }).sort({ 'result.decidedAt': -1, 'result.rank': 1 }).lean();
    const now = new Date();
    const latest = await ImpactShowcaseUpdate.aggregate([
        { $match: { showcaseId: { $in: all.map((s) => s._id) }, status: 'PUBLISHED' } },
        { $sort: { publishedAt: -1 } },
        { $group: { _id: '$showcaseId', n: { $sum: 1 }, last: { $first: '$publishedAt' } } },
    ]);
    const meta = new Map(latest.map((l) => [String(l._id), { updates: l.n as number, lastUpdateAt: l.last as Date }]));
    const card = (s: any) => ({ ...presentShowcase(s), updates: meta.get(String(s._id))?.updates ?? 0, lastUpdateAt: meta.get(String(s._id))?.lastUpdateAt ?? null });
    return {
        active: all.filter((s) => s.visibleUntil > now).map(card),
        archived: all.filter((s) => s.visibleUntil <= now).map(card),
    };
};

export const publicOne = async (id: string) => {
    const s = await ImpactShowcase.findOne({ _id: oid(id, 'Page'), hiddenAt: { $exists: false } }).lean();
    if (!s) throw new AppError('Page introuvable.', 404);
    const updates = await ImpactShowcaseUpdate.find({ showcaseId: s._id, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).limit(100).lean();
    return { ...presentShowcase(s), updates: updates.map((u) => presentUpdate(u)) };
};

// ---------- Finalist ----------

/** The finalist's pages, with every update they proposed (and its review). */
export const mine = async (userId: string) => {
    const rows = await ImpactShowcase.find({ userId: oid(userId, 'Membre') }).sort({ 'result.decidedAt': -1 }).lean();
    const out = [];
    for (const s of rows) {
        const updates = await ImpactShowcaseUpdate.find({ showcaseId: s._id, status: { $ne: 'REMOVED' } }).sort({ createdAt: -1 }).limit(100).lean();
        out.push({ ...presentShowcase(s), hidden: Boolean(s.hiddenAt), updates: updates.map((u) => presentUpdate(u, { admin: true })) });
    }
    return out;
};

const parseUpdate = (b: Record<string, any>) => {
    const title = String(b?.title ?? '').trim();
    const body = String(b?.body ?? '').trim();
    if (title.length < 3 || title.length > 120) throw new AppError('Titre : 3 à 120 caractères.', 400, true, 'INVALID_UPDATE', { field: 'title' });
    if (body.length < 20 || body.length > 3000) throw new AppError('Texte : 20 à 3 000 caractères.', 400, true, 'INVALID_UPDATE', { field: 'body' });
    const kind = KINDS.includes(b?.kind) ? b.kind : 'NEWS';
    const imageFileId = b?.imageFileId ? String(b.imageFileId).trim() : undefined;
    if (imageFileId && (!FILE_ID.test(imageFileId) || imageFileId.includes('..'))) throw new AppError('Image invalide.', 400, true, 'INVALID_UPDATE', { field: 'imageFileId' });
    return { title, body, kind, imageFileId, link: httpsUrl(b?.link, 'link') };
};

/** A finalist proposes news of their project; the administration validates it. */
export const proposeUpdate = async (userId: string, showcaseId: string, body: Record<string, any>) => {
    const s = await ImpactShowcase.findOne({ _id: oid(showcaseId, 'Page'), userId: oid(userId, 'Membre') });
    if (!s) throw new AppError('Page introuvable.', 404);
    if (!isActive(s)) throw new AppError('Cette page est archivée.', 409, true, 'ARCHIVED');
    const pending = await ImpactShowcaseUpdate.countDocuments({ showcaseId: s._id, status: 'PENDING' });
    if (pending >= 5) throw new AppError('Vous avez déjà 5 nouvelles en attente de validation.', 409, true, 'TOO_MANY_PENDING');
    const u = await ImpactShowcaseUpdate.create({ showcaseId: s._id, authorRole: 'finalist', authorUserId: s.userId, ...parseUpdate(body), status: 'PENDING' });
    await audit({ actor: { role: 'member', userId }, action: 'showcase.update_proposed', editionId: s.editionId, candidateId: s.candidateId, after: { updateId: String(u._id), title: u.title } });
    return presentUpdate(u, { admin: true });
};

// ---------- Administration ----------

/** The earliest end date allowed: the result + the edition's showcaseMonths. */
const minEnd = async (s: { visibleFrom: Date; editionId: Types.ObjectId }) =>
    addMonths(s.visibleFrom, settingsOf((await ImpactEdition.findById(s.editionId).select('settings').lean())?.settings).showcaseMonths);

export const adminList = async (q: Record<string, any>) => {
    const filter: Record<string, unknown> = {};
    if (q.editionId && Types.ObjectId.isValid(String(q.editionId))) filter.editionId = new Types.ObjectId(String(q.editionId));
    const rows = await ImpactShowcase.find(filter).sort({ 'result.decidedAt': -1, 'result.rank': 1 }).limit(200).lean();
    const pending = await ImpactShowcaseUpdate.aggregate([
        { $match: { showcaseId: { $in: rows.map((r) => r._id) }, status: 'PENDING' } },
        { $group: { _id: '$showcaseId', n: { $sum: 1 } } },
    ]);
    const p = new Map(pending.map((x) => [String(x._id), x.n as number]));
    return rows.map((s) => ({ ...presentShowcase(s, { admin: true }), pendingUpdates: p.get(String(s._id)) ?? 0 }));
};

export const adminOne = async (id: string) => {
    const s = await ImpactShowcase.findById(oid(id, 'Page')).lean();
    if (!s) throw new AppError('Page introuvable.', 404);
    const updates = await ImpactShowcaseUpdate.find({ showcaseId: s._id }).sort({ createdAt: -1 }).limit(200).lean();
    return { ...presentShowcase(s, { admin: true, minVisibleUntil: await minEnd(s) }), updates: updates.map((u) => presentUpdate(u, { admin: true })) };
};

/** Podcast, YouTube, shop link, extended end date, hidden or shown again. */
export const adminEdit = async (actor: Actor, id: string, b: Record<string, any>) => {
    const s = await ImpactShowcase.findById(oid(id, 'Page'));
    if (!s) throw new AppError('Page introuvable.', 404);
    const before = presentShowcase(s.toObject(), { admin: true });
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (b.podcast !== undefined) {
        if (!b.podcast || !b.podcast.url) unset.podcast = 1;
        else set.podcast = { url: httpsUrl(b.podcast.url, 'podcast.url'), title: String(b.podcast.title ?? '').trim().slice(0, 160) || undefined, platform: String(b.podcast.platform ?? '').trim().slice(0, 60) || undefined };
    }
    if (b.youtubeUrl !== undefined) { const v = httpsUrl(b.youtubeUrl, 'youtubeUrl', YOUTUBE); if (v) set.youtubeUrl = v; else unset.youtubeUrl = 1; }
    if (b.shopUrl !== undefined) { const v = httpsUrl(b.shopUrl, 'shopUrl'); if (v) set.shopUrl = v; else unset.shopUrl = 1; }
    if (b.visibleUntil !== undefined) {
        const d = new Date(String(b.visibleUntil));
        if (Number.isNaN(d.getTime())) throw new AppError('Date invalide.', 400, true, 'INVALID_DATE', { field: 'visibleUntil' });
        // « 12 mois minimum » (§14): the end date only moves later than the minimum.
        const min = await minEnd(s);
        if (d < min) throw new AppError(`La page reste visible au moins jusqu’au ${frDate(min)}.`, 400, true, 'TOO_EARLY', { field: 'visibleUntil', minVisibleUntil: min });
        set.visibleUntil = d;
    }
    if (b.hidden === true) {
        const reason = String(b.hiddenReason ?? '').trim();
        if (reason.length < 10) throw new AppError('Indiquez pourquoi la page est masquée (10 caractères au moins).', 400, true, 'REASON_REQUIRED');
        set.hiddenAt = new Date(); set.hiddenReason = reason.slice(0, 500);
    } else if (b.hidden === false) {
        unset.hiddenAt = 1; unset.hiddenReason = 1;
    }
    const done = await ImpactShowcase.findByIdAndUpdate(s._id, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true });
    await audit({ actor, action: 'showcase.edited', editionId: s.editionId, candidateId: s.candidateId, before, after: presentShowcase(done!.toObject(), { admin: true }) });
    return presentShowcase(done!.toObject(), { admin: true, minVisibleUntil: await minEnd(s) });
};

/** The administration publishes news at once. */
export const adminPostUpdate = async (actor: Actor, id: string, body: Record<string, any>) => {
    const s = await ImpactShowcase.findById(oid(id, 'Page'));
    if (!s) throw new AppError('Page introuvable.', 404);
    if (s.hiddenAt) throw new AppError('Cette page est masquée : affichez-la d’abord.', 409, true, 'HIDDEN');
    if (isArchived(s)) throw new AppError('Cette page est archivée.', 409, true, 'ARCHIVED');
    const u = await ImpactShowcaseUpdate.create({
        showcaseId: s._id, authorRole: 'admin', authorUserId: oid(actor.userId), ...parseUpdate(body), status: 'PUBLISHED', publishedAt: new Date(),
    });
    await audit({ actor, action: 'showcase.update_published', editionId: s.editionId, candidateId: s.candidateId, after: { updateId: String(u._id), title: u.title } });
    return presentUpdate(u, { admin: true });
};

/** approve → published; reject (reason the finalist reads); remove a published one. */
export const reviewUpdate = async (actor: Actor, updateId: string, body: Record<string, any>) => {
    const u = await ImpactShowcaseUpdate.findById(oid(updateId, 'Nouvelle'));
    if (!u) throw new AppError('Nouvelle introuvable.', 404);
    const decision = body?.decision;
    const reason = String(body?.reason ?? '').trim().slice(0, 500);
    let next: Record<string, unknown>;
    let from: string[];
    if (decision === 'approve') { from = ['PENDING']; next = { status: 'PUBLISHED', publishedAt: new Date() }; }
    else if (decision === 'reject') {
        if (reason.length < 10) throw new AppError('Indiquez la raison au finaliste (10 caractères au moins).', 400, true, 'REASON_REQUIRED');
        from = ['PENDING']; next = { status: 'REJECTED' };
    } else if (decision === 'remove') {
        if (reason.length < 5) throw new AppError('Indiquez la raison (5 caractères au moins).', 400, true, 'REASON_REQUIRED');
        from = ['PUBLISHED']; next = { status: 'REMOVED' };
    } else throw new AppError('Décision : approve, reject ou remove.', 400, true, 'BAD_DECISION');
    const done = await ImpactShowcaseUpdate.findOneAndUpdate(
        { _id: u._id, status: { $in: from } },
        { $set: { ...next, review: { reason: reason || undefined, at: new Date(), by: oid(actor.userId) } } },
        { new: true },
    );
    if (!done) throw new AppError('Cette nouvelle a déjà été traitée.', 409, true, 'ALREADY_REVIEWED');
    const s = await ImpactShowcase.findById(u.showcaseId).select('editionId candidateId userId').lean();
    await audit({ actor, action: `showcase.update_${decision}`, editionId: s?.editionId, candidateId: s?.candidateId, after: { updateId: String(u._id) }, reason: reason || undefined });
    if (s && u.authorRole === 'finalist' && decision !== 'remove') {
        await notifyCandidate({ _id: u._id, userId: s.userId } as any, decision === 'approve' ? 'impact-showcase-update-published' : 'impact-showcase-update-rejected',
            decision === 'approve' ? 'SBC Impact : nouvelle publiée' : 'SBC Impact : nouvelle non publiée',
            decision === 'approve' ? `Votre nouvelle « ${u.title} » est publiée sur votre page SBC Impact.` : `Votre nouvelle « ${u.title} » n’est pas publiée : ${reason}`);
    }
    return presentUpdate(done, { admin: true });
};

/** Pending news from finalists, oldest first (the admin's queue). */
export const pendingUpdates = async () => {
    const rows = await ImpactShowcaseUpdate.find({ status: 'PENDING' }).sort({ createdAt: 1 }).limit(200).lean();
    const pages = await ImpactShowcase.find({ _id: { $in: rows.map((r) => r.showcaseId) } }).select('profile.name profile.projectName').lean();
    const by = new Map(pages.map((p) => [String(p._id), p]));
    return rows.map((r) => ({ ...presentUpdate(r, { admin: true }), showcaseId: String(r.showcaseId), finalist: by.get(String(r.showcaseId))?.profile ?? null }));
};

/** For an edition whose result came before this phase: create its pages now. */
export const adminCreateForEdition = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    if (!e.result?.publishedAt) throw new AppError('Le résultat de cette édition n’est pas publié.', 409, true, 'NO_RESULT');
    return { created: await createForEdition(e._id, actor) };
};

/** Finalist statuses that may own a page (a winner, or a finalist). */
export const SHOWCASE_STATUSES = [CandidateStatus.WINNER, CandidateStatus.FINALIST];
