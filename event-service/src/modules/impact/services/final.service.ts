import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { getImpactMembers, verifyMemberAuthenticator } from '../../../services/clients/user.service.client';
import { kv } from '../../animation/lib/kv';
import {
    FinalResultRow, IImpactEdition, ImpactCandidate, ImpactEdition, ImpactFinalVote, ImpactJuror, ImpactJuryScore,
    ImpactSubmission,
} from '../models';
import {
    CandidateStatus, CompetitionStage, EditionStatus, LivePhase, RoundStatus, settingsOf, SubmissionKind, SubmissionStatus,
} from '../types';
import { Actor, audit, notifyCandidate, transitionCandidate } from '../lib';
import { getEdition, invalidateCurrent } from './edition.service';
import { invalidateBoard } from './board.service';
import { presentSubmission } from './submission.service';

const log = logger.getLogger('ImpactFinal');

/**
 * The live final (spec §10–§12): the TOP 3 present their project live, the
 * jury scores each one on the edition's criteria, the public votes once
 * (free), and the result combines the three parts with the edition's weights
 * (Rufus: paid votes 50 %, final public vote 30 %, jury 20 %).
 *
 * The formula, published with the result: each part is put on 0–100, the best
 * finalist of that part getting 100 (the others in proportion), then
 * score = Σ weight × part / 100. Ties go to the jury part, then the paid votes,
 * then the TOP 3 rank.
 */

const oid = (v: unknown, what = 'Ressource') => {
    if (!Types.ObjectId.isValid(String(v))) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(String(v));
};
const JURY_WINDOW_SEC = 30 * 60;
const MAX_JURORS = 15;
const JURY_URL = '/impact-challenge/jury';

const finalists = (editionId: Types.ObjectId) =>
    ImpactCandidate.find({ editionId, status: { $in: [CandidateStatus.FINALIST, CandidateStatus.WINNER] } }).sort({ rank: 1 });

const juryMax = (e: IImpactEdition) => settingsOf(e.settings).juryCriteria.reduce((sum, c) => sum + c.max, 0);

const assertFinal = (e: IImpactEdition, stages: CompetitionStage[]) => {
    if (e.status !== EditionStatus.FINAL || !e.stage || !stages.includes(e.stage)) {
        throw new AppError('Cette action n’est pas possible à cette étape de la finale.', 409, true, 'WRONG_STAGE');
    }
};

// ---------- Jury (administration) ----------

export const listJury = async (editionId: string) => {
    const e = await getEdition(editionId);
    const [jurors, fins, scores] = await Promise.all([
        ImpactJuror.find({ editionId: e._id }).sort({ addedAt: 1 }).lean(),
        finalists(e._id).select('_id profile.name').lean(),
        ImpactJuryScore.find({ editionId: e._id }).select('jurorUserId candidateId total updatedAt history').lean(),
    ]);
    return {
        lockedAt: e.jury?.lockedAt ?? null,
        criteria: settingsOf(e.settings).juryCriteria,
        maxTotal: juryMax(e),
        finalists: fins.map((f) => ({ _id: String(f._id), name: f.profile?.name })),
        jurors: jurors.map((j) => {
            const mine = scores.filter((sc) => String(sc.jurorUserId) === String(j.userId));
            return {
                _id: String(j._id), userId: String(j.userId), name: j.name, addedAt: j.addedAt, removedAt: j.removedAt ?? null,
                scored: mine.length,
                scores: mine.map((sc) => ({ candidateId: String(sc.candidateId), total: sc.total, updatedAt: sc.updatedAt, edits: sc.history?.length ?? 0 })),
            };
        }),
    };
};

/** Every score with its history, for the administration (§11.1: « consulter les notes »). */
export const juryScoresDetail = async (editionId: string) => {
    const e = await getEdition(editionId);
    const rows = await ImpactJuryScore.find({ editionId: e._id }).sort({ candidateId: 1, jurorUserId: 1 }).lean();
    const jurors = await ImpactJuror.find({ editionId: e._id }).select('userId name removedAt').lean();
    const byUser = new Map(jurors.map((j) => [String(j.userId), j]));
    return rows.map((r) => ({
        candidateId: String(r.candidateId), jurorUserId: String(r.jurorUserId),
        jurorName: byUser.get(String(r.jurorUserId))?.name ?? null, jurorRemoved: Boolean(byUser.get(String(r.jurorUserId))?.removedAt),
        scores: r.scores, total: r.total, comment: r.comment ?? null, updatedAt: r.updatedAt, history: r.history ?? [],
    }));
};

