import { Types } from 'mongoose';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';
import { notifyUser } from '../../services/clients/notification.service.client';
import { CandidateProfile, IImpactCandidate, IImpactEdition, ImpactAudit, ImpactCandidate } from './models';
import {
    CandidateStatus, EditionSettings, ProfileField, TicketTier,
} from './types';

const log = logger.getLogger('Impact');

export interface Actor { userId?: string; role: 'admin' | 'member' | 'system' }
export const SYSTEM: Actor = { role: 'system' };

const oid = (v?: string | Types.ObjectId | null) =>
    v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : undefined;

/**
 * Appends one audit line after the change it records. A failed write is logged
 * loudly but never undoes the change.
 */
export const audit = async (args: {
    actor: Actor;
    action: string;
    editionId?: string | Types.ObjectId;
    candidateId?: string | Types.ObjectId;
    before?: unknown;
    after?: unknown;
    reason?: string;
}) => {
    try {
        await ImpactAudit.create({
            editionId: oid(args.editionId),
            candidateId: oid(args.candidateId),
            actorUserId: oid(args.actor.userId) ?? null,
            actorRole: args.actor.role,
            action: args.action,
            before: args.before,
            after: args.after,
            reason: args.reason,
            at: new Date(),
        });
    } catch (err) {
        log.error(`AUDIT WRITE FAILED ${args.action} ${args.candidateId ?? args.editionId}: ${(err as Error).message}`);
    }
};

/**
 * Moves a candidate from one of `from` to `to` in ONE conditional write, so two
 * concurrent actions can never both apply (the loser gets null). `set` lands in
 * the same write.
 */
export const transitionCandidate = async (
    candidateId: Types.ObjectId | string,
    from: CandidateStatus[],
    to: CandidateStatus,
    opts: { by?: string; reason?: string; set?: Record<string, unknown>; unset?: string[] } = {},
): Promise<IImpactCandidate | null> => {
    const current = await ImpactCandidate.findOne({ _id: candidateId, status: { $in: from } }).select('status').lean();
    if (!current) return null;
    const update: Record<string, unknown> = {
        $set: { status: to, ...(opts.set ?? {}) },
        $push: { statusHistory: { from: current.status, to, at: new Date(), by: oid(opts.by), reason: opts.reason } },
    };
    if (opts.unset?.length) update.$unset = Object.fromEntries(opts.unset.map((k) => [k, 1]));
    return ImpactCandidate.findOneAndUpdate(
        { _id: candidateId, status: current.status },
        update,
        { new: true },
    );
};

// ---------- Notifications (spec §16) ----------

export const CANDIDATE_URL = '/impact-challenge/candidat';

/**
 * Push + e-mail to one candidate. Best effort: never throws. Only a handful
 * of people get each message, so e-mail fits within the mail server's budget.
 */
export const notifyCandidate = async (c: Pick<IImpactCandidate, 'userId' | '_id'>, kind: string, subject: string, body: string) => {
    try {
        await notifyUser({
            kind,
            userId: String(c.userId),
            channels: ['push', 'email'],
            subject,
            body,
            pushTag: `${kind}-${c._id}`,
        });
    } catch (err) {
        log.warn(`${kind} to ${c.userId} failed: ${(err as Error).message}`);
    }
};

// ---------- Validation ----------

const text = (v: unknown, field: string, min: number, max: number): string => {
    const s = typeof v === 'string' ? v.trim().replace(/\s+\n/g, '\n') : '';
    if (s.length < min) throw new AppError(min <= 1 ? `« ${field} » est obligatoire.` : `« ${field} » : au moins ${min} caractères.`, 400, true, 'INVALID_PROFILE', { field });
    if (s.length > max) throw new AppError(`« ${field} » : ${max} caractères au maximum.`, 400, true, 'INVALID_PROFILE', { field });
    return s;
};

/** An R2 key handed back by settings-service's upload (never a URL). */
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-./]{2,299}$/;

const link = (v: unknown): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).trim();
    let u: URL;
    try { u = new URL(s); } catch { throw new AppError('Le lien doit être une adresse web complète (https://…).', 400, true, 'INVALID_PROFILE', { field: 'link' }); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new AppError('Le lien doit commencer par https://.', 400, true, 'INVALID_PROFILE', { field: 'link' });
    if (s.length > 300) throw new AppError('Le lien est trop long.', 400, true, 'INVALID_PROFILE', { field: 'link' });
    return u.toString();
};

/**
 * The candidate profile (spec §3.1), checked field by field. `partial` keeps
 * the current value for any field not sent (profile edits).
 */
