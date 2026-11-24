import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import { IImpactEdition, ImpactCandidate, ImpactEdition } from '../models';
import {
    CandidateStatus, COMPETITION_LOCKED, DEFAULT_SETTINGS, EditionSettings, EditionStatus, editionRank,
    LIVE_EDITION_STATUSES, QUALIFICATION_LOCKED, SEAT_LOST_STATUSES,
} from '../types';
import { Actor, audit, notifyCandidate, publicEdition, validateSettings } from '../lib';
import { seatHolders } from './qualification.service';

type ScheduleKey = 'qualificationOpensAt' | 'qualificationClosesAt' | 'competitionStartsAt' | 'finalAt';
const SCHEDULE_LABEL: Record<ScheduleKey, string> = {
    qualificationOpensAt: 'ouverture de la qualification',
    qualificationClosesAt: 'fin de la qualification',
    competitionStartsAt: 'début de la compétition',
    finalAt: 'finale',
};
/** A date; the error names the field as `schedule.<key>`, like RULES_LOCKED does. */
const date = (v: unknown, key: ScheduleKey): Date => {
    const d = new Date(String(v));
    if (v === undefined || v === null || v === '' || Number.isNaN(d.getTime())) {
        throw new AppError(`Date invalide : ${SCHEDULE_LABEL[key]}.`, 400, true, 'INVALID_SCHEDULE', { field: `schedule.${key}` });
    }
    return d;
};
const optDate = (v: unknown, key: ScheduleKey) => (v === undefined || v === null || v === '' ? undefined : date(v, key));

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'edition';

const checkSchedule = (s: IImpactEdition['schedule']) => {
    if (s.qualificationOpensAt >= s.qualificationClosesAt) {
        throw new AppError('La qualification doit se terminer après son ouverture.', 400, true, 'INVALID_SCHEDULE', { field: 'schedule.qualificationClosesAt' });
    }
    if (s.competitionStartsAt && s.competitionStartsAt < s.qualificationClosesAt) {
        throw new AppError('La compétition commence après la qualification.', 400, true, 'INVALID_SCHEDULE', { field: 'schedule.competitionStartsAt' });
    }
    if (s.finalAt && s.competitionStartsAt && s.finalAt < s.competitionStartsAt) {
        throw new AppError('La finale a lieu après le début de la compétition.', 400, true, 'INVALID_SCHEDULE', { field: 'schedule.finalAt' });
    }
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Reads ----------

let currentCache: { at: number; value: ReturnType<typeof publicEdition> | null } | null = null;
const CURRENT_TTL_MS = 15_000;
export const invalidateCurrent = () => { currentCache = null; };

/** The edition members see now (qualification → final), or null. */
export const currentEdition = async (): Promise<IImpactEdition | null> =>
    ImpactEdition.findOne({ status: { $in: LIVE_EDITION_STATUSES } }).sort({ 'schedule.qualificationOpensAt': -1 });

/** Public summary of the current edition, cached 15 s (the most-read call). */
export const currentPublic = async () => {
    if (currentCache && Date.now() - currentCache.at < CURRENT_TTL_MS) return currentCache.value;
    const e = await currentEdition();
    const value = e ? publicEdition(e, await seatHolders(e._id)) : null;
    currentCache = { at: Date.now(), value };
    return value;
};

/** What the administration sees of an edition: everything but the job's internal cursors. */
export const adminEdition = (e: IImpactEdition | Record<string, any>, seatsTaken?: number) => {
    const o: Record<string, any> = typeof (e as any).toObject === 'function' ? (e as any).toObject() : { ...e };
    delete o.pollCursor;
    delete o.lastFullRecountAt;
    delete o.__v;
    if (seatsTaken !== undefined) o.seatsTaken = seatsTaken;
    return o;
};

/** Newest first, with each edition's seats taken. */
export const listEditions = async () => {
    const list = await ImpactEdition.find().sort({ createdAt: -1 }).limit(100).lean();
    const taken = await ImpactCandidate.aggregate([
        { $match: { editionId: { $in: list.map((e) => e._id) }, seatNumber: { $exists: true }, status: { $nin: SEAT_LOST_STATUSES } } },
        { $group: { _id: '$editionId', n: { $sum: 1 } } },
    ]);
    const byId = new Map(taken.map((t) => [String(t._id), t.n as number]));
    return list.map((e) => adminEdition(e, byId.get(String(e._id)) ?? 0));
};

export const getEdition = async (id: string) => {
    if (!Types.ObjectId.isValid(id)) throw new AppError('Édition introuvable.', 404);
    const e = await ImpactEdition.findById(id);
    if (!e) throw new AppError('Édition introuvable.', 404);
    return e;
};

// ---------- Writes ----------

export const createEdition = async (actor: Actor, body: Record<string, any>) => {
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 120) throw new AppError('Nom de l’édition : 3 à 120 caractères.', 400, true, 'INVALID_EDITION', { field: 'name' });
    const schedule = {
        qualificationOpensAt: date(body.schedule?.qualificationOpensAt, 'qualificationOpensAt'),
        qualificationClosesAt: date(body.schedule?.qualificationClosesAt, 'qualificationClosesAt'),
        competitionStartsAt: optDate(body.schedule?.competitionStartsAt, 'competitionStartsAt'),
        finalAt: optDate(body.schedule?.finalAt, 'finalAt'),
    };
    checkSchedule(schedule);
    const settings = validateSettings({ ...DEFAULT_SETTINGS, ...(body.settings ?? {}) } as EditionSettings);
    let slug = slugify(String(body.slug || name));
    if (await ImpactEdition.exists({ slug })) slug = `${slug}-${Date.now().toString(36)}`;
    const e = await ImpactEdition.create({
        name, slug,
        description: String(body.description ?? '').slice(0, 4000),
        rulesText: String(body.rulesText ?? '').slice(0, 30000),
        schedule, settings,
        createdBy: new Types.ObjectId(actor.userId),
    });
    await audit({ actor, action: 'edition.created', editionId: e._id, after: { name, schedule, settings } });
    return e;
};