/** Adds a juror (an SBC account). Never a finalist: a candidate does not judge their own final. */
export const addJuror = async (actor: Actor, editionId: string, body: Record<string, any>) => {
    const e = await getEdition(editionId);
    assertFinal(e, [CompetitionStage.TOP3, CompetitionStage.LIVE]);
    if (e.jury?.lockedAt) throw new AppError('Les notes sont verrouillées : le jury ne change plus.', 409, true, 'JURY_LOCKED');
    const userId = oid(body?.userId, 'Membre');
    if (await ImpactCandidate.exists({ editionId: e._id, userId, status: { $in: [CandidateStatus.FINALIST, CandidateStatus.WINNER] } })) {
        throw new AppError('Un finaliste ne peut pas faire partie du jury.', 409, true, 'CONFLICT_OF_INTEREST');
    }
    if ((await ImpactJuror.countDocuments({ editionId: e._id, removedAt: { $exists: false } })) >= MAX_JURORS) {
        throw new AppError(`${MAX_JURORS} jurés au plus.`, 409, true, 'TOO_MANY_JURORS');
    }
    let m;
    try {
        [m] = await getImpactMembers([String(userId)]);
    } catch {
        throw new AppError('Vérification du compte impossible pour le moment. Réessayez.', 503, true, 'MEMBER_CHECK_UNAVAILABLE');
    }
    if (!m || m.unavailable) throw new AppError('Ce compte ne peut pas être juré.', 409, true, 'ACCOUNT_UNAVAILABLE');
    const existing = await ImpactJuror.findOne({ editionId: e._id, userId });
    if (existing && !existing.removedAt) throw new AppError('Ce membre fait déjà partie du jury.', 409, true, 'ALREADY_JUROR');
    const juror = existing
        ? await ImpactJuror.findOneAndUpdate({ _id: existing._id }, { $unset: { removedAt: 1, removedBy: 1 }, $set: { addedAt: new Date(), addedBy: oid(actor.userId) } }, { new: true })
        : await ImpactJuror.create({ editionId: e._id, userId, name: m.name, addedBy: oid(actor.userId) });
    await audit({ actor, action: 'jury.juror_added', editionId: e._id, after: { userId: String(userId), name: m.name } });
    await notifyCandidate({ _id: juror!._id, userId } as any, 'impact-jury-invited', 'SBC Impact Challenge : vous êtes juré',
        `Vous faites partie du jury de la finale « ${e.name} ». Votre espace jury est dans l’application ; vous noterez chaque finaliste après sa présentation, avec le code de votre application d’authentification.`);
    return juror;
};

export const removeJuror = async (actor: Actor, editionId: string, jurorId: string, reason: string) => {
    const e = await getEdition(editionId);
    if (e.jury?.lockedAt) throw new AppError('Les notes sont verrouillées : le jury ne change plus.', 409, true, 'JURY_LOCKED');
    if (String(reason ?? '').trim().length < 5) throw new AppError('Indiquez la raison (5 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const j = await ImpactJuror.findOneAndUpdate(
        { _id: oid(jurorId, 'Juré'), editionId: e._id, removedAt: { $exists: false } },
        { $set: { removedAt: new Date(), removedBy: oid(actor.userId) } },
        { new: true },
    );
    if (!j) throw new AppError('Juré introuvable.', 404);
    await audit({ actor, action: 'jury.juror_removed', editionId: e._id, after: { userId: String(j.userId), name: j.name }, reason });
    return j;
};

// ---------- The live ----------

/** TOP3 → LIVE: the final starts; jurors can score; the final vote can open. */
export const startFinal = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    assertFinal(e, [CompetitionStage.TOP3]);
    if (!(await ImpactJuror.exists({ editionId: e._id, removedAt: { $exists: false } }))) {
        throw new AppError('Ajoutez au moins un juré avant de démarrer la finale.', 409, true, 'NO_JURY');
    }
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: EditionStatus.FINAL, stage: CompetitionStage.TOP3 },
        {
            $set: { stage: CompetitionStage.LIVE, live: { onStageCandidateId: null, phase: null, startedAt: now, updatedAt: now } },
            $push: { stageHistory: { stage: CompetitionStage.LIVE, at: now, by: oid(actor.userId) } },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    invalidateCurrent(); invalidateBoard(); invalidateFinal();
    await audit({ actor, action: 'final.started', editionId: e._id });
    for (const f of await finalists(e._id).select('_id userId').lean()) {
        await notifyCandidate(f as any, 'impact-final-started', 'SBC Impact Challenge : la finale commence',
            'La grande finale commence ! Présente ton projet avec conviction : le jury et le public votent pendant le direct.');
    }
    return done;
};

