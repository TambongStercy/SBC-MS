import { NextFunction, Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import Event, { EventStatus } from '../../database/models/event.model';
import { AuthenticatedRequest, authenticate, requireLaunched } from '../../api/middleware/auth.middleware';
import { publicReadLimiter } from '../../api/middleware/rate-limit.middleware';
import { AppError } from '../../utils/errors';
import { clientIp } from '../../utils/client-ip';
import logger from '../../utils/logger';
import { getEventUserDetails, lookupEventMember } from '../../services/clients/user.service.client';
import TicketType from '../../database/models/ticket-type.model';
import Organizer from '../../database/models/organizer.model';
import { AnimCandidate, AnimChallenge } from './models/challenge.model';
import { AnimAuditLog, AnimChangeRequest, AnimFraudFlag } from './models/governance.model';
import { AnimReward, AnimRewardDraw } from './models/reward.model';
import { AnimVote, AnimVotePackage, AnimVoteRefund, AnimVoteTransaction } from './models/vote.model';
import { CandidateStatus, ChallengeStatus, ChangeRequestStatus, FraudFlagStatus, Perm, TeamRole } from './types';
import { ctxOf, requireEventRole } from './lib/context';
import { kv } from './lib/kv';
import { PUBLIC_STATUSES, publicCandidate, publicChallenge } from './presenters';
import * as challenges from './services/challenge.service';
import * as candidates from './services/candidate.service';
import * as votes from './services/vote.service';
import * as paid from './services/paid-vote.service';
import * as packages from './services/package.service';
import * as rewards from './services/reward.service';
import * as results from './services/result.service';
import * as team from './services/team.service';
import * as stats from './services/stats.service';
import * as fraud from './services/fraud.service';
import { BOARD_CHANNEL, computeEntries, getBoard } from './services/board.service';
import { ExportFormat, ExportKind, streamExport } from './services/export.service';

const log = logger.getLogger('AnimationRoutes');

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await fn(req, res);
        if (!res.headersSent) res.json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
const uid = (req: Request) => String((req as AuthenticatedRequest).user!.userId);
const page = (req: Request) => ({ page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 24 });
const oid = (v: unknown, what = 'Ressource') => {
    if (!Types.ObjectId.isValid(String(v))) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(String(v));
};

const loadPublicChallenge = async (id: string) => {
    const c = await AnimChallenge.findOne({ _id: oid(id, 'Défi'), status: { $in: PUBLIC_STATUSES } });
    if (!c) throw new AppError('Défi introuvable.', 404);
    return c;
};

// ======================================================================
// Public (no login): discovery, candidates, live board, results, proofs
// ======================================================================

export const publicRouter = Router();
publicRouter.use(publicReadLimiter);

publicRouter.get('/events/:slug/challenges', h(async (req) => {
    const event = await Event.findOne({ slug: req.params.slug, status: { $in: [EventStatus.PUBLISHED, EventStatus.SUSPENDED, EventStatus.COMPLETED] } }).select('_id title slug').lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    const list = await AnimChallenge.find({ eventId: event._id, status: { $in: PUBLIC_STATUSES }, parentChallengeId: { $exists: false } }).sort({ createdAt: 1 }).lean();
    const children = await AnimChallenge.find({ eventId: event._id, status: { $in: PUBLIC_STATUSES }, parentChallengeId: { $exists: true } }).lean();
    const publicRewards = await AnimReward.find({ eventId: event._id, status: { $in: ['ACTIVE', 'EXHAUSTED', 'CLOSED'] } })
        .select('name description imageFileId type customTypeLabel estimatedValue currency quantity quantityAwarded conditionsText challengeId status').lean();
    return { event, challenges: [...list, ...children].map((c) => publicChallenge(c)), rewards: publicRewards };
}));

publicRouter.get('/challenges/:id', h(async (req, res) => {
    const c = await loadPublicChallenge(req.params.id);
    const [event, pkgs, rankRewards] = await Promise.all([
        Event.findById(c.eventId).select('title slug posterFileId startsAt endsAt status city venue').lean(),
        packages.listPackages(String(c._id), true),
        AnimReward.find({ _id: { $in: c.rankRewards.map((r) => r.rewardId) } }).select('name imageFileId type estimatedValue currency').lean(),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=10');
    return publicChallenge(c, {
        event,
        packages: pkgs.map((p) => ({ _id: p._id, label: p.label, votes: p.votes, price: p.price, currency: p.currency, availableFrom: p.availableFrom, availableUntil: p.availableUntil })),
        rankRewards: c.rankRewards.map((r) => ({ rank: r.rank, reward: rankRewards.find((x) => String(x._id) === String(r.rewardId)) })),
    });
}));

publicRouter.get('/events/:slug/challenges/:cslug', h(async (req) => {
    const event = await Event.findOne({ slug: req.params.slug }).select('_id').lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    const c = await AnimChallenge.findOne({ eventId: event._id, slug: req.params.cslug, status: { $in: PUBLIC_STATUSES } }).select('_id').lean();
    if (!c) throw new AppError('Défi introuvable.', 404);
    return { _id: c._id };
}));

publicRouter.get('/challenges/:id/candidates', h(async (req, res) => {
    const c = await loadPublicChallenge(req.params.id);
    const sort = (['number', 'votes', 'recent'] as const).find((s) => s === req.query.sort) ?? 'number';
    const r = await candidates.listCandidates({
        challengeId: String(c._id), statuses: [CandidateStatus.APPROVED], q: req.query.q ? String(req.query.q) : undefined,
        sort: c.voting.showVoteCounts ? sort : sort === 'votes' ? 'number' : sort, ...page(req),
    });
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    return { ...r, items: r.items.map((x) => publicCandidate(x, c.voting.showVoteCounts)) };
}));

publicRouter.get('/challenges/:id/candidates/by-number/:n', h(async (req) => {
    const c = await loadPublicChallenge(req.params.id);
    const cand = await AnimCandidate.findOne({ challengeId: c._id, number: Number(req.params.n), status: { $in: [CandidateStatus.APPROVED, CandidateStatus.DISQUALIFIED, CandidateStatus.WITHDRAWN] } }).lean();
    if (!cand) throw new AppError('Candidat introuvable.', 404);
    return publicCandidate(cand, c.voting.showVoteCounts);
}));

publicRouter.get('/candidates/:id', h(async (req) => {
    const cand = await AnimCandidate.findOne({ _id: oid(req.params.id, 'Candidat'), status: { $in: [CandidateStatus.APPROVED, CandidateStatus.DISQUALIFIED, CandidateStatus.WITHDRAWN] } }).lean();
    if (!cand) throw new AppError('Candidat introuvable.', 404);
    const c = await loadPublicChallenge(String(cand.challengeId));
    return { candidate: publicCandidate(cand, c.voting.showVoteCounts), challenge: publicChallenge(c) };
}));

publicRouter.get('/challenges/:id/board', h(async (req, res) => {
    const c = await loadPublicChallenge(req.params.id);
    const board = await getBoard(String(c._id));
    if (board && req.query.since && Number(req.query.since) === board.version) {
        res.status(304).end();
        return undefined;
    }
    res.setHeader('Cache-Control', 'public, max-age=2, s-maxage=2');
    return board;
}));

// ---------- live stream (SSE, §36) ----------

const streams = { total: 0, perIp: new Map<string, number>() };
const MAX_STREAMS = Number(process.env.ANIMATION_MAX_STREAMS || 5000);
const MAX_STREAMS_PER_IP = 6;

publicRouter.get('/challenges/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const c = await loadPublicChallenge(req.params.id);
        const ip = clientIp(req);
        if (streams.total >= MAX_STREAMS || (streams.perIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
            res.status(429).json({ success: false, message: 'Trop de connexions en direct. Le classement se met à jour toutes les 5 s.', code: 'STREAM_LIMIT' });
            return;
        }
        streams.total++;
        streams.perIp.set(ip, (streams.perIp.get(ip) ?? 0) + 1);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // nginx: don't buffer this response
        });
        res.write('retry: 5000\n\n');
        const send = (event: string, data: string, id?: number) => {
            res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${data}\n\n`);
        };
        const board = await getBoard(String(c._id));
        if (board) send('board', JSON.stringify(board), board.version);
        const unsubscribe = await kv().subscribe(BOARD_CHANNEL(String(c._id)), (msg) => {
            try { send('board', msg, JSON.parse(msg).version); } catch { /* ignore malformed */ }
        });
        // Heartbeat under Cloudflare's ~100 s idle cut and nginx's 300 s read timeout.
        const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => {
            clearInterval(ping);
            unsubscribe().catch(() => undefined);
            streams.total--;
            const left = (streams.perIp.get(ip) ?? 1) - 1;
            if (left <= 0) streams.perIp.delete(ip); else streams.perIp.set(ip, left);
        });
    } catch (err) {
        next(err);
    }
});

publicRouter.get('/challenges/:id/result', h(async (req) => {
    const c = await loadPublicChallenge(req.params.id);
    const r = await results.getResult(String(c._id), { publicOnly: true });
    if (!r) throw new AppError('Résultat pas encore publié.', 404, true, 'NOT_PUBLISHED');
    return {
        challenge: publicChallenge(c), status: r.status, frozenAt: r.frozenAt, publishedAt: r.publishedAt, inputsHash: r.inputsHash,
        tieResolution: r.tieResolution ? { method: r.tieResolution.method, note: r.tieResolution.note, at: r.tieResolution.at } : undefined,
        entries: r.entries.map((e) => ({
            candidateId: e.candidateId, number: e.number, displayName: e.displayName, rank: e.rank, sharedRank: e.sharedRank,
            juryScore: e.juryScore, ...(c.voting.showVoteCounts ? { score: e.score, totalVotes: e.totalVotes } : {}),
        })),
    };
}));

publicRouter.get('/draws/:id/proof', h(async (req) => rewards.drawProof(req.params.id)));

publicRouter.get('/events/:slug/draws', h(async (req) => {
    const event = await Event.findOne({ slug: req.params.slug }).select('_id').lean();
    if (!event) throw new AppError('Événement introuvable.', 404);
    const draws = await AnimRewardDraw.find({ eventId: event._id }).select('rewardId status scheduledAt drawnAt seedCommitment eligibleCount').lean();
    return draws;
}));

// ======================================================================
// Signed-in members: take part, vote, buy votes, my things
// ======================================================================

export const userRouter = Router();

userRouter.get('/challenges/:id/me', h(async (req) => {
    const c = await loadPublicChallenge(req.params.id);
    const userId = uid(req);
    const candidacy = await AnimCandidate.findOne({ challengeId: c._id, userId }).lean();
    const [quota, canParticipate, canVote] = await Promise.all([
        votes.getQuota(c, userId, req.query.candidateId ? String(req.query.candidateId) : undefined),
        candidates.assertCanParticipate(c, userId).then(() => ({ ok: true })).catch((e: AppError) => ({ ok: false, code: e.code, message: e.message })),
        votes.assertCanVote(c, userId).then(() => ({ ok: true })).catch((e: AppError) => ({ ok: false, code: e.code, message: e.message })),
    ]);
    return { candidacy, quota, canParticipate, canVote };
}));

userRouter.post('/challenges/:id/register', h(async (req) => candidates.register(uid(req), req.params.id, req.body ?? {}, clientIp(req))));
userRouter.patch('/candidacies/:id', h(async (req) => candidates.updateOwnProfile(uid(req), req.params.id, req.body ?? {})));
userRouter.post('/candidacies/:id/withdraw', h(async (req) => candidates.withdraw(uid(req), req.params.id)));
userRouter.get('/me/candidacies', h(async (req) => {
    const list = await AnimCandidate.find({ userId: uid(req) }).sort({ createdAt: -1 }).limit(100).lean();
    const cs = await AnimChallenge.find({ _id: { $in: list.map((x) => x.challengeId) } }).select('name slug status eventId voting.showVoteCounts').lean();
    const evs = await Event.find({ _id: { $in: cs.map((x) => x.eventId) } }).select('title slug').lean();
    return list.map((x) => {
        const ch = cs.find((y) => String(y._id) === String(x.challengeId));
        return { ...x, challenge: ch, event: evs.find((e) => String(e._id) === String(ch?.eventId)) };
    });
}));

userRouter.post('/challenges/:id/free-votes', h(async (req) => votes.castFreeVote({
    userId: uid(req), challengeId: req.params.id, candidateId: String(req.body?.candidateId ?? ''), ip: clientIp(req), ua: req.header('user-agent'),
})));

userRouter.post('/challenges/:id/vote-purchases', h(async (req) => {
    const r = await paid.startPurchase({
        userId: uid(req), challengeId: req.params.id, candidateId: String(req.body?.candidateId ?? ''),
        packageId: String(req.body?.packageId ?? ''), idempotencyKey: String(req.body?.idempotencyKey ?? ''),
        ip: clientIp(req), ua: req.header('user-agent'),
    });
    return { transactionId: r.transaction._id, sessionId: r.sessionId, amount: r.transaction.amount, votes: r.transaction.votes, status: r.transaction.status };
}));
userRouter.get('/me/vote-transactions/:id', h(async (req) => paid.getMyTransaction(uid(req), req.params.id)));
userRouter.get('/me/vote-transactions', h(async (req) => {
    const txs = await AnimVoteTransaction.find({ userId: uid(req) })
        .select('challengeId candidateId votes amount status createdAt settledAt lateSettlement refundedAt packageSnapshot').sort({ createdAt: -1 }).limit(100).lean();
    const [cs, cands] = await Promise.all([
        AnimChallenge.find({ _id: { $in: txs.map((t) => t.challengeId) } }).select('name slug eventId').lean(),
        AnimCandidate.find({ _id: { $in: txs.map((t) => t.candidateId) } }).select('displayName number').lean(),
    ]);
    const evs = await Event.find({ _id: { $in: cs.map((c) => c.eventId) } }).select('slug title').lean();
    return txs.map((t) => {
        const ch = cs.find((c) => String(c._id) === String(t.challengeId));
        const cand = cands.find((c) => String(c._id) === String(t.candidateId));
        return {
            ...t,
            challengeName: ch?.name, challengeSlug: ch?.slug,
            eventSlug: evs.find((e) => String(e._id) === String(ch?.eventId))?.slug,
            candidateName: cand?.displayName, candidateNumber: cand?.number,
        };
    });
}));
userRouter.get('/me/rewards', h(async (req) => {
    const wins = await rewards.myRewards(uid(req));
    const rs = await AnimReward.find({ _id: { $in: wins.map((w) => w.rewardId) } }).select('name imageFileId type estimatedValue currency eventId').lean();
    const evs = await Event.find({ _id: { $in: rs.map((r) => r.eventId) } }).select('title slug').lean();
    return wins.map((w) => {
        const r = rs.find((x) => String(x._id) === String(w.rewardId));
        return { ...w, reward: r, event: evs.find((e) => String(e._id) === String(r?.eventId)) };
    });
}));
userRouter.get('/me/teams', h(async (req) => team.myTeams(uid(req))));
userRouter.post('/invites/:token/accept', h(async (req) => team.acceptInvite(uid(req), req.params.token)));

// ======================================================================
// Jury (§23): blind scoring of assigned challenges
// ======================================================================

export const juryRouter = Router();
juryRouter.get('/assignments', h(async (req) => team.myJuryAssignments(uid(req))));
juryRouter.get('/challenges/:id', h(async (req) => team.jurorBoard(uid(req), req.params.id)));
juryRouter.put('/challenges/:id/candidates/:cid/score', h(async (req) => team.saveScore(uid(req), req.params.id, req.params.cid, req.body ?? {})));

// ======================================================================
// Event team (owner / manager / moderator / staff) — everything scoped to :eventId
// ======================================================================

export const manageRouter = Router({ mergeParams: true });
const R = requireEventRole;

manageRouter.get('/me', R(Perm.VIEW), h(async (req) => {
    const ctx = ctxOf(req);
    const event = await Event.findById(ctx.eventId).select('title slug status startsAt endsAt posterFileId').lean();
    return { role: ctx.role, perms: ctx.perms, event };
}));
manageRouter.get('/overview', R(Perm.VIEW), h(async (req) => stats.eventOverview(ctxOf(req))));
manageRouter.get('/members/lookup', R(Perm.VIEW), h(async (req) => {
    const ctx = ctxOf(req);
    if (![Perm.TEAM, Perm.CONFIGURE, Perm.MODERATE].some((p) => ctx.perms.includes(p))) throw new AppError('Votre rôle ne permet pas cette action.', 403);
    return lookupEventMember(String(req.query.contact ?? ''));
}));

// team
manageRouter.get('/team', R(Perm.VIEW), h(async (req) => team.listTeam(ctxOf(req))));
manageRouter.post('/team', R(Perm.TEAM), h(async (req) => team.addTeamMember(ctxOf(req), req.body ?? {})));
manageRouter.delete('/team/:memberId', R(Perm.TEAM), h(async (req) => team.revokeTeamMember(ctxOf(req), req.params.memberId)));
manageRouter.delete('/invites/:inviteId', R(Perm.TEAM), h(async (req) => team.revokeInvite(ctxOf(req), req.params.inviteId)));
// Ticket types of the event, for eligibility pickers (any team role, not just the owner).
manageRouter.get('/ticket-types', R(Perm.VIEW), h(async (req) =>
    TicketType.find({ eventId: ctxOf(req).eventId }).select('name price status quantityTotal quantitySold').sort({ price: 1 }).lean()));

// challenges
manageRouter.get('/challenges', R(Perm.VIEW), h(async (req) => challenges.listChallenges(ctxOf(req))));
manageRouter.post('/challenges', R(Perm.CONFIGURE), h(async (req) => challenges.createChallenge(ctxOf(req), req.body ?? {})));
manageRouter.get('/challenges/:cid', R(Perm.VIEW), h(async (req) => {
    const c = await challenges.loadChallenge(ctxOf(req), req.params.cid);
    const pending = await AnimChangeRequest.find({ targetId: c._id, status: ChangeRequestStatus.PENDING }).lean();
    const errors = await challenges.validateChallenge(c);
    return { challenge: c, pendingChangeRequests: pending, configErrors: errors };
}));
manageRouter.patch('/challenges/:cid', R(Perm.CONFIGURE), h(async (req) => challenges.updateChallenge(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.post('/challenges/:cid/transition', R(Perm.TRANSITION), h(async (req) => {
    const ctx = ctxOf(req);
    await challenges.loadChallenge(ctx, req.params.cid);
    return challenges.transition(ctx, req.params.cid, req.body?.to, { reason: req.body?.reason, manual: true });
}));
manageRouter.post('/challenges/:cid/cancel', R(Perm.CANCEL), h(async (req) => {
    const ctx = ctxOf(req);
    await challenges.loadChallenge(ctx, req.params.cid);
    return challenges.cancelChallenge(ctx, req.params.cid, String(req.body?.reason ?? ''));
}));
manageRouter.post('/challenges/:cid/change-requests', R(Perm.CONFIGURE), h(async (req) =>
    challenges.requestChange(ctxOf(req), req.params.cid, req.body?.patch ?? {}, String(req.body?.reason ?? ''))));
manageRouter.get('/change-requests', R(Perm.VIEW), h(async (req) => AnimChangeRequest.find({ eventId: ctxOf(req).eventId }).sort({ createdAt: -1 }).limit(100).lean()));

// packages
manageRouter.get('/challenges/:cid/packages', R(Perm.VIEW), h(async (req) => {
    await challenges.loadChallenge(ctxOf(req), req.params.cid);
    return packages.listPackages(req.params.cid);
}));
manageRouter.post('/challenges/:cid/packages', R(Perm.CONFIGURE), h(async (req) => packages.createPackage(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.patch('/packages/:pid', R(Perm.CONFIGURE), h(async (req) => packages.updatePackage(ctxOf(req), req.params.pid, req.body ?? {})));
manageRouter.post('/packages/:pid/archive', R(Perm.CONFIGURE), h(async (req) => packages.archivePackage(ctxOf(req), req.params.pid)));

// candidates
manageRouter.get('/challenges/:cid/candidates', R(Perm.VIEW), h(async (req) => {
    const ctx = ctxOf(req);
    await challenges.loadChallenge(ctx, req.params.cid);
    const statuses = req.query.status ? String(req.query.status).split(',').filter((s) => Object.values(CandidateStatus).includes(s as CandidateStatus)) as CandidateStatus[] : undefined;
    const sort = (['number', 'votes', 'recent'] as const).find((s) => s === req.query.sort) ?? 'number';
    return candidates.listCandidates({ challengeId: req.params.cid, eventId: ctx.eventId, statuses, q: req.query.q ? String(req.query.q) : undefined, sort, ...page(req) });
}));
manageRouter.post('/challenges/:cid/candidates', R(Perm.MODERATE), h(async (req) => candidates.addCandidateByOrganizer(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.post('/candidates/:id/:action(approve|reject|disqualify)', R(Perm.MODERATE), h(async (req) =>
    candidates.moderate(ctxOf(req), req.params.id, req.params.action as 'approve' | 'reject' | 'disqualify', req.body?.reason)));

// jury
manageRouter.get('/challenges/:cid/jury', R(Perm.VIEW), h(async (req) => team.listJurors(ctxOf(req), req.params.cid)));
manageRouter.post('/challenges/:cid/jury', R(Perm.CONFIGURE), h(async (req) => team.addJuror(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.delete('/challenges/:cid/jury/:userId', R(Perm.CONFIGURE), h(async (req) => team.removeJuror(ctxOf(req), req.params.cid, req.params.userId)));

// votes and money
manageRouter.get('/challenges/:cid/transactions', R(Perm.MONEY), h(async (req) => {
    const ctx = ctxOf(req);
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = { challengeId: oid(req.params.cid), eventId: new Types.ObjectId(ctx.eventId) };
    if (req.query.status) filter.status = String(req.query.status);
    const [items, total] = await Promise.all([
        AnimVoteTransaction.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).lean(),
        AnimVoteTransaction.countDocuments(filter),
    ]);
    return { items, total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
manageRouter.get('/challenges/:cid/votes', R(Perm.MONEY), h(async (req) => {
    const ctx = ctxOf(req);
    const { page: p, limit } = page(req);
    const filter = { challengeId: oid(req.params.cid), eventId: new Types.ObjectId(ctx.eventId) };
    const [items, total] = await Promise.all([
        AnimVote.find(filter).sort({ at: -1 }).skip((p - 1) * limit).limit(limit).select('-ipHash -uaHash').lean(),
        AnimVote.countDocuments(filter),
    ]);
    return { items, total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
manageRouter.get('/challenges/:cid/board', R(Perm.VIEW), h(async (req) => {
    // The team always sees the real counts, even when they're hidden from the public.
    const c = await challenges.loadChallenge(ctxOf(req), req.params.cid);
    const entries = await computeEntries(c);
    return { challengeId: String(c._id), status: c.status, version: c.boardVersion, showVoteCounts: true, scoringMethod: c.scoring.method,
        totals: { candidates: entries.length, votes: entries.reduce((n, e) => n + e.totalVotes, 0) }, entries };
}));
manageRouter.get('/challenges/:cid/history', R(Perm.VIEW), h(async (req) => {
    await challenges.loadChallenge(ctxOf(req), req.params.cid);
    return stats.boardHistory(req.params.cid, req.query.candidateId ? String(req.query.candidateId) : undefined);
}));

// results
manageRouter.get('/challenges/:cid/result', R(Perm.VIEW), h(async (req) => {
    await challenges.loadChallenge(ctxOf(req), req.params.cid);
    return results.getResult(req.params.cid);
}));
manageRouter.post('/challenges/:cid/result/compute', R(Perm.RESULTS), h(async (req) => {
    const ctx = ctxOf(req);
    const c = await challenges.loadChallenge(ctx, req.params.cid);
    if (c.status !== ChallengeStatus.RESULTS_PENDING) throw new AppError('Le calcul se fait après la clôture des votes.', 409);
    return results.computeResult(ctx, c._id);
}));
manageRouter.post('/challenges/:cid/result/resolve-tie', R(Perm.RESULTS), h(async (req) => results.resolveTie(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.post('/challenges/:cid/result/second-round', R(Perm.RESULTS), h(async (req) => results.startSecondRound(ctxOf(req), req.params.cid, req.body ?? {})));
manageRouter.post('/challenges/:cid/result/freeze', R(Perm.RESULTS), h(async (req) => results.freezeResult(ctxOf(req), req.params.cid, { eventId: ctxOf(req).eventId })));
manageRouter.post('/challenges/:cid/result/publish', R(Perm.RESULTS), h(async (req) => results.publishResult(ctxOf(req), req.params.cid)));

// rewards
manageRouter.get('/rewards', R(Perm.VIEW), h(async (req) => rewards.listRewards(ctxOf(req))));
manageRouter.post('/rewards', R(Perm.CONFIGURE), h(async (req) => rewards.createReward(ctxOf(req), req.body ?? {})));
manageRouter.patch('/rewards/:rid', R(Perm.CONFIGURE), h(async (req) => rewards.updateReward(ctxOf(req), req.params.rid, req.body ?? {})));
manageRouter.post('/rewards/:rid/cancel', R(Perm.CONFIGURE), h(async (req) => rewards.cancelReward(ctxOf(req), req.params.rid, String(req.body?.reason ?? ''))));
manageRouter.get('/rewards/:rid/rules', R(Perm.VIEW), h(async (req) => rewards.listRules(ctxOf(req), req.params.rid)));
manageRouter.post('/rewards/:rid/rules', R(Perm.CONFIGURE), h(async (req) => rewards.createRuleVersion(ctxOf(req), req.params.rid, req.body ?? {})));
manageRouter.post('/rules/:ruleId/activate', R(Perm.CONFIGURE), h(async (req) => rewards.activateRule(ctxOf(req), req.params.ruleId)));
manageRouter.post('/rules/:ruleId/request-change', R(Perm.CONFIGURE), h(async (req) => rewards.requestRuleChange(ctxOf(req), req.params.ruleId, String(req.body?.reason ?? ''))));
manageRouter.post('/rules/:ruleId/draw', R(Perm.CONFIGURE), h(async (req) => rewards.drawNow(ctxOf(req), req.params.ruleId)));
manageRouter.get('/draws', R(Perm.VIEW), h(async (req) => AnimRewardDraw.find({ eventId: ctxOf(req).eventId }).lean()));
manageRouter.get('/winners', R(Perm.VIEW), h(async (req) => {
    const list = await rewards.listWinners(ctxOf(req), req.query.rewardId ? String(req.query.rewardId) : undefined);
    const users = await getEventUserDetails([...new Set(list.map((w) => String(w.userId)))]).catch(() => []);
    // Whoever hands the prize over needs the winner's contact; other roles get the name only.
    const contact = ctxOf(req).perms.includes(Perm.CONFIGURE);
    return list.map((w) => {
        const u = users.find((x) => String(x._id) === String(w.userId));
        return { ...w, userName: u?.name, ...(contact ? { userPhone: u?.phoneNumber, userEmail: u?.email } : {}) };
    });
}));
manageRouter.get('/rewards/:rid', R(Perm.VIEW), h(async (req) => {
    const r = await AnimReward.findOne({ _id: oid(req.params.rid, 'Récompense'), eventId: ctxOf(req).eventId }).lean();
    if (!r) throw new AppError('Récompense introuvable.', 404);
    return r;
}));
manageRouter.post('/rewards/:rid/award', R(Perm.CONFIGURE), h(async (req) => rewards.manualAward(ctxOf(req), req.params.rid, req.body ?? {})));
manageRouter.post('/winners/:wid/:action(deliver|forfeit|revoke)', R(Perm.CONFIGURE), h(async (req) =>
    rewards.setWinnerStatus(ctxOf(req), req.params.wid, req.params.action as 'deliver' | 'forfeit' | 'revoke', req.body ?? {})));

// audit and exports
manageRouter.get('/audit', R(Perm.VIEW), h(async (req) => {
    const ctx = ctxOf(req);
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = { eventId: new Types.ObjectId(ctx.eventId) };
    if (req.query.challengeId && Types.ObjectId.isValid(String(req.query.challengeId))) filter.challengeId = new Types.ObjectId(String(req.query.challengeId));
    const [items, total] = await Promise.all([
        AnimAuditLog.find(filter).sort({ at: -1 }).skip((p - 1) * limit).limit(limit).select('-ip').lean(),
        AnimAuditLog.countDocuments(filter),
    ]);
    return { items, total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
manageRouter.get('/exports/:kind.:format', R(Perm.EXPORT), async (req, res, next) => {
    try {
        const ctx = ctxOf(req);
        const challengeId = req.query.challengeId ? String(req.query.challengeId) : undefined;
        if (challengeId) await challenges.loadChallenge(ctx, challengeId);
        if (['transactions', 'votes'].includes(req.params.kind) && !ctx.perms.includes(Perm.MONEY)) throw new AppError('Votre rôle ne permet pas cet export.', 403);
        await streamExport(res, req.params.kind as ExportKind, req.params.format as ExportFormat, { eventId: ctx.eventId, challengeId });
    } catch (err) {
        if (res.headersSent) { log.error(`export failed mid-stream: ${(err as Error).message}`); res.end(); } else next(err);
    }
});

// ======================================================================
// SBC administration (§20, §41): mounted under /tickets/admin/animation
// ======================================================================

export const adminRouter = Router();
const adminActor = (req: Request) => ({ actorUserId: uid(req), role: TeamRole.SBC_ADMIN, ip: clientIp(req) });

adminRouter.get('/stats', h(async (req) => stats.globalStats({
    from: req.query.from ? new Date(String(req.query.from)) : undefined, to: req.query.to ? new Date(String(req.query.to)) : undefined,
})));
adminRouter.get('/challenges', h(async (req) => {
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) filter.name = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const [items, total] = await Promise.all([
        AnimChallenge.find(filter).sort({ updatedAt: -1 }).skip((p - 1) * limit).limit(limit).lean(),
        AnimChallenge.countDocuments(filter),
    ]);
    const evs = await Event.find({ _id: { $in: items.map((i) => i.eventId) } }).select('title slug').lean();
    return { items: items.map((i) => ({ ...i, event: evs.find((e) => String(e._id) === String(i.eventId)) })), total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
adminRouter.get('/challenges/:id', h(async (req) => {
    const doc = await AnimChallenge.findById(oid(req.params.id, 'Défi'));
    if (!doc) throw new AppError('Défi introuvable.', 404);
    const [event, entries, result, flags] = await Promise.all([
        Event.findById(doc.eventId).select('title slug status').lean(),
        // SBC sees the real counts, even when the organizer hides them from the public.
        computeEntries(doc),
        results.getResult(String(doc._id)),
        AnimFraudFlag.find({ challengeId: doc._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return { challenge: doc.toObject(), event, board: { entries: entries.slice(0, 50), totals: { candidates: entries.length, votes: entries.reduce((n, e) => n + e.totalVotes, 0) } }, result, flags };
}));
adminRouter.post('/challenges/:id/:action(suspend|resume)', h(async (req) =>
    challenges.setSuspended(adminActor(req), req.params.id, req.params.action === 'suspend', req.body?.reason)));
adminRouter.post('/challenges/:id/cancel', h(async (req) => challenges.cancelChallenge(adminActor(req), req.params.id, String(req.body?.reason ?? ''))));
adminRouter.post('/challenges/:id/freeze', h(async (req) => results.freezeResult(adminActor(req), req.params.id)));

adminRouter.get('/fraud', h(async (req) => {
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = { status: req.query.status ? String(req.query.status) : FraudFlagStatus.OPEN };
    const [items, total] = await Promise.all([
        AnimFraudFlag.find(filter).sort({ score: -1, updatedAt: -1 }).skip((p - 1) * limit).limit(limit).lean(),
        AnimFraudFlag.countDocuments(filter),
    ]);
    const cs = await AnimChallenge.find({ _id: { $in: items.map((i) => i.challengeId) } }).select('name eventId').lean();
    // A readable subject: who the account is, whose purchase, which candidate.
    const ids = (t: string) => items.filter((i) => i.subjectType === t && Types.ObjectId.isValid(i.subjectId)).map((i) => i.subjectId);
    const [txs, cands] = await Promise.all([
        AnimVoteTransaction.find({ _id: { $in: ids('TRANSACTION') } }).select('userId amount currency').lean(),
        AnimCandidate.find({ _id: { $in: ids('CANDIDATE') } }).select('displayName number').lean(),
    ]);
    const userIds = [...new Set([...ids('USER'), ...txs.map((t) => String(t.userId))])];
    const users = userIds.length ? await getEventUserDetails(userIds).catch(() => []) : [];
    const userLabel = (id: string) => {
        const u = users.find((x) => String(x._id) === id);
        return u ? [u.name, u.phoneNumber || u.email].filter(Boolean).join(' · ') : undefined;
    };
    const subjectLabel = (i: (typeof items)[number]) => {
        if (i.subjectType === 'USER') return userLabel(i.subjectId);
        if (i.subjectType === 'TRANSACTION') {
            const t = txs.find((x) => String(x._id) === i.subjectId);
            return t ? `${userLabel(String(t.userId)) ?? 'Compte inconnu'} · ${t.amount} ${t.currency}` : undefined;
        }
        if (i.subjectType === 'CANDIDATE') {
            const c = cands.find((x) => String(x._id) === i.subjectId);
            return c ? `n°${c.number} · ${c.displayName}` : undefined;
        }
        return undefined;
    };
    return {
        items: items.map((i) => ({ ...i, subjectLabel: subjectLabel(i), challenge: cs.find((c) => String(c._id) === String(i.challengeId)) })),
        total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
    };
}));
adminRouter.post('/fraud/:id/review', h(async (req) => {
    const decision = req.body?.decision === 'confirm' ? 'confirm' : req.body?.decision === 'clear' ? 'clear' : null;
    if (!decision) throw new AppError('Décision invalide.', 400);
    return fraud.reviewFlag(uid(req), req.params.id, decision, {
        note: req.body?.note, voidVotes: Boolean(req.body?.voidVotes), refund: Boolean(req.body?.refund), disqualify: Boolean(req.body?.disqualify),
    });
}));

adminRouter.get('/change-requests', h(async (req) => {
    const list = await AnimChangeRequest.find({ status: req.query.status ? String(req.query.status) : ChangeRequestStatus.PENDING }).sort({ createdAt: 1 }).limit(200).lean();
    // Everything the reviewer needs in words: what is changed, by whom, and the
    // names behind ids inside the before/after values (ticket types, rewards…).
    // Diff values come back as strings or ObjectIds (ids saved inside Mixed).
    const asId = (v: unknown) => (v instanceof Types.ObjectId ? String(v) : typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? v : null);
    const valueIds = new Set<string>();
    const collect = (v: unknown) => {
        const id = asId(v);
        if (id) valueIds.add(id);
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(collect);
    };
    for (const l of list) for (const d of l.diff ?? []) { collect(d.from); collect(d.to); }
    const ids = (pick: (l: (typeof list)[number]) => unknown) => list.map(pick).filter(Boolean).map(String);
    const target = (t: string) => ids((l) => (l.targetType === t ? l.targetId : null));
    const values = [...valueIds];
    const [evs, orgs, chs, rws, pks, tts, users] = await Promise.all([
        Event.find({ _id: { $in: ids((l) => l.eventId) } }).select('title slug').lean(),
        Organizer.find({ _id: { $in: ids((l) => l.organizerId) } }).select('displayName').lean(),
        AnimChallenge.find({ _id: { $in: [...target('CHALLENGE'), ...values] } }).select('name').lean(),
        AnimReward.find({ _id: { $in: [...target('REWARD'), ...values] } }).select('name').lean(),
        AnimVotePackage.find({ _id: { $in: [...target('PACKAGE'), ...values] } }).select('label').lean(),
        TicketType.find({ _id: { $in: values } }).select('name').lean(),
        getEventUserDetails([...new Set([...ids((l) => l.requestedBy), ...ids((l) => l.reviewedBy)])]).catch(() => []),
    ]);
    const names = new Map<string, string>([
        ...chs.map((x) => [String(x._id), x.name] as [string, string]),
        ...rws.map((x) => [String(x._id), x.name] as [string, string]),
        ...pks.map((x) => [String(x._id), x.label] as [string, string]),
        ...tts.map((x) => [String(x._id), `Billet ${x.name}`] as [string, string]),
    ]);
    const person = (id?: unknown) => {
        const u = id ? users.find((x) => String(x._id) === String(id)) : undefined;
        return u ? { name: u.name, contact: u.phoneNumber || u.email } : undefined;
    };
    return list.map((l) => ({
        ...l,
        event: evs.find((e) => String(e._id) === String(l.eventId)),
        organizerName: orgs.find((o) => String(o._id) === String(l.organizerId))?.displayName,
        targetName: names.get(String(l.targetId)),
        requester: person(l.requestedBy),
        reviewer: person(l.reviewedBy),
        valueNames: Object.fromEntries(values.filter((v) => names.has(v)).map((v) => [v, names.get(v)!])),
    }));
}));
adminRouter.post('/change-requests/:id/review', h(async (req) => challenges.reviewChange(adminActor(req), req.params.id, Boolean(req.body?.approve), req.body?.note)));

adminRouter.get('/transactions', h(async (req) => {
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.review) filter['fraud.review'] = String(req.query.review);
    if (req.query.challengeId && Types.ObjectId.isValid(String(req.query.challengeId))) filter.challengeId = new Types.ObjectId(String(req.query.challengeId));
    const [items, total] = await Promise.all([
        AnimVoteTransaction.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).lean(),
        AnimVoteTransaction.countDocuments(filter),
    ]);
    const cs = await AnimChallenge.find({ _id: { $in: [...new Set(items.map((i) => String(i.challengeId)))] } }).select('name eventId').lean();
    const evs = await Event.find({ _id: { $in: cs.map((c) => c.eventId) } }).select('title slug').lean();
    const enriched = items.map((i) => {
        const ch = cs.find((c) => String(c._id) === String(i.challengeId));
        return { ...i, challengeName: ch?.name, eventTitle: evs.find((e) => String(e._id) === String(ch?.eventId))?.title };
    });
    return { items: enriched, total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
// Refunds whose money side hasn't completed (the job retries them; SBC can see and force a retry).
adminRouter.get('/refunds', h(async (req) => {
    const status = req.query.status ? String(req.query.status).split(',') : ['PENDING', 'FAILED'];
    return AnimVoteRefund.find({ status: { $in: status } }).sort({ updatedAt: -1 }).limit(200).lean();
}));
adminRouter.post('/refunds/:txId/retry', h(async (req) => {
    await paid.processRefundMoney(oid(req.params.txId, 'Remboursement'));
    return AnimVoteRefund.findOne({ voteTransactionId: req.params.txId }).lean();
}));
adminRouter.post('/transactions/:id/refund', h(async (req) => paid.adminRefund(uid(req), req.params.id, String(req.body?.reason ?? ''))));

adminRouter.get('/audit', h(async (req) => {
    const { page: p, limit } = page(req);
    const filter: Record<string, unknown> = {};
    for (const k of ['eventId', 'challengeId']) if (req.query[k] && Types.ObjectId.isValid(String(req.query[k]))) filter[k] = new Types.ObjectId(String(req.query[k]));
    if (req.query.action) filter.action = String(req.query.action);
    const [items, total] = await Promise.all([
        AnimAuditLog.find(filter).sort({ at: -1 }).skip((p - 1) * limit).limit(limit).lean(),
        AnimAuditLog.countDocuments(filter),
    ]);
    return { items, total, page: p, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}));
adminRouter.get('/exports/:kind.:format', async (req, res, next) => {
    try {
        await streamExport(res, req.params.kind as ExportKind, req.params.format as ExportFormat, {
            eventId: req.query.eventId ? String(req.query.eventId) : undefined, challengeId: req.query.challengeId ? String(req.query.challengeId) : undefined,
        });
    } catch (err) {
        if (res.headersSent) res.end(); else next(err);
    }
});

/** Mounts everything (called from api/routes/index.ts). */
export const mountAnimation = (router: Router) => {
    router.use('/tickets/animation/public', publicRouter);
    router.use('/tickets/animation/manage/events/:eventId', authenticate, requireLaunched, manageRouter);
    router.use('/tickets/animation/jury', authenticate, requireLaunched, juryRouter);
    router.use('/tickets/animation', authenticate, requireLaunched, userRouter);
};

