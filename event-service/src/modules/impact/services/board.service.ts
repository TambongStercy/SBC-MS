import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import { IImpactEdition, ImpactCandidate, ImpactEdition, ImpactSubmission } from '../models';
import {
    CandidateStatus, CompetitionStage, EditionStatus, STATUS_LABEL_FR, SubmissionKind, SubmissionStatus,
} from '../types';
import { presentSubmission } from './submission.service';

/**
 * The public side of the competition (spec §5, §8.2): the published
 * candidates, their published video and project, and the vote counts. This is
 * what thousands of members open during the vote rounds, so it is built once
 * and kept 10 s in the process (and sent with Cache-Control), and every vote
 * or decision clears it.
 */

const TTL_MS = 10_000;
let cache: { at: number; editionId: string; value: PublicBoard } | null = null;
export const invalidateBoard = () => { cache = null; };

/** Candidates shown publicly: published, and not removed from the competition. */
const SHOWN = [
    CandidateStatus.OFFICIAL, CandidateStatus.STAGE_2, CandidateStatus.STAGE_3, CandidateStatus.FINALIST,
    CandidateStatus.WINNER, CandidateStatus.ELIMINATED, CandidateStatus.FINISHED, CandidateStatus.SUSPENDED,
];

export interface PublicCandidate {
    _id: string;
    seatNumber: number | null;
    sbcId: string | null;
    status: CandidateStatus;
    statusLabel: string;
    profile: {
        name: string; photoFileId: string; country: string; city: string; activity: string; category: string;
        projectName: string; projectDescription: string; presentation: string; link: string | null;
    };
    video: ReturnType<typeof presentSubmission> | null;
    project: ReturnType<typeof presentSubmission> | null;
    votes: { free: number; paid: number };
    rank: number | null;
}

export interface PublicBoard {
    editionId: string;
    stage: CompetitionStage | null;
    /** Sorted for the current stage: free votes in week 2, paid votes in week 3, rank once the TOP 3 is set. */
    candidates: PublicCandidate[];
    totals: { freeVotes: number; paidVotes: number };
    builtAt: string;
}

const isPublic = (e: IImpactEdition) =>
    [EditionStatus.COMPETITION, EditionStatus.FINAL, EditionStatus.FINISHED].includes(e.status);

const build = async (e: IImpactEdition): Promise<PublicBoard> => {
    const cands = await ImpactCandidate.find({ editionId: e._id, publishedAt: { $exists: true }, status: { $in: SHOWN } }).lean();
    const subs = await ImpactSubmission.find({
        candidateId: { $in: cands.map((c) => c._id) }, current: true, status: SubmissionStatus.ACCEPTED,
    }).lean();
    const sub = (cid: Types.ObjectId, kind: SubmissionKind) => {
        const s = subs.find((x) => String(x.candidateId) === String(cid) && x.kind === kind);
        return s ? presentSubmission(s) : null;
    };
    const rows: PublicCandidate[] = cands.map((c) => ({
        _id: String(c._id),
        seatNumber: c.seatNumber ?? null,
        sbcId: c.sbcId ?? null,
        // A suspension is the administration's business: the public sees the candidate as before.
        status: c.status === CandidateStatus.SUSPENDED && c.suspendedFrom ? c.suspendedFrom : c.status,
        statusLabel: STATUS_LABEL_FR[c.status === CandidateStatus.SUSPENDED && c.suspendedFrom ? c.suspendedFrom : c.status],
        profile: {
            name: c.profile.name, photoFileId: c.profile.photoFileId, country: c.profile.country, city: c.profile.city,
            activity: c.profile.activity, category: c.profile.category, projectName: c.profile.projectName,
            projectDescription: c.profile.projectDescription, presentation: c.profile.presentation, link: c.profile.link ?? null,
        },
        video: sub(c._id, SubmissionKind.VIDEO),
        project: sub(c._id, SubmissionKind.PROJECT),
        votes: { free: c.votes?.free ?? 0, paid: c.votes?.paid ?? 0 },
        rank: c.rank ?? null,
    }));
    const stage = e.stage ?? null;
    rows.sort((a, b) => {
        if (stage === CompetitionStage.TOP3) return (a.rank ?? 999) - (b.rank ?? 999);
        if (stage === CompetitionStage.WEEK3) return b.votes.paid - a.votes.paid || (a.seatNumber ?? 0) - (b.seatNumber ?? 0);
        if (stage === CompetitionStage.WEEK2) return b.votes.free - a.votes.free || (a.seatNumber ?? 0) - (b.seatNumber ?? 0);
        return (a.seatNumber ?? 0) - (b.seatNumber ?? 0);
    });
    return {
        editionId: String(e._id), stage, candidates: rows,
        totals: { freeVotes: rows.reduce((s, r) => s + r.votes.free, 0), paidVotes: rows.reduce((s, r) => s + r.votes.paid, 0) },
        builtAt: new Date().toISOString(),
    };
};

/** The board of the live edition, or null before the competition. */
export const currentBoard = async (): Promise<PublicBoard | null> => {
    const e = await ImpactEdition.findOne({ status: { $in: [EditionStatus.COMPETITION, EditionStatus.FINAL] } }).sort({ competitionStartedAt: -1 });
    if (!e || !isPublic(e)) return null;
    if (cache && cache.editionId === String(e._id) && Date.now() - cache.at < TTL_MS) return cache.value;
    const value = await build(e);
    cache = { at: Date.now(), editionId: String(e._id), value };
    return value;
};

/** One public candidate (from the cached board). */
export const publicCandidate = async (id: string): Promise<PublicCandidate> => {
    if (!Types.ObjectId.isValid(id)) throw new AppError('Candidat introuvable.', 404);
    const board = await currentBoard();
    const c = board?.candidates.find((x) => x._id === id);
    if (!c) throw new AppError('Candidat introuvable.', 404);
    return c;
};