/** Who is on stage, and what is happening (the live screen shows it). */
export const setOnStage = async (actor: Actor, editionId: string, body: Record<string, any>) => {
    const e = await getEdition(editionId);
    assertFinal(e, [CompetitionStage.LIVE]);
    let candidateId: Types.ObjectId | null = null;
    if (body?.candidateId) {
        candidateId = oid(body.candidateId, 'Finaliste');
        if (!(await ImpactCandidate.exists({ _id: candidateId, editionId: e._id, status: CandidateStatus.FINALIST }))) {
            throw new AppError('Seul un finaliste monte sur scène.', 409, true, 'NOT_A_FINALIST');
        }
    }
    const phase = body?.phase && Object.values(LivePhase).includes(body.phase) ? body.phase as LivePhase : null;
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, stage: CompetitionStage.LIVE },
        { $set: { 'live.onStageCandidateId': candidateId, 'live.phase': candidateId ? phase : null, 'live.updatedAt': new Date() } },
        { new: true },
    );
    if (!done) throw new AppError('La finale n’est plus en direct.', 409, true, 'WRONG_STAGE');
    invalidateFinal();
    await audit({ actor, action: 'final.on_stage', editionId: e._id, after: { candidateId: candidateId ? String(candidateId) : null, phase } });
    return done;
};

// ---------- Scoring (the juror) ----------

/** The juror's editions and finalists, with their own scores. */
export const myJury = async (userId: string) => {
    const uid = oid(userId, 'Membre');
    const seats = await ImpactJuror.find({ userId: uid, removedAt: { $exists: false } }).lean();
    const editions = await ImpactEdition.find({ _id: { $in: seats.map((s) => s.editionId) }, status: { $in: [EditionStatus.FINAL, EditionStatus.FINISHED] } })
        .sort({ updatedAt: -1 }).limit(5);
    const out = [];
    for (const e of editions) {
        const [fins, mine] = await Promise.all([
            finalists(e._id).lean(),
            ImpactJuryScore.find({ editionId: e._id, jurorUserId: uid }).lean(),
        ]);
        const projects = await ImpactSubmission.find({ candidateId: { $in: fins.map((f) => f._id) }, current: true, status: SubmissionStatus.ACCEPTED }).lean();
        const sub = (cid: Types.ObjectId, kind: SubmissionKind) => {
            const s = projects.find((p) => String(p.candidateId) === String(cid) && p.kind === kind);
            return s ? presentSubmission(s) : null;
        };
        const windowOpen = Boolean(await kv().get(`impact:jury:ok:${e._id}:${userId}`).catch(() => null));
        out.push({
            edition: { _id: String(e._id), name: e.name, status: e.status, stage: e.stage ?? null },
            canScore: e.stage === CompetitionStage.LIVE && !e.jury?.lockedAt,
            lockedAt: e.jury?.lockedAt ?? null,
            codeWindowOpen: windowOpen,
            criteria: settingsOf(e.settings).juryCriteria,
            maxTotal: juryMax(e),
            onStageCandidateId: e.live?.onStageCandidateId ? String(e.live.onStageCandidateId) : null,
            finalists: fins.map((f) => {
                const s = mine.find((x) => String(x.candidateId) === String(f._id));
                return {
                    _id: String(f._id), rank: f.rank ?? null,
                    profile: { name: f.profile.name, photoFileId: f.profile.photoFileId, city: f.profile.city, country: f.profile.country, activity: f.profile.activity, projectName: f.profile.projectName, projectDescription: f.profile.projectDescription },
                    project: sub(f._id, SubmissionKind.PROJECT), video: sub(f._id, SubmissionKind.VIDEO),
                    myScore: s ? { scores: s.scores, total: s.total, comment: s.comment ?? null, updatedAt: s.updatedAt, edits: s.history?.length ?? 0 } : null,
                };
            }),
        });
    }
    return out;
};