/**
 * Edits an edition. Locked parts (spec §12, §18) are refused with the list of
 * fields: the public rules and the qualification rules once qualification is
 * open, the competition rules once it has started. Prizes stay editable.
 */
export const updateEdition = async (actor: Actor, id: string, body: Record<string, any>) => {
    const e = await getEdition(id);
    if (e.status === EditionStatus.CANCELLED || e.status === EditionStatus.FINISHED) {
        throw new AppError('Cette édition est terminée : plus rien n’est modifiable.', 409, true, 'EDITION_CLOSED');
    }
    const rank = editionRank(e.status);
    const locked: string[] = [];
    const before = { name: e.name, description: e.description, rulesText: e.rulesText, schedule: e.schedule, settings: e.settings };

    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 3 || name.length > 120) throw new AppError('Nom de l’édition : 3 à 120 caractères.', 400, true, 'INVALID_EDITION', { field: 'name' });
        e.name = name;
    }
    if (body.description !== undefined) e.description = String(body.description).slice(0, 4000);
    if (body.rulesText !== undefined && body.rulesText !== e.rulesText) {
        if (rank >= 1) locked.push('rulesText');
        else e.rulesText = String(body.rulesText).slice(0, 30000);
    }

    if (body.schedule) {
        const next = {
            qualificationOpensAt: body.schedule.qualificationOpensAt !== undefined ? date(body.schedule.qualificationOpensAt, 'qualificationOpensAt') : e.schedule.qualificationOpensAt,
            qualificationClosesAt: body.schedule.qualificationClosesAt !== undefined ? date(body.schedule.qualificationClosesAt, 'qualificationClosesAt') : e.schedule.qualificationClosesAt,
            competitionStartsAt: body.schedule.competitionStartsAt !== undefined ? optDate(body.schedule.competitionStartsAt, 'competitionStartsAt') : e.schedule.competitionStartsAt,
            finalAt: body.schedule.finalAt !== undefined ? optDate(body.schedule.finalAt, 'finalAt') : e.schedule.finalAt,
        };
        const changed = (k: keyof typeof next) => (next[k]?.getTime() ?? null) !== (e.schedule[k]?.getTime() ?? null);
        if (rank >= 1 && changed('qualificationOpensAt')) locked.push('schedule.qualificationOpensAt');
        if (rank >= 1 && changed('qualificationClosesAt')) locked.push('schedule.qualificationClosesAt');
        if (rank >= 3 && changed('competitionStartsAt')) locked.push('schedule.competitionStartsAt');
        checkSchedule(next as IImpactEdition['schedule']);
        e.schedule = next as IImpactEdition['schedule'];
    }

    if (body.settings) {
        const merged = validateSettings({ ...e.settings, ...body.settings } as EditionSettings);
        if (rank >= 1) for (const k of QUALIFICATION_LOCKED) if (!same(merged[k], e.settings[k])) locked.push(`settings.${k}`);
        if (rank >= 3) for (const k of COMPETITION_LOCKED) if (!same(merged[k], e.settings[k])) locked.push(`settings.${k}`);
        e.settings = merged;
        e.markModified('settings');
    }

    if (locked.length) {
        throw new AppError('Ces règles sont verrouillées pour cette édition.', 409, true, 'RULES_LOCKED', { fields: locked });
    }
    await e.save();
    invalidateCurrent();
    await audit({ actor, action: 'edition.updated', editionId: e._id, before, after: { name: e.name, description: e.description, rulesText: e.rulesText, schedule: e.schedule, settings: e.settings } });
    return e;
};

