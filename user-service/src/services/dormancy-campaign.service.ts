import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import {
    DormancyCampaignModel, DormancyCampaignTargetModel, DormancyContactModel, DormancyReactivationTextModel,
} from '../database/models/dormancy.model';
import { notificationService } from './clients/notification.service.client';
import { DORMANT_SET, DormancyActionError, DormantFilters, matchFor } from './dormancy.service';
import logger from '../utils/logger';

const log = logger.getLogger('DormancyCampaign');

/**
 * Security plan Phase 7 part 2: the « réactivation » campaign to dormant accounts.
 *
 * - The text: a draft a super admin edits, and an APPROVED version (who, when, version). Only
 *   the approved version is ever sent; each campaign keeps a copy of the one it used.
 * - A campaign: the « Comptes dormants » filters → one target row per member (unique per
 *   campaign), built in the background, then worked through by `runCampaignSender` (every
 *   minute) one member at a time: notification-service sends the email out of relance's share of
 *   the mail server, daytime only, never Cloudflare, and the push as an announcement.
 * - At most one réactivation per member per 30 days (REACTIVATION_MIN_DAYS): `dormancy_contacts`
 *   is claimed with one conditional upsert just before the send, so the database refuses a second
 *   claim inside the window (duplicate key), whatever two campaigns or two processes do.
 * - Left out, at build and again just before sending: deleted or blocked accounts, frozen ones,
 *   members the fraud engine flags (dormancy.fraudFlag), members contacted in the last 30 days,
 *   members with neither a usable email (none, bounced, unsubscribed) nor a push device with
 *   « Annonces SBC » on, and members who came back meanwhile.
 * - A member who comes back still goes through the return hold (noteSignIn,
 *   DORMANCY_REACTIVATION_HOLD); the campaign only counts the return (`returnedAt`, 30 days).
 * - Preprod safety: REACTIVATION_SEND_MODE=live is required to send to everyone. Any other value
 *   (the default) is « allowlist »: only the members in REACTIVATION_TEST_RECIPIENTS (emails or
 *   user ids, comma-separated) are sent anything; the rest are skipped as `test_mode`.
 */

export const MIN_DAYS = () => {
    const v = Number(process.env.REACTIVATION_MIN_DAYS);
    return Number.isFinite(v) && v >= 1 ? v : 30;
};
const DAY_MS = 86_400_000;
const MAX_AUDIENCE = 200_000;
const SEND_BATCH = 50;
const MAX_ATTEMPTS = 5;

export const DEFAULT_TEXT = {
    subject: 'Des nouvelles de votre compte SBC',
    body: [
        'Bonjour {{nom}},',
        'Cela fait un moment que vous ne vous êtes pas connecté à SBC. Votre compte est toujours ouvert et tout ce qu’il contient vous appartient toujours.',
        'Pour le retrouver, ouvrez l’application SBC comme d’habitude, ou utilisez le bouton ci-dessous, puis connectez-vous avec vos identifiants habituels.',
        'Une question ? Le support SBC vous répond depuis la rubrique « Aide » de l’application.',
        'L’équipe SBC',
    ].join('\n\n'),
    pushTitle: 'Votre compte SBC vous attend',
    pushBody: 'Cela fait un moment ! Ouvrez SBC pour retrouver votre compte.',
};
type Text = typeof DEFAULT_TEXT;
const LIMITS: Record<keyof Text, number> = { subject: 120, body: 2000, pushTitle: 80, pushBody: 200 };
const FIELD_FR: Record<keyof Text, string> = { subject: 'L’objet', body: 'Le message', pushTitle: 'Le titre de la notification', pushBody: 'Le texte de la notification' };