/**
 * Saves (or corrects) the juror's marks for one finalist, while the final is
 * live and the jury not locked. The juror's authenticator code is asked once
 * per 30 min (a personal, secured access, §11 and §17). Every correction keeps
 * the previous version.
 */
export const saveScore = async (userId: string, editionId: string, candidateId: string, body: Record<string, any>) => {
    const e = await getEdition(editionId);
    assertFinal(e, [CompetitionStage.LIVE]);
    if (e.jury?.lockedAt) throw new AppError('Les notes sont verrouillées.', 409, true, 'JURY_LOCKED');
    const uid = oid(userId, 'Membre');
    if (!(await ImpactJuror.exists({ editionId: e._id, userId: uid, removedAt: { $exists: false } }))) {
        throw new AppError('Vous ne faites pas partie de ce jury.', 403, true, 'NOT_A_JUROR');
    }
    const cid = oid(candidateId, 'Finaliste');
    if (!(await ImpactCandidate.exists({ _id: cid, editionId: e._id, status: CandidateStatus.FINALIST }))) {
        throw new AppError('Seuls les finalistes sont notés.', 409, true, 'NOT_A_FINALIST');
    }

    // Marks: one per criterion, between 0 and its maximum, in half points.
    const criteria = settingsOf(e.settings).juryCriteria;
    const scores: Record<string, number> = {};
    for (const c of criteria) {
        const v = Number(body?.scores?.[c.key]);
        if (!Number.isFinite(v) || v < 0 || v > c.max || Math.round(v * 2) !== v * 2) {
            throw new AppError(`« ${c.label} » : une note entre 0 et ${c.max} (par demi-point).`, 400, true, 'INVALID_SCORE', { field: `scores.${c.key}` });
        }
        scores[c.key] = v;
    }
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const comment = body?.comment ? String(body.comment).trim().slice(0, 1000) : undefined;

    // Personal access: the juror's own authenticator code, once per 30 min.
    const windowKey = `impact:jury:ok:${e._id}:${userId}`;
    let windowOpen = false;
    try { windowOpen = Boolean(await kv().get(windowKey)); } catch { /* fall back to asking the code */ }
    if (!windowOpen) {
        const code = String(body?.authCode ?? '').trim();
        if (!code) throw new AppError('Confirmez avec le code de votre application d’authentification.', 403, true, 'AUTH_CODE_REQUIRED');
        try {
            await verifyMemberAuthenticator(userId, code);
        } catch (err) {
            if ((err as AppError).code === 'AUTHENTICATOR_REQUIRED') {
                throw new AppError('Pour noter, configurez d’abord l’application d’authentification (Profil → Sécurité) : elle protège vos notes.', 403, true, 'AUTHENTICATOR_REQUIRED');
            }
            throw err;
        }
        try { await kv().set(windowKey, '1', JURY_WINDOW_SEC); } catch { /* the next save asks again */ }
    }

    const prev = await ImpactJuryScore.findOne({ editionId: e._id, jurorUserId: uid, candidateId: cid }).lean();
    let saved;
    if (prev) {
        saved = await ImpactJuryScore.findOneAndUpdate(
            { _id: prev._id, updatedAt: prev.updatedAt },
            {
                $set: { scores, total, comment },
                $push: { history: { scores: prev.scores, total: prev.total, comment: prev.comment, at: prev.updatedAt } },
            },
            { new: true },
        );
        if (!saved) throw new AppError('Votre note vient d’être modifiée sur un autre appareil. Rechargez.', 409, true, 'STALE');
    } else {
        try {
            saved = await ImpactJuryScore.create({ editionId: e._id, jurorUserId: uid, candidateId: cid, scores, total, comment });
        } catch (err: any) {
            if (err?.code === 11000) throw new AppError('Votre note vient d’être enregistrée sur un autre appareil. Rechargez.', 409, true, 'STALE');
            throw err;
        }
    }
    await audit({ actor: { role: 'member', userId }, action: prev ? 'jury.score_updated' : 'jury.score_saved', editionId: e._id, candidateId: cid, before: prev ? { scores: prev.scores, total: prev.total } : undefined, after: { scores, total } });
    return { candidateId: String(cid), scores: saved!.scores, total: saved!.total, comment: saved!.comment ?? null, updatedAt: saved!.updatedAt, edits: saved!.history?.length ?? 0 };
};