/**
 * DRAFT → QUALIFICATION. The rules must be written (they are published and
 * frozen from here), the end of qualification must be ahead, and only one
 * edition runs at a time.
 */
export const openQualification = async (actor: Actor, id: string) => {
    const e = await getEdition(id);
    if (e.status !== EditionStatus.DRAFT) throw new AppError('Seule une édition en préparation peut être ouverte.', 409, true, 'BAD_STATUS');
    if (e.rulesText.trim().length < 200) {
        throw new AppError('Rédigez le règlement (200 caractères au moins) : il est publié et verrouillé à l’ouverture.', 400, true, 'RULES_MISSING');
    }
    if (e.schedule.qualificationClosesAt <= new Date()) throw new AppError('La fin de la qualification est déjà passée.', 400, true, 'INVALID_SCHEDULE');
    const other = await ImpactEdition.findOne({ _id: { $ne: e._id }, status: { $in: LIVE_EDITION_STATUSES } }).select('name').lean();
    if (other) throw new AppError(`L’édition « ${other.name} » est encore en cours.`, 409, true, 'ANOTHER_EDITION_RUNNING');
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: EditionStatus.DRAFT },
        {
            $set: { status: EditionStatus.QUALIFICATION },
            $push: { statusHistory: { from: EditionStatus.DRAFT, to: EditionStatus.QUALIFICATION, at: now, by: new Types.ObjectId(actor.userId) } },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    invalidateCurrent();
    await audit({ actor, action: 'edition.qualification_opened', editionId: e._id, after: { rulesText: e.rulesText, settings: e.settings, schedule: e.schedule } });
    return done;
};

/**
 * Ends qualification now (administration). The job does the closing within a
 * few seconds, so the last candidates who reached the count are placed first
 * by the usual rule: the window simply ends now.
 */
export const requestCloseQualification = async (actor: Actor, id: string, reason: string) => {
    const e = await getEdition(id);
    if (e.status !== EditionStatus.QUALIFICATION) throw new AppError('La qualification n’est pas en cours.', 409, true, 'BAD_STATUS');
    if (reason.trim().length < 5) throw new AppError('Indiquez la raison (5 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const now = new Date();
    if (now < e.schedule.qualificationClosesAt) {
        await ImpactEdition.updateOne({ _id: e._id, status: EditionStatus.QUALIFICATION }, {
            $set: {
                'schedule.qualificationClosesAt': now,
                registrationClosedAt: e.registrationClosedAt ?? now,
                registrationClosedReason: e.registrationClosedReason ?? 'admin',
            },
        });
    }
    invalidateCurrent();
    await audit({ actor, action: 'edition.close_requested', editionId: e._id, before: { qualificationClosesAt: e.schedule.qualificationClosesAt }, after: { qualificationClosesAt: now }, reason });
    return getEdition(id);
};

export const cancelEdition = async (actor: Actor, id: string, reason: string) => {
    const e = await getEdition(id);
    if (e.status === EditionStatus.CANCELLED || e.status === EditionStatus.FINISHED) {
        throw new AppError('Cette édition est déjà terminée.', 409, true, 'BAD_STATUS');
    }
    if (reason.trim().length < 10) throw new AppError('Indiquez la raison (10 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: e.status },
        {
            $set: { status: EditionStatus.CANCELLED, cancellation: { reason, at: now, by: new Types.ObjectId(actor.userId) } },
            $push: { statusHistory: { from: e.status, to: EditionStatus.CANCELLED, at: now, by: new Types.ObjectId(actor.userId), reason } },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    invalidateCurrent();
    await audit({ actor, action: 'edition.cancelled', editionId: e._id, reason });
    const active = await ImpactCandidate.find({
        editionId: e._id,
        status: { $in: [CandidateStatus.QUALIFYING, CandidateStatus.WAITLIST, CandidateStatus.OFFICIAL, CandidateStatus.SUSPENDED, CandidateStatus.STAGE_2, CandidateStatus.STAGE_3, CandidateStatus.FINALIST] },
    }).select('_id userId').lean();
    for (const c of active) {
        await notifyCandidate(c as any, 'impact-edition-cancelled', 'SBC Impact Challenge : édition annulée',
            `L’édition « ${e.name} » du SBC Impact Challenge est annulée : ${reason}. Merci pour ta participation.`);
    }
    return done;
};
