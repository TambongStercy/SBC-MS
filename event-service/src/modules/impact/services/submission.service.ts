import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import { IImpactEdition, IImpactSubmission, ImpactCandidate, ImpactSubmission, ProjectContent, VideoContent } from '../models';
import {
    CandidateStatus, EditionStatus, RoundKey, RoundStatus, SubmissionKind, SubmissionStatus,
} from '../types';
import { Actor, audit, notifyCandidate, timeOf } from '../lib';
import { currentEdition, getEdition } from './edition.service';
import { invalidateBoard } from './board.service';

/**
 * Week 2 « Ma vision de SBC » video (§6.1) and week 3 project presentation (§7).
 * The candidate submits from their space; the administration accepts (it is
 * then published), refuses (final for that content), or asks for a new
 * version. Only accepted submissions can be voted for.
 */

const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_\-./]{2,299}$/;
const fileId = (v: unknown, field: string, required: boolean) => {
    const s = String(v ?? '').trim();
    if (!s) {
        if (required) throw new AppError('Ajoutez la vidéo.', 400, true, 'INVALID_SUBMISSION', { field });
        return undefined;
    }
    if (!FILE_ID.test(s) || s.includes('..')) throw new AppError('Fichier invalide.', 400, true, 'INVALID_SUBMISSION', { field });
    return s;
};
const text = (v: unknown, key: string, label: string, min: number, max: number) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min) throw new AppError(`« ${label} » : au moins ${min} caractères.`, 400, true, 'INVALID_SUBMISSION', { field: key });
    if (s.length > max) throw new AppError(`« ${label} » : ${max} caractères au maximum.`, 400, true, 'INVALID_SUBMISSION', { field: key });
    return s;
};

/** The project presentation (spec §7): every heading the cahier des charges lists. */
export const PROJECT_FIELDS: { key: keyof ProjectContent; label: string }[] = [
    { key: 'problem', label: 'Le problème' },
    { key: 'solution', label: 'La solution' },
    { key: 'howItWorks', label: 'Le fonctionnement' },
    { key: 'targetCustomers', label: 'La clientèle cible' },
    { key: 'businessModel', label: 'Le modèle économique' },
    { key: 'expectedImpact', label: 'L’impact attendu' },
    { key: 'fundingUse', label: 'L’utilisation d’un éventuel financement' },
    { key: 'outlook', label: 'Les perspectives de développement' },
];

const parseVideo = (b: Record<string, any>): VideoContent => ({
    videoFileId: fileId(b.videoFileId, 'videoFileId', true)!,
    caption: b.caption ? text(b.caption, 'caption', 'Légende', 0, 500) : undefined,
});

const parseProject = (b: Record<string, any>): ProjectContent => {
    const out: Record<string, string | undefined> = {};
    for (const f of PROJECT_FIELDS) out[f.key] = text(b[f.key], f.key, f.label, 20, 2000);
    out.videoFileId = fileId(b.videoFileId, 'videoFileId', false);
    return out as unknown as ProjectContent;
};

/**
 * Who may submit what, and until when: the video from the competition start
 * until the free vote closes; the project until the paid votes close.
 */
const ALLOWED: Record<SubmissionKind, { statuses: CandidateStatus[]; round: RoundKey }> = {
    [SubmissionKind.VIDEO]: { statuses: [CandidateStatus.OFFICIAL, CandidateStatus.STAGE_2], round: RoundKey.FREE },
    [SubmissionKind.PROJECT]: { statuses: [CandidateStatus.OFFICIAL, CandidateStatus.STAGE_2, CandidateStatus.STAGE_3], round: RoundKey.PAID },
};

const kindOf = (k: string): SubmissionKind => {
    const up = String(k).toUpperCase();
    if (up !== SubmissionKind.VIDEO && up !== SubmissionKind.PROJECT) throw new AppError('Type de contenu inconnu.', 404);
    return up as SubmissionKind;
};

export const presentSubmission = (s: IImpactSubmission | Record<string, any>) => ({
    _id: String(s._id),
    candidateId: String(s.candidateId),
    kind: s.kind,
    version: s.version,
    status: s.status,
    video: s.kind === SubmissionKind.VIDEO ? s.video : undefined,
    project: s.kind === SubmissionKind.PROJECT ? s.project : undefined,
    review: s.review ? { reason: s.review.reason ?? null, at: s.review.at } : null,
    publishedAt: s.publishedAt ?? null,
    externalUrl: s.externalUrl ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
});