/** « Verrouiller les notations » (§15): every finalist needs a score from at least one juror. */
export const lockJury = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    assertFinal(e, [CompetitionStage.LIVE]);
    if (e.jury?.lockedAt) throw new AppError('Les notes sont déjà verrouillées.', 409, true, 'JURY_LOCKED');
    const missing = await missingScores(e);
    if (missing.some((m) => m.scoredBy === 0)) {
        throw new AppError('Chaque finaliste doit avoir au moins une note avant le verrouillage.', 409, true, 'MISSING_SCORES', { missing });
    }
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, 'jury.lockedAt': { $exists: false } },
        { $set: { jury: { lockedAt: new Date(), lockedBy: oid(actor.userId) } } },
        { new: true },
    );
    if (!done) throw new AppError('Les notes sont déjà verrouillées.', 409, true, 'JURY_LOCKED');
    await audit({ actor, action: 'jury.locked', editionId: e._id, after: { missing } });
    return done;
};

/** For each finalist: how many active jurors scored them, and who did not. */
const missingScores = async (e: IImpactEdition) => {
    const [fins, jurors, scores] = await Promise.all([
        finalists(e._id).select('_id profile.name').lean(),
        ImpactJuror.find({ editionId: e._id, removedAt: { $exists: false } }).select('userId name').lean(),
        ImpactJuryScore.find({ editionId: e._id }).select('jurorUserId candidateId').lean(),
    ]);
    const active = new Set(jurors.map((j) => String(j.userId)));
    return fins.map((f) => {
        const by = new Set(scores.filter((s) => String(s.candidateId) === String(f._id) && active.has(String(s.jurorUserId))).map((s) => String(s.jurorUserId)));
        return {
            candidateId: String(f._id), name: f.profile?.name,
            scoredBy: by.size,
            notScoredBy: jurors.filter((j) => !by.has(String(j.userId))).map((j) => j.name),
        };
    });
};

// ---------- Result (§12) ----------

const pct = (v: number, best: number) => (best > 0 ? Math.round((v / best) * 10000) / 100 : 0);

/**
 * The three parts and the final score, computed from: the week-3 paid votes
 * frozen with the TOP 3, the final public votes, and the average total of the
 * active jurors' scores.
 */