/** Plain text only: no link (the email carries one button to the app's home), no other placeholder than {{nom}}. */
export function validateText(raw: any): Text {
    const out = {} as Text;
    for (const k of Object.keys(LIMITS) as (keyof Text)[]) {
        const v = typeof raw?.[k] === 'string' ? raw[k].replace(/\r\n/g, '\n').trim() : '';
        if (!v) throw new DormancyActionError(`${FIELD_FR[k]} est vide.`);
        if (v.length > LIMITS[k]) throw new DormancyActionError(`${FIELD_FR[k]} dépasse ${LIMITS[k]} caractères.`);
        if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|me|ly|io|app)\b)/i.test(v)) {
            throw new DormancyActionError(`${FIELD_FR[k]} ne doit contenir aucun lien : l’e-mail porte déjà un seul bouton vers l’application.`);
        }
        if (/\{\{(?!\s*nom\s*\}\})/i.test(v)) throw new DormancyActionError(`${FIELD_FR[k]} : seul {{nom}} peut être remplacé.`);
        out[k] = v;
    }
    return out;
}

const TEXT_ID = 'reactivation';
const sameText = (a: any, b: any) => !!a && !!b && (Object.keys(LIMITS) as (keyof Text)[]).every(k => a[k] === b[k]);

export async function getReactivationText() {
    const doc: any = await DormancyReactivationTextModel.findById(TEXT_ID).lean();
    const draft = doc?.draft ?? { ...DEFAULT_TEXT, updatedBy: null, updatedAt: null };
    const approved = doc?.approved ?? null;
    return { draft, approved, draftApproved: sameText(draft, approved), isDefault: !doc?.draft };
}

export async function saveReactivationDraft(raw: any, adminId: string) {
    const text = validateText(raw);
    await DormancyReactivationTextModel.updateOne({ _id: TEXT_ID }, { $set: { draft: { ...text, updatedBy: adminId, updatedAt: new Date() } } }, { upsert: true });
    log.info(`Reactivation draft saved by admin ${adminId}`);
    return getReactivationText();
}

/** The current draft becomes the approved version (validated again; the version number goes up). */
export async function approveReactivationText(adminId: string) {
    const { draft, approved } = await getReactivationText();
    const text = validateText(draft);
    const version = (approved?.version ?? 0) + 1;
    await DormancyReactivationTextModel.updateOne(
        { _id: TEXT_ID },
        { $set: { draft: { ...text, updatedBy: draft.updatedBy ?? adminId, updatedAt: draft.updatedAt ?? new Date() }, approved: { ...text, version, approvedBy: adminId, approvedAt: new Date() } } },
        { upsert: true },
    );
    log.warn(`Reactivation text version ${version} approved by admin ${adminId}`);
    return getReactivationText();
}

// ---------------------------------------------------------------- audience