export const parseProfile = (
    body: Record<string, any>,
    settings: EditionSettings,
    current?: CandidateProfile,
): CandidateProfile => {
    const pick = (k: keyof CandidateProfile) => (body[k] !== undefined ? body[k] : current?.[k]);
    const photoFileId = String(pick('photoFileId') ?? '').trim();
    if (!FILE_ID.test(photoFileId) || photoFileId.includes('..')) {
        throw new AppError('Ajoutez une photo.', 400, true, 'INVALID_PROFILE', { field: 'photoFileId' });
    }
    const category = text(pick('category'), 'Catégorie', 1, 60);
    if (settings.categories.length && !settings.categories.includes(category)) {
        throw new AppError('Choisissez une catégorie de la liste.', 400, true, 'INVALID_PROFILE', { field: 'category' });
    }
    const extraIn = { ...(current?.extra ?? {}), ...((body.extra && typeof body.extra === 'object') ? body.extra : {}) };
    const extra: Record<string, string> = {};
    for (const f of settings.profileFields as ProfileField[]) {
        const raw = extraIn[f.key];
        if (raw === undefined || raw === null || String(raw).trim() === '') {
            if (f.required) throw new AppError(`« ${f.label} » est obligatoire.`, 400, true, 'INVALID_PROFILE', { field: `extra.${f.key}` });
            continue;
        }
        extra[f.key] = text(raw, f.label, 1, f.maxLength);
    }
    return {
        name: text(pick('name'), 'Nom et prénom', 2, 80),
        photoFileId,
        country: text(pick('country'), 'Pays', 2, 60),
        city: text(pick('city'), 'Ville', 2, 80),
        activity: text(pick('activity'), 'Activité professionnelle', 2, 120),
        category,
        projectName: text(pick('projectName'), 'Nom du projet', 2, 120),
        projectDescription: text(pick('projectDescription'), 'Description du projet', 20, 1500),
        presentation: text(pick('presentation'), 'Présentation du projet', 50, 4000),
        link: link(pick('link')),
        extra,
    };
};

const int = (v: unknown, field: string, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new AppError(`${field} : un nombre entier entre ${min} et ${max}.`, 400, true, 'INVALID_SETTINGS', { field });
    }
    return n;
};

const slugKey = (v: unknown, field: string) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(s)) throw new AppError(`${field} : lettres, chiffres, - ou _ (40 au plus).`, 400, true, 'INVALID_SETTINGS', { field });
    return s;
};