export const resultPreview = async (editionId: string) => {
    const e = await getEdition(editionId);
    if (e.result?.publishedAt) return { published: true, result: e.result, blockers: [], formula: FORMULA };
    const st = settingsOf(e.settings);
    const fins = await finalists(e._id).lean();
    const frozen = new Map((e.top3?.ranking ?? []).map((r: any) => [String(r.candidateId), r]));
    const [votes, scores, jurors] = await Promise.all([
        ImpactFinalVote.aggregate([{ $match: { editionId: e._id } }, { $group: { _id: '$candidateId', n: { $sum: 1 } } }]),
        ImpactJuryScore.find({ editionId: e._id }).select('jurorUserId candidateId total').lean(),
        ImpactJuror.find({ editionId: e._id, removedAt: { $exists: false } }).select('userId').lean(),
    ]);
    const active = new Set(jurors.map((j) => String(j.userId)));
    const fv = new Map(votes.map((v) => [String(v._id), v.n as number]));
    const max = juryMax(e);
    const base = fins.map((f) => {
        const mine = scores.filter((s) => String(s.candidateId) === String(f._id) && active.has(String(s.jurorUserId)));
        const avg = mine.length ? Math.round((mine.reduce((a, s) => a + s.total, 0) / mine.length) * 100) / 100 : 0;
        return {
            candidateId: f._id, name: f.profile.name, projectName: f.profile.projectName,
            paidVotes: (frozen.get(String(f._id)) as any)?.paidVotes ?? f.votes?.paid ?? 0,
            top3Rank: f.rank ?? 99,
            finalVotes: fv.get(String(f._id)) ?? 0,
            juryAverage: avg, juryMax: max, jurorsCount: mine.length,
        };
    });
    const bestPaid = Math.max(0, ...base.map((b) => b.paidVotes));
    const bestPublic = Math.max(0, ...base.map((b) => b.finalVotes));
    const bestJury = Math.max(0, ...base.map((b) => b.juryAverage));
    const w = st.weights;
    const rows: (FinalResultRow & { top3Rank: number })[] = base.map((b) => {
        const components = { paidVotes: pct(b.paidVotes, bestPaid), publicVote: pct(b.finalVotes, bestPublic), jury: pct(b.juryAverage, bestJury) };
        const score = Math.round(((w.paidVotes * components.paidVotes + w.publicVote * components.publicVote + w.jury * components.jury) / 100) * 100) / 100;
        return { ...b, components, score, rank: 0 };
    });
    rows.sort((a, b) => b.score - a.score || b.components.jury - a.components.jury || b.paidVotes - a.paidVotes || a.top3Rank - b.top3Rank);
    rows.forEach((r, i) => { r.rank = i + 1; });

    const blockers: { code: string; message: string; details?: unknown }[] = [];
    if (e.status !== EditionStatus.FINAL || e.stage !== CompetitionStage.LIVE) blockers.push({ code: 'WRONG_STAGE', message: 'Le résultat se publie à la fin de la finale en direct.' });
    if (!e.jury?.lockedAt) blockers.push({ code: 'JURY_NOT_LOCKED', message: 'Verrouillez d’abord les notes du jury.' });
    if (e.rounds?.FINAL?.status === RoundStatus.OPEN) blockers.push({ code: 'ROUND_OPEN', message: 'Clôturez d’abord le vote public de la finale.' });
    const missing = await missingScores(e);
    if (missing.some((m) => m.scoredBy === 0)) blockers.push({ code: 'MISSING_SCORES', message: 'Un finaliste n’a aucune note du jury.', details: { missing } });
    if (rows.length < 1) blockers.push({ code: 'NO_FINALISTS', message: 'Aucun finaliste.' });
    const warnings: string[] = [];
    if (e.rounds?.FINAL?.status !== RoundStatus.CLOSED) warnings.push('Le vote public de la finale n’a pas eu lieu : sa part vaut 0 pour tous.');
    if (rows.length >= 2 && rows[0].score === rows[1].score) warnings.push('Égalité en tête : départagée par la note du jury, puis les votes payants, puis le rang du TOP 3.');
    return {
        published: false,
        weights: w,
        rows: rows.map(({ top3Rank, ...r }) => ({ ...r, candidateId: String(r.candidateId) })),
        missing, blockers, warnings, formula: FORMULA,
    };
};

export const FORMULA = 'Chaque partie est ramenée sur 100 : le meilleur finaliste de la partie obtient 100, les autres en proportion. '
    + 'Score final = Σ (pondération × partie) / 100. En cas d’égalité : la note du jury, puis les votes payants, puis le rang du TOP 3.';

/**
 * Publishes the result (admin code required at the route) and names the
 * winner. `expectedOrder` = the order the admin read, as for the TOP 3.
 */
export const publishResult = async (actor: Actor, editionId: string, body: Record<string, any>) => {
    const p: any = await resultPreview(editionId);
    if (p.published) throw new AppError('Le résultat est déjà publié.', 409, true, 'ALREADY_PUBLISHED');
    if (p.blockers.length) throw new AppError(p.blockers[0].message, 409, true, p.blockers[0].code, { blockers: p.blockers });
    const seen: string[] = Array.isArray(body?.expectedOrder) ? body.expectedOrder.map(String) : [];
    if (!seen.length || seen.join(',') !== p.rows.map((r: any) => r.candidateId).join(',')) {
        throw new AppError('Le résultat a changé depuis votre lecture. Rechargez-le avant de publier.', 409, true, 'STALE');
    }
    const now = new Date();
    const winner = p.rows[0];
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: oid(editionId), status: EditionStatus.FINAL, stage: CompetitionStage.LIVE, 'result.publishedAt': { $exists: false } },
        {
            $set: {
                status: EditionStatus.FINISHED, stage: CompetitionStage.RESULT,
                result: {
                    publishedAt: now, by: oid(actor.userId), weights: p.weights,
                    rows: p.rows.map((r: any) => ({ ...r, candidateId: new Types.ObjectId(r.candidateId) })),
                    winnerCandidateId: new Types.ObjectId(winner.candidateId),
                },
                'live.onStageCandidateId': null, 'live.phase': null, 'live.updatedAt': now,
            },
            $push: {
                statusHistory: { from: EditionStatus.FINAL, to: EditionStatus.FINISHED, at: now, by: oid(actor.userId), reason: 'Résultat publié' },
                stageHistory: { stage: CompetitionStage.RESULT, at: now, by: oid(actor.userId) },
            },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    for (const r of p.rows) {
        // Finalists now carry their final rank (the TOP 3 order stays frozen in edition.top3).
        await ImpactCandidate.updateOne({ _id: new Types.ObjectId(r.candidateId) }, { $set: { rank: r.rank } });
        if (r.rank === 1) {
            const c = await transitionCandidate(r.candidateId, [CandidateStatus.FINALIST], CandidateStatus.WINNER, { by: actor.userId, reason: `Score final ${r.score}` });
            if (c) await notifyCandidate(c, 'impact-winner', 'SBC Impact Challenge : vous avez gagné ! 🏆',
                `Félicitations ! Avec un score final de ${r.score}/100, tu remportes le SBC Impact Challenge « ${done.name} ». L’équipe SBC te contacte pour la suite.`);
        } else {
            const c = await ImpactCandidate.findById(r.candidateId).select('_id userId').lean();
            if (c) await notifyCandidate(c as any, 'impact-final-result', 'SBC Impact Challenge : résultat de la finale',
                `Tu termines ${r.rank}e de la finale avec ${r.score}/100. Bravo pour ton parcours : tu restes à l’affiche de l’espace SBC Impact.`);
        }
    }
    invalidateCurrent(); invalidateBoard(); invalidateFinal();
    await audit({ actor, action: 'final.result_published', editionId: done._id, after: { winner: winner.candidateId, rows: p.rows.map((r: any) => ({ c: r.candidateId, score: r.score, rank: r.rank })) } });
    log.info(`Edition ${done._id}: result published, winner ${winner.candidateId}`);
    return done;
};