/** The candidate's current submissions, by kind. */
export const currentSubmissions = async (candidateId: Types.ObjectId) => {
    const rows = await ImpactSubmission.find({ candidateId, current: true }).lean();
    const by = Object.fromEntries(rows.map((r) => [r.kind, presentSubmission(r)]));
    return { VIDEO: by.VIDEO ?? null, PROJECT: by.PROJECT ?? null };
};

const roundClosed = (e: IImpactEdition, k: RoundKey) => e.rounds?.[k]?.status === RoundStatus.CLOSED;

/**
 * Submit (or replace, while still pending) the video or the project. A refused
 * content stays refused; after « nouvelle soumission demandée » a new version
 * is created.
 */
export const submitMine = async (userId: string, kindParam: string, body: Record<string, any>) => {
    const kind = kindOf(kindParam);
    const e = await currentEdition();
    if (!e || e.status !== EditionStatus.COMPETITION) throw new AppError('La compétition n’est pas en cours.', 409, true, 'NO_COMPETITION');
    const c = await ImpactCandidate.findOne({ editionId: e._id, userId: new Types.ObjectId(userId) });
    if (!c) throw new AppError('Vous n’avez pas de candidature dans cette édition.', 404, true, 'NO_CANDIDACY');
    const rule = ALLOWED[kind];
    if (!rule.statuses.includes(c.status)) throw new AppError('Votre candidature ne permet pas de déposer ce contenu.', 409, true, 'NOT_ALLOWED');
    if (roundClosed(e, rule.round)) throw new AppError('Le vote de cette étape est clos : le dépôt est fermé.', 409, true, 'SUBMISSIONS_CLOSED');
    const content = kind === SubmissionKind.VIDEO ? { video: parseVideo(body) } : { project: parseProject(body) };

    const cur = await ImpactSubmission.findOne({ candidateId: c._id, kind, current: true });
    if (cur?.status === SubmissionStatus.ACCEPTED) throw new AppError('Ce contenu est déjà validé et publié.', 409, true, 'ALREADY_ACCEPTED');
    if (cur?.status === SubmissionStatus.REJECTED) throw new AppError('Ce contenu a été refusé par l’équipe SBC. Contactez le support.', 409, true, 'SUBMISSION_REJECTED');
    let saved: IImpactSubmission | null;
    if (cur?.status === SubmissionStatus.PENDING) {
        saved = await ImpactSubmission.findOneAndUpdate({ _id: cur._id, status: SubmissionStatus.PENDING }, { $set: content }, { new: true });
        if (!saved) throw new AppError('Votre contenu vient d’être examiné. Rechargez la page.', 409, true, 'STALE');
    } else {
        if (cur) await ImpactSubmission.updateOne({ _id: cur._id, current: true }, { $set: { current: false } });
        try {
            saved = await ImpactSubmission.create({
                editionId: e._id, candidateId: c._id, userId: c.userId, kind,
                version: (cur?.version ?? 0) + 1, current: true, status: SubmissionStatus.PENDING, ...content,
            });
        } catch (err: any) {
            if (err?.code === 11000) throw new AppError('Un envoi est déjà en cours. Rechargez la page.', 409, true, 'STALE');
            throw err;
        }
    }
    await audit({ actor: { role: 'member', userId }, action: `submission.${kind.toLowerCase()}_submitted`, editionId: e._id, candidateId: c._id, after: { version: saved!.version } });
    return presentSubmission(saved!);
};

// ---------- Administration ----------

export const listSubmissions = async (editionId: string, q: Record<string, any>) => {
    const e = await getEdition(editionId);
    const filter: Record<string, unknown> = { editionId: e._id, current: true };
    if (q.kind) filter.kind = kindOf(q.kind);
    if (q.status && Object.values(SubmissionStatus).includes(q.status)) filter.status = q.status;
    // Pending first (oldest first), then new version requested, accepted, refused.
    const ORDER: Record<string, number> = { PENDING: 0, RESUBMIT_REQUESTED: 1, ACCEPTED: 2, REJECTED: 3 };
    const rows = (await ImpactSubmission.find(filter).limit(500).lean())
        .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime());
    const cands = await ImpactCandidate.find({ _id: { $in: rows.map((r) => r.candidateId) } }).select('profile.name profile.projectName profile.photoFileId seatNumber status').lean();
    const by = new Map(cands.map((c) => [String(c._id), c]));
    return rows.map((r) => {
        const c = by.get(String(r.candidateId));
        return { ...presentSubmission(r), candidate: c ? { name: c.profile.name, projectName: c.profile.projectName, photoFileId: c.profile.photoFileId, seatNumber: c.seatNumber, status: c.status } : null };
    });
};