export interface SendMode { mode: 'live' | 'allowlist'; allow: Set<string> }
export function sendMode(): SendMode {
    const mode = String(process.env.REACTIVATION_SEND_MODE || '').toLowerCase() === 'live' ? 'live' : 'allowlist';
    const allow = new Set(String(process.env.REACTIVATION_TEST_RECIPIENTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    return { mode, allow };
}
const allowed = (m: SendMode, u: { _id: any; email?: string | null }) =>
    m.mode === 'live' || m.allow.has(String(u._id).toLowerCase()) || (!!u.email && m.allow.has(String(u.email).trim().toLowerCase()));

export type ExcludeReason = 'inactive' | 'frozen' | 'fraud' | 'recent_contact' | 'unreachable' | 'test_mode' | 'returned' | 'cancelled' | 'send_failed';

/** Why a member cannot be sent anything now, from their own document (null = fine). */
function blockOf(u: any): ExcludeReason | null {
    if (!u || u.deleted || u.blocked) return 'inactive';
    if (u.frozen?.at) return 'frozen';
    if (u.dormancy?.fraudFlag) return 'fraud';
    if (!DORMANT_SET.includes(u.dormancy?.status)) return 'returned';
    return null;
}

const AUDIENCE_FIELDS = '_id email name deleted blocked frozen dormancy.status dormancy.fraudFlag';

export interface Audience {
    matched: number;
    eligible: { _id: Types.ObjectId }[];
    excluded: Partial<Record<ExcludeReason, number>>;
    reachKnown: boolean;
    withEmail: number;
    withPush: number;
    mode: SendMode['mode'];
    capped: boolean;
}

/** Who a campaign with these filters would reach right now, and who it leaves out and why. */
export async function selectAudience(f: DormantFilters, now: Date = new Date()): Promise<Audience> {
    const match = await matchFor(f, now);
    const docs: any[] = await UserModel.find(match).select(AUDIENCE_FIELDS).sort({ 'dormancy.heldXaf': -1, _id: -1 }).limit(MAX_AUDIENCE + 1).lean();
    const capped = docs.length > MAX_AUDIENCE;
    const users = docs.slice(0, MAX_AUDIENCE);
    const excluded: Partial<Record<ExcludeReason, number>> = {};
    const out = (r: ExcludeReason) => { excluded[r] = (excluded[r] ?? 0) + 1; };
    const m = sendMode();

    let pool = users.filter(u => { const b = blockOf(u); if (b) out(b); return !b; });
    const cutoff = new Date(now.getTime() - MIN_DAYS() * DAY_MS);
    const recent = new Set<string>();
    for (let i = 0; i < pool.length; i += 5000) {
        const rows = await DormancyContactModel.find({ _id: { $in: pool.slice(i, i + 5000).map(u => u._id) }, lastAt: { $gte: cutoff } }).select('_id').lean();
        rows.forEach(r => recent.add(String(r._id)));
    }
    pool = pool.filter(u => { if (recent.has(String(u._id))) { out('recent_contact'); return false; } return true; });

    let reachKnown = true; let withEmail = 0; let withPush = 0;
    const kept: any[] = [];
    for (let i = 0; i < pool.length; i += 1000) {
        const chunk = pool.slice(i, i + 1000);
        const reach = await notificationService.reactivationReach(chunk.map(u => u.email).filter(Boolean), chunk.map(u => String(u._id)));
        if (!reach) { reachKnown = false; kept.push(...chunk); continue; }
        const suppressed = new Set(reach.suppressedEmails.map(e => e.toLowerCase()));
        const push = new Set(reach.pushReachable);
        for (const u of chunk) {
            const email = typeof u.email === 'string' && u.email.includes('@') && !suppressed.has(u.email.trim().toLowerCase());
            const p = push.has(String(u._id));
            if (!email && !p) { out('unreachable'); continue; }
            if (email) withEmail += 1;
            if (p) withPush += 1;
            kept.push(u);
        }
    }
    const eligible = kept.filter(u => { if (!allowed(m, u)) { out('test_mode'); return false; } return true; });
    return { matched: users.length, eligible: eligible.map(u => ({ _id: u._id })), excluded, reachKnown, withEmail, withPush, mode: m.mode, capped };
}

export async function previewCampaign(f: DormantFilters) {
    const a = await selectAudience(f);
    const { approved } = await getReactivationText();
    return {
        matched: a.matched, sendable: a.eligible.length, excluded: a.excluded, reachKnown: a.reachKnown,
        withEmail: a.withEmail, withPush: a.withPush, mode: a.mode, capped: a.capped, minDays: MIN_DAYS(),
        approvedVersion: approved?.version ?? null,
    };
}

// ---------------------------------------------------------------- campaigns

export async function createCampaign(f: DormantFilters, adminId: string) {
    const { approved } = await getReactivationText();
    if (!approved) throw new DormancyActionError('Aucun texte approuvé : faites approuver le message avant d’envoyer.', 409);
    if (await DormancyCampaignModel.exists({ status: { $in: ['building', 'sending'] } })) {
        throw new DormancyActionError('Une campagne de réactivation est déjà en cours : attendez qu’elle finisse ou annulez-la.', 409);
    }
    const text = { subject: approved.subject, body: approved.body, pushTitle: approved.pushTitle, pushBody: approved.pushBody, version: approved.version, approvedBy: approved.approvedBy, approvedAt: approved.approvedAt };
    const c = await DormancyCampaignModel.create({ status: 'building', filters: f, text, mode: sendMode().mode, createdBy: adminId });
    log.warn(`Reactivation campaign ${c._id} started by admin ${adminId} (text v${approved.version}, mode ${c.mode})`);
    void buildCampaign(String(c._id));
    return { id: String(c._id), status: c.status, mode: c.mode };
}

const building = new Set<string>();

export async function buildCampaign(id: string): Promise<void> {
    if (building.has(id)) return;
    building.add(id);
    try {
        const c: any = await DormancyCampaignModel.findById(id).lean();
        if (!c || c.status !== 'building') return;
        const a = await selectAudience(c.filters ?? {});
        const cid = new Types.ObjectId(id);
        for (let i = 0; i < a.eligible.length; i += 1000) {
            const rows = a.eligible.slice(i, i + 1000).map(u => ({ campaignId: cid, userId: u._id, status: 'pending', nextAt: new Date() }));
            await DormancyCampaignTargetModel.insertMany(rows, { ordered: false }).catch((e: any) => { if (e?.code !== 11000 && !e?.writeErrors) throw e; });
        }
        const targets = await DormancyCampaignTargetModel.countDocuments({ campaignId: cid });
        const r = await DormancyCampaignModel.updateOne({ _id: cid, status: 'building' }, {
            $set: { status: targets ? 'sending' : 'done', builtAt: new Date(), 'counts.targets': targets, excluded: a.excluded, ...(targets ? {} : { finishedAt: new Date() }) },
        });
        if (r.modifiedCount !== 1) {
            // Another build of the same campaign finished first (fine), or it was cancelled meanwhile.
            const now: any = await DormancyCampaignModel.findById(cid).select('status').lean();
            if (now?.status === 'cancelled') await DormancyCampaignTargetModel.updateMany({ campaignId: cid, status: 'pending' }, { $set: { status: 'skipped', reason: 'cancelled' } });
            return;
        }
        log.info(`Reactivation campaign ${id} built: ${targets} member(s), excluded ${JSON.stringify(a.excluded)}`);
    } catch (err: any) {
        log.error(`Reactivation campaign ${id} build failed: ${err?.message ?? err}`);
        await DormancyCampaignModel.updateOne({ _id: id, status: 'building' }, { $set: { status: 'failed', error: String(err?.message ?? err).slice(0, 300), finishedAt: new Date() } });
    } finally {
        building.delete(id);
    }
}

/** Campaigns stuck in `building` (a restart mid-build) are built again: rows are unique per member. */
export async function resumeBuilding(): Promise<void> {
    const stuck: any[] = await DormancyCampaignModel.find({ status: 'building' }).select('_id').lean();
    for (const c of stuck) await buildCampaign(String(c._id));
}

export async function cancelCampaign(id: string, adminId: string) {
    if (!Types.ObjectId.isValid(id)) throw new DormancyActionError('Campagne introuvable', 404);
    const cid = new Types.ObjectId(id);
    const r = await DormancyCampaignModel.updateOne({ _id: cid, status: { $in: ['building', 'sending'] } }, { $set: { status: 'cancelled', cancelledBy: adminId, finishedAt: new Date() } });
    if (r.modifiedCount !== 1) throw new DormancyActionError('Cette campagne n’est plus en cours.', 409);
    const pending: any[] = await DormancyCampaignTargetModel.find({ campaignId: cid, status: 'pending' }).select('userId').lean();
    const ids = pending.map(p => p.userId);
    await DormancyCampaignTargetModel.updateMany({ campaignId: cid, status: 'pending' }, { $set: { status: 'skipped', reason: 'cancelled' } });
    // A member claimed for this campaign but never sent anything gets their 30 days back.
    for (let i = 0; i < ids.length; i += 5000) await DormancyContactModel.deleteMany({ _id: { $in: ids.slice(i, i + 5000) }, campaignId: cid });
    await DormancyCampaignModel.updateOne({ _id: cid }, { $inc: { 'counts.skipped': ids.length, 'excluded.cancelled': ids.length } });
    log.warn(`Reactivation campaign ${id} cancelled by admin ${adminId} (${ids.length} not sent)`);
    return { cancelled: true, notSent: ids.length };
}

export async function listCampaigns(limit = 20) {
    const rows: any[] = await DormancyCampaignModel.find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).lean();
    const ids = rows.filter(r => r.status === 'sending').map(r => r._id);
    const pending = ids.length
        ? await DormancyCampaignTargetModel.aggregate([{ $match: { campaignId: { $in: ids }, status: 'pending' } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }])
        : [];
    const left = new Map(pending.map((p: any) => [String(p._id), p.n]));
    return rows.map(r => ({
        id: String(r._id), status: r.status, mode: r.mode, filters: r.filters, textVersion: r.text?.version ?? null,
        createdBy: r.createdBy, createdAt: r.createdAt, builtAt: r.builtAt, finishedAt: r.finishedAt, waitUntil: r.waitUntil ?? null,
        counts: r.counts, excluded: r.excluded ?? {}, pending: left.get(String(r._id)) ?? 0, error: r.error ?? null,
    }));
}

// ---------------------------------------------------------------- sending

const releaseContact = (userId: Types.ObjectId, cid: Types.ObjectId) => DormancyContactModel.deleteOne({ _id: userId, campaignId: cid });

/** One conditional upsert: free (never, or older than the window) or already this campaign's. False = contacted recently. */
export async function claimContact(userId: Types.ObjectId, cid: Types.ObjectId, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - MIN_DAYS() * DAY_MS);
    try {
        await DormancyContactModel.updateOne(
            { _id: userId, $or: [{ lastAt: { $lt: cutoff } }, { campaignId: cid }] },
            { $set: { lastAt: now, campaignId: cid } },
            { upsert: true },
        );
        return true;
    } catch (err: any) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

async function skip(t: any, reason: ExcludeReason) {
    const r = await DormancyCampaignTargetModel.updateOne({ _id: t._id, status: 'pending' }, { $set: { status: 'skipped', reason } });
    if (r.modifiedCount) await DormancyCampaignModel.updateOne({ _id: t.campaignId }, { $inc: { 'counts.skipped': 1, [`excluded.${reason}`]: 1 } });
}

let running = false;

/** Every minute: works through pending members of the running campaign(s) until the mail budget says wait. */
export async function runCampaignSender(now: Date = new Date()): Promise<{ processed: number }> {
    if (running) return { processed: 0 };
    running = true;
    let processed = 0;
    try {
        const campaigns: any[] = await DormancyCampaignModel.find({ status: 'sending', $or: [{ waitUntil: null }, { waitUntil: { $exists: false } }, { waitUntil: { $lte: now } }] }).sort({ createdAt: 1 }).lean();
        for (const c of campaigns) {
            const cid = c._id as Types.ObjectId;
            const mode = sendMode();
            let stop = false;
            while (!stop && processed < SEND_BATCH) {
                // Lease one member (5 min); a crash leaves it to be picked up again.
                const t: any = await DormancyCampaignTargetModel.findOneAndUpdate(
                    { campaignId: cid, status: 'pending', nextAt: { $lte: now } },
                    { $set: { nextAt: new Date(now.getTime() + 5 * 60_000) }, $inc: { attempts: 1 } },
                    { new: true, sort: { nextAt: 1 } },
                ).lean();
                if (!t) break;
                processed += 1;
                const fresh: any = await DormancyCampaignModel.findById(cid).select('status').lean();
                if (fresh?.status !== 'sending') { stop = true; break; }

                const u: any = await UserModel.findById(t.userId).select(AUDIENCE_FIELDS).lean();
                const block = blockOf(u);
                if (block) { await skip(t, block); continue; }
                if (!allowed(mode, u)) { await skip(t, 'test_mode'); continue; }
                if (!(await claimContact(t.userId, cid, now))) { await skip(t, 'recent_contact'); continue; }

                let res;
                try {
                    res = await notificationService.sendReactivation({
                        campaignId: String(cid), userId: String(t.userId), email: u.email ?? null, name: u.name ?? null,
                        subject: c.text.subject, body: c.text.body, pushTitle: c.text.pushTitle, pushBody: c.text.pushBody,
                    });
                } catch (err: any) {
                    log.warn(`Reactivation ${cid} → ${t.userId}: notification-service failed (${err?.message ?? err}), attempt ${t.attempts}`);
                    if (t.attempts >= MAX_ATTEMPTS) {
                        await DormancyCampaignTargetModel.updateOne({ _id: t._id, status: 'pending' }, { $set: { status: 'failed', reason: 'send_failed' } });
                        await DormancyCampaignModel.updateOne({ _id: cid }, { $inc: { 'counts.failed': 1 } });
                        await releaseContact(t.userId, cid);
                    } else {
                        await DormancyCampaignTargetModel.updateOne({ _id: t._id }, { $set: { nextAt: new Date(now.getTime() + t.attempts * 5 * 60_000) } });
                    }
                    stop = true; // the service is unwell: try again next minute
                    break;
                }
                if (res.status === 'deferred') {
                    const until = res.retryAt ? new Date(res.retryAt) : new Date(now.getTime() + 60_000);
                    await DormancyCampaignTargetModel.updateOne({ _id: t._id }, { $set: { nextAt: until }, $inc: { attempts: -1 } });
                    await DormancyCampaignModel.updateOne({ _id: cid }, { $set: { waitUntil: until } });
                    stop = true;
                    break;
                }
                const emailSent = res.email === 'sent';
                const pushSent = res.push === 'sent' || res.push === 'deferred';
                if (emailSent || pushSent) {
                    await DormancyCampaignTargetModel.updateOne({ _id: t._id, status: 'pending' }, { $set: { status: 'sent', sentAt: now, email: res.email ?? null, push: res.push ?? null } });
                    await DormancyCampaignModel.updateOne({ _id: cid }, { $inc: { 'counts.sent': 1, 'counts.emailSent': emailSent ? 1 : 0, 'counts.pushSent': pushSent ? 1 : 0 } });
                } else {
                    const failed = res.email === 'failed';
                    await DormancyCampaignTargetModel.updateOne({ _id: t._id, status: 'pending' }, { $set: { status: failed ? 'failed' : 'skipped', reason: failed ? 'send_failed' : 'unreachable', email: res.email ?? null, push: res.push ?? null } });
                    await DormancyCampaignModel.updateOne({ _id: cid }, { $inc: failed ? { 'counts.failed': 1 } : { 'counts.skipped': 1, 'excluded.unreachable': 1 } });
                    await releaseContact(t.userId, cid);
                }
            }
            if (!stop) await finishIfDone(cid);
            if (processed >= SEND_BATCH) break;
        }
    } catch (err: any) {
        log.error(`Reactivation sender failed: ${err?.message ?? err}`);
    } finally {
        running = false;
    }
    return { processed };
}

async function finishIfDone(cid: Types.ObjectId) {
    if (await DormancyCampaignTargetModel.exists({ campaignId: cid, status: 'pending' })) {
        await DormancyCampaignModel.updateOne({ _id: cid }, { $set: { waitUntil: null } });
        return;
    }
    const r = await DormancyCampaignModel.updateOne({ _id: cid, status: 'sending' }, { $set: { status: 'done', finishedAt: new Date(), waitUntil: null } });
    if (r.modifiedCount) log.info(`Reactivation campaign ${cid} finished`);
}

/** A sign-in within 30 days of a réactivation counts as a return for that campaign (called from noteSignIn). */
export async function noteCampaignReturn(userId: string, now: Date = new Date()): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    const since = new Date(now.getTime() - MIN_DAYS() * DAY_MS);
    const rows: any[] = await DormancyCampaignTargetModel.find({ userId: new Types.ObjectId(userId), status: 'sent', returnedAt: null, sentAt: { $gte: since, $lte: now } }).select('_id campaignId').lean();
    for (const r of rows) {
        const u = await DormancyCampaignTargetModel.updateOne({ _id: r._id, returnedAt: null }, { $set: { returnedAt: now } });
        if (u.modifiedCount) await DormancyCampaignModel.updateOne({ _id: r.campaignId }, { $inc: { 'counts.returned': 1 } });
    }
}