// ---------- The live screen (public) ----------

const TTL_MS = 5_000;
let cache: { at: number; value: unknown } | null = null;
export const invalidateFinal = () => { cache = null; };

/**
 * What the live screen shows: the finalists, who is on stage, the final vote's
 * state, and the result once published (the three parts and the score). Vote
 * counts and jury marks stay hidden until then. Cached 5 s (thousands watch).
 */
export const liveScreen = async () => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const e = await ImpactEdition.findOne({ status: { $in: [EditionStatus.FINAL, EditionStatus.FINISHED] }, 'top3.decidedAt': { $exists: true } }).sort({ 'top3.decidedAt': -1 });
    let value: unknown = null;
    if (e) {
        const fins = await finalists(e._id).lean();
        const subs = await ImpactSubmission.find({ candidateId: { $in: fins.map((f) => f._id) }, current: true, status: SubmissionStatus.ACCEPTED }).lean();
        const published = Boolean(e.result?.publishedAt);
        value = {
            editionId: String(e._id), name: e.name, status: e.status, stage: e.stage ?? null,
            onStageCandidateId: e.live?.onStageCandidateId ? String(e.live.onStageCandidateId) : null,
            phase: e.live?.phase ?? null,
            finalVote: e.rounds?.FINAL ? { status: e.rounds.FINAL.status, opensAt: e.rounds.FINAL.opensAt ?? null, closesAt: e.rounds.FINAL.closesAt ?? null } : null,
            weights: settingsOf(e.settings).weights,
            juryCriteria: settingsOf(e.settings).juryCriteria,
            freeVote: settingsOf(e.settings).freeVote,
            formula: FORMULA,
            finalists: fins.map((f) => ({
                _id: String(f._id), top3Rank: f.rank ?? null, status: f.status,
                profile: { name: f.profile.name, photoFileId: f.profile.photoFileId, city: f.profile.city, country: f.profile.country, activity: f.profile.activity, projectName: f.profile.projectName, projectDescription: f.profile.projectDescription },
                video: (() => { const s = subs.find((x) => String(x.candidateId) === String(f._id) && x.kind === SubmissionKind.VIDEO); return s ? presentSubmission(s) : null; })(),
                project: (() => { const s = subs.find((x) => String(x.candidateId) === String(f._id) && x.kind === SubmissionKind.PROJECT); return s ? presentSubmission(s) : null; })(),
            })),
            result: published ? {
                publishedAt: e.result!.publishedAt,
                winnerCandidateId: String(e.result!.winnerCandidateId),
                weights: e.result!.weights,
                rows: e.result!.rows.map((r: any) => ({ ...r.toObject?.() ?? r, candidateId: String(r.candidateId) })),
            } : null,
        };
    }
    cache = { at: Date.now(), value };
    return value;
};