/** Checks a full settings object (spec §19 parameters). */
export const validateSettings = (s: EditionSettings): EditionSettings => {
    const maxCandidates = int(s.maxCandidates, 'Nombre de candidats', 2, 200);
    const out: EditionSettings = {
        maxCandidates,
        invitationsRequired: int(s.invitationsRequired, 'Invitations requises', 1, 200),
        waitlistSize: int(s.waitlistSize, 'Liste d’attente', 0, 50),
        finalistsCount: int(s.finalistsCount, 'Nombre de finalistes', 1, maxCandidates),
        votePrice: int(s.votePrice, 'Prix d’un vote', 50, 100000),
        votePacks: [],
        weights: {
            paidVotes: int(s.weights?.paidVotes, 'Pondération votes payants', 0, 100),
            publicVote: int(s.weights?.publicVote, 'Pondération vote public', 0, 100),
            jury: int(s.weights?.jury, 'Pondération jury', 0, 100),
        },
        juryCriteria: [],
        ticketTiers: [],
        prizes: [],
        prizeCooldownDays: int(s.prizeCooldownDays, 'Délai entre deux gains du même lot', 0, 3650),
        showcaseMonths: int(s.showcaseMonths, 'Durée SBC Impact', 12, 120),
        categories: [],
        profileFields: [],
    };
    const w = out.weights;
    if (w.paidVotes + w.publicVote + w.jury !== 100) {
        throw new AppError('La pondération finale doit faire 100 % au total.', 400, true, 'INVALID_SETTINGS', { field: 'weights' });
    }
    // Every mobile-money provider we use takes multiples of 5.
    if (out.votePrice % 5 !== 0) throw new AppError('Le prix d’un vote doit être un multiple de 5 F.', 400, true, 'INVALID_SETTINGS', { field: 'votePrice' });

    const packs = Array.isArray(s.votePacks) ? s.votePacks : [];
    if (packs.length < 1 || packs.length > 6) throw new AppError('Entre 1 et 6 packs de votes.', 400, true, 'INVALID_SETTINGS', { field: 'votePacks' });
    for (const p of packs) {
        const votes = int(p.votes, 'Votes du pack', 1, 10000);
        const price = int(p.price, 'Prix du pack', 50, 10_000_000);
        if (price % 5 !== 0) throw new AppError('Le prix d’un pack doit être un multiple de 5 F.', 400, true, 'INVALID_SETTINGS', { field: 'votePacks' });
        out.votePacks.push({ votes, price });
    }

    const criteria = Array.isArray(s.juryCriteria) ? s.juryCriteria : [];
    if (criteria.length < 1 || criteria.length > 10) throw new AppError('Entre 1 et 10 critères du jury.', 400, true, 'INVALID_SETTINGS', { field: 'juryCriteria' });
    for (const c of criteria) {
        out.juryCriteria.push({ key: slugKey(c.key, 'Clé du critère'), label: text(c.label, 'Critère', 2, 60), max: int(c.max, 'Note maximale', 1, 100) });
    }

    const tiers = Array.isArray(s.ticketTiers) ? s.ticketTiers : [];
    if (tiers.length < 1 || tiers.length > 6) throw new AppError('Entre 1 et 6 paliers de tickets.', 400, true, 'INVALID_SETTINGS', { field: 'ticketTiers' });
    let prev = 0;
    tiers.forEach((t: TicketTier, i: number) => {
        const last = i === tiers.length - 1;
        const upTo = last ? null : int(t.upTo, 'Palier de tickets', prev + 1, 100000);
        if (!last && t.upTo === null) throw new AppError('Seul le dernier palier est sans limite.', 400, true, 'INVALID_SETTINGS', { field: 'ticketTiers' });
        const weight = Number(t.weight);
        if (!(weight > 0 && weight <= 1)) throw new AppError('Le poids d’un ticket est entre 0 et 1.', 400, true, 'INVALID_SETTINGS', { field: 'ticketTiers' });
        out.ticketTiers.push({ upTo, weight });
        prev = upTo ?? prev;
    });

    const prizes = Array.isArray(s.prizes) ? s.prizes : [];
    if (prizes.length < 1 || prizes.length > 10) throw new AppError('Entre 1 et 10 lots.', 400, true, 'INVALID_SETTINGS', { field: 'prizes' });
    for (const p of prizes) {
        out.prizes.push({ key: slugKey(p.key, 'Clé du lot'), label: text(p.label, 'Lot', 2, 80), category: slugKey(p.category, 'Catégorie du lot') });
    }
    if (new Set(out.prizes.map((p) => p.key)).size !== out.prizes.length) {
        throw new AppError('Deux lots ont la même clé.', 400, true, 'INVALID_SETTINGS', { field: 'prizes' });
    }

    const cats = Array.isArray(s.categories) ? s.categories : [];
    if (cats.length > 40) throw new AppError('40 catégories au plus.', 400, true, 'INVALID_SETTINGS', { field: 'categories' });
    out.categories = [...new Set(cats.map((c) => text(c, 'Catégorie', 2, 60)))];

    const fields = Array.isArray(s.profileFields) ? s.profileFields : [];
    if (fields.length > 10) throw new AppError('10 questions supplémentaires au plus.', 400, true, 'INVALID_SETTINGS', { field: 'profileFields' });
    for (const f of fields) {
        out.profileFields.push({
            key: slugKey(f.key, 'Clé de la question'),
            label: text(f.label, 'Question', 2, 120),
            required: Boolean(f.required),
            maxLength: int(f.maxLength ?? 500, 'Longueur maximale', 10, 4000),
        });
    }
    return out;
};

/** Public view of an edition (no internal counters or cursors). */
export const publicEdition = (e: IImpactEdition, seatsTaken: number) => ({
    _id: String(e._id),
    name: e.name,
    slug: e.slug,
    description: e.description,
    rulesText: e.rulesText,
    status: e.status,
    schedule: e.schedule,
    registrationOpen: isRegistrationOpen(e),
    registrationClosedReason: e.registrationClosedReason ?? null,
    seats: { taken: seatsTaken, max: e.settings.maxCandidates },
    settings: {
        maxCandidates: e.settings.maxCandidates,
        invitationsRequired: e.settings.invitationsRequired,
        waitlistSize: e.settings.waitlistSize,
        finalistsCount: e.settings.finalistsCount,
        votePrice: e.settings.votePrice,
        votePacks: e.settings.votePacks,
        weights: e.settings.weights,
        juryCriteria: e.settings.juryCriteria,
        ticketTiers: e.settings.ticketTiers,
        prizes: e.settings.prizes.map((p) => ({ key: p.key, label: p.label })),
        prizeCooldownDays: e.settings.prizeCooldownDays,
        showcaseMonths: e.settings.showcaseMonths,
        categories: e.settings.categories,
        profileFields: e.settings.profileFields,
    },
});

/** New profiles are accepted: qualification running, inside its dates, seats left. */
export const isRegistrationOpen = (e: IImpactEdition, now = new Date()) =>
    e.status === 'QUALIFICATION'
    && !e.registrationClosedAt
    && now >= e.schedule.qualificationOpensAt
    && now <= e.schedule.qualificationClosesAt;