/**
 * accept → published; reject (final) or resubmit (the candidate sends a new
 * version), both with a reason the candidate reads. `updatedAt` = the version
 * the admin watched: a content replaced since is refused (STALE).
 */
export const reviewSubmission = async (actor: Actor, id: string, body: Record<string, any>) => {
    if (!Types.ObjectId.isValid(id)) throw new AppError('Contenu introuvable.', 404);
    const s = await ImpactSubmission.findById(id);
    if (!s || !s.current) throw new AppError('Contenu introuvable.', 404);
    if (s.status !== SubmissionStatus.PENDING) throw new AppError('Ce contenu a déjà été examiné.', 409, true, 'ALREADY_REVIEWED');
    if (body?.updatedAt && timeOf(body.updatedAt) !== s.updatedAt.getTime()) {
        throw new AppError('Le candidat a remplacé ce contenu depuis votre lecture. Rechargez-le.', 409, true, 'STALE');
    }
    const decision = body?.decision;
    const map: Record<string, SubmissionStatus> = { accept: SubmissionStatus.ACCEPTED, reject: SubmissionStatus.REJECTED, resubmit: SubmissionStatus.RESUBMIT_REQUESTED };
    if (!map[decision]) throw new AppError('Décision : accept, reject ou resubmit.', 400, true, 'BAD_DECISION');
    const reason = String(body?.reason ?? '').trim().slice(0, 1000);
    if (decision !== 'accept' && reason.length < 10) throw new AppError('Indiquez la raison au candidat (10 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const now = new Date();
    const done = await ImpactSubmission.findOneAndUpdate(
        { _id: s._id, status: SubmissionStatus.PENDING, updatedAt: s.updatedAt },
        { $set: { status: map[decision], review: { reason: reason || undefined, at: now, by: new Types.ObjectId(actor.userId) }, ...(decision === 'accept' ? { publishedAt: now } : {}) } },
        { new: true },
    );
    if (!done) throw new AppError('Le contenu a changé entre-temps. Rechargez-le.', 409, true, 'STALE');
    invalidateBoard();
    await audit({ actor, action: `submission.${decision}`, editionId: s.editionId, candidateId: s.candidateId, after: { kind: s.kind, version: s.version }, reason: reason || undefined });

    const what = s.kind === SubmissionKind.VIDEO ? 'ta vidéo « Ma vision de SBC »' : 'la présentation de ton projet';
    const c = { _id: s.candidateId, userId: s.userId } as any;
    if (decision === 'accept') {
        await notifyCandidate(c, `impact-${s.kind.toLowerCase()}-accepted`, 'SBC Impact Challenge : contenu validé',
            `L’équipe SBC a validé ${what}. Il est publié : partage-le pour récolter des votes !`);
    } else if (decision === 'reject') {
        await notifyCandidate(c, `impact-${s.kind.toLowerCase()}-rejected`, 'SBC Impact Challenge : contenu refusé',
            `L’équipe SBC a refusé ${what} : ${reason}`);
    } else {
        await notifyCandidate(c, `impact-${s.kind.toLowerCase()}-resubmit`, 'SBC Impact Challenge : nouvelle version demandée',
            `L’équipe SBC te demande une nouvelle version de ${what} : ${reason}`);
    }
    return presentSubmission(done);
};

/** Where SBC published an accepted content (Facebook post…), shown on the candidate's page. */
export const setExternalUrl = async (actor: Actor, id: string, body: Record<string, any>) => {
    if (!Types.ObjectId.isValid(id)) throw new AppError('Contenu introuvable.', 404);
    const raw = String(body?.externalUrl ?? '').trim();
    let url: string | undefined;
    if (raw) {
        try {
            const u = new URL(raw);
            if (u.protocol !== 'https:') throw new Error('https');
            url = u.toString();
        } catch {
            throw new AppError('Le lien doit être une adresse https complète.', 400, true, 'INVALID_URL', { field: 'externalUrl' });
        }
    }
    const done = await ImpactSubmission.findOneAndUpdate(
        { _id: id, status: SubmissionStatus.ACCEPTED },
        url ? { $set: { externalUrl: url } } : { $unset: { externalUrl: 1 } },
        { new: true },
    );
    if (!done) throw new AppError('Seul un contenu publié reçoit un lien.', 409, true, 'NOT_PUBLISHED');
    invalidateBoard();
    await audit({ actor, action: 'submission.external_url', editionId: done.editionId, candidateId: done.candidateId, after: { externalUrl: url ?? null } });
    return presentSubmission(done);
};
