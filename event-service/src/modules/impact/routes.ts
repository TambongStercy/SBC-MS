import { NextFunction, Request, Response, Router } from 'express';
import { AuthenticatedRequest, authenticate, authorizeAdmin } from '../../api/middleware/auth.middleware';
import { publicReadLimiter } from '../../api/middleware/rate-limit.middleware';
import { AppError } from '../../utils/errors';
import { kv } from '../animation/lib/kv';
import { clientIp } from '../../utils/client-ip';
import { Actor } from './lib';
import { requireAdminStepUp } from './stepup';
import * as editions from './services/edition.service';
import * as candidates from './services/candidate.service';
import * as stages from './services/stage.service';
import * as submissions from './services/submission.service';
import * as votes from './services/vote.service';
import * as board from './services/board.service';

/**
 * SBC Impact Challenge v2 routes (gateway: /api/tickets/impact/*).
 *  - /tickets/impact/public/*  no login (the current edition and its rules)
 *  - /tickets/impact/me*       the signed-in member's candidate space
 *  - /tickets/impact/admin/*   administration (gateway module `impactChallenge`)
 */

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
const admin = (req: Request): Actor => ({ role: 'admin', userId: uid(req) });
const reasonOf = (req: Request) => String(req.body?.reason ?? '');
const signals = (req: Request) => ({ ip: clientIp(req), ua: String(req.headers['user-agent'] ?? '').slice(0, 300) });

/** At most `n` calls per `windowSec` for this member and action. */
const throttle = (action: string, n: number, windowSec: number) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
        const hits = await kv().hit(`impact:${action}:${uid(req)}`, windowSec);
        if (hits > n) {
            // The window is fixed from its first hit, so this is the longest possible wait.
            return next(new AppError(`Trop de demandes. Réessayez dans ${windowSec} secondes.`, 429, true, 'TOO_MANY_REQUESTS', { retryAfterSeconds: windowSec }));
        }
        next();
    } catch {
        next(); // a KV hiccup must not lock members out
    }
};

// ---------- Public ----------

export const publicRouter = Router();
publicRouter.use(publicReadLimiter);
publicRouter.get('/current', h(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=15');
    return editions.currentPublic();
}));
// The competition's public board (published candidates, contents, counts), cached 10 s.
publicRouter.get('/board', h(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=10');
    return board.currentBoard();
}));
publicRouter.get('/candidates/:id', h(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=10');
    return board.publicCandidate(req.params.id);
}));

// ---------- Member ----------

export const memberRouter = Router();
memberRouter.get('/me', h(async (req) => candidates.mySpace(uid(req))));
memberRouter.post('/me/candidacy', throttle('apply', 5, 60), h(async (req) => candidates.apply(uid(req), req.body ?? {})));
memberRouter.patch('/me/candidacy', throttle('edit', 20, 60), h(async (req) => candidates.updateMine(uid(req), req.body ?? {})));
memberRouter.post('/me/candidacy/refresh', throttle('refresh', 1, 20), h(async (req) => candidates.refreshMine(uid(req))));
memberRouter.post('/me/candidacy/withdraw', throttle('withdraw', 3, 60), h(async (req) => candidates.withdrawMine(uid(req))));
memberRouter.post('/me/submissions/:kind', throttle('submit', 10, 60), h(async (req) => submissions.submitMine(uid(req), req.params.kind, req.body ?? {})));
memberRouter.post('/free-votes', throttle('free-vote', 10, 60), h(async (req) => votes.castFreeVote(uid(req), req.body ?? {}, signals(req))));
memberRouter.post('/vote-purchases', throttle('purchase', 10, 60), h(async (req) => votes.startPurchase(uid(req), req.body ?? {}, signals(req))));
memberRouter.get('/me/votes', h(async (req) => votes.myVotes(uid(req))));
memberRouter.get('/me/vote-purchases/:id', h(async (req) => votes.getMyPurchase(uid(req), req.params.id)));

// ---------- Administration ----------

export const adminRouter = Router();
adminRouter.get('/editions', h(async () => editions.listEditions()));
adminRouter.post('/editions', h(async (req) => editions.adminEdition(await editions.createEdition(admin(req), req.body ?? {}))));
adminRouter.get('/editions/:id', h(async (req) => editions.adminEdition(await editions.getEdition(req.params.id))));
adminRouter.patch('/editions/:id', h(async (req) => editions.adminEdition(await editions.updateEdition(admin(req), req.params.id, req.body ?? {}))));
adminRouter.post('/editions/:id/open-qualification', h(async (req) => editions.adminEdition(await editions.openQualification(admin(req), req.params.id))));
adminRouter.post('/editions/:id/close-qualification', h(async (req) => editions.adminEdition(await editions.requestCloseQualification(admin(req), req.params.id, reasonOf(req)))));
adminRouter.post('/editions/:id/cancel', h(async (req) => editions.adminEdition(await editions.cancelEdition(admin(req), req.params.id, reasonOf(req)))));
adminRouter.post('/editions/:id/recount', h(async (req) => candidates.recountEdition(admin(req), req.params.id)));
adminRouter.get('/editions/:id/candidates', h(async (req) => candidates.listCandidates(req.params.id, req.query)));
adminRouter.post('/editions/:id/candidates', h(async (req) => candidates.adminAdd(admin(req), req.params.id, req.body ?? {})));
adminRouter.get('/editions/:id/audit', h(async (req) => candidates.editionAudit(req.params.id, req.query)));
adminRouter.get('/candidates/:id', h(async (req) => candidates.getCandidateForAdmin(req.params.id)));
adminRouter.patch('/candidates/:id', h(async (req) => candidates.adminEditProfile(admin(req), req.params.id, req.body ?? {})));
adminRouter.post('/candidates/:id/review', h(async (req) => candidates.reviewProfile(admin(req), req.params.id, req.body ?? {})));
adminRouter.post('/candidates/:id/suspend', h(async (req) => candidates.suspend(admin(req), req.params.id, req.body ?? {})));
adminRouter.post('/candidates/:id/reinstate', h(async (req) => candidates.reinstate(admin(req), req.params.id, req.body ?? {})));
adminRouter.post('/candidates/:id/disqualify', h(async (req) => candidates.disqualify(admin(req), req.params.id, req.body ?? {})));

// ----- Phase 2: weeks, rounds, contents, votes, TOP 3 -----
adminRouter.post('/editions/:id/launch-competition', h(async (req) => editions.adminEdition(await stages.launchCompetition(admin(req), req.params.id))));
adminRouter.post('/editions/:id/advance-stage', h(async (req) => editions.adminEdition(await stages.advanceStage(admin(req), req.params.id))));
adminRouter.put('/editions/:id/rounds/:key', h(async (req) => editions.adminEdition(await stages.scheduleRound(admin(req), req.params.id, req.params.key, req.body ?? {}))));
adminRouter.post('/editions/:id/rounds/:key/open', h(async (req) => editions.adminEdition(await stages.openRoundNow(admin(req), req.params.id, req.params.key))));
adminRouter.post('/editions/:id/rounds/:key/close', h(async (req) => editions.adminEdition(await stages.closeRoundNow(admin(req), req.params.id, req.params.key, reasonOf(req)))));
adminRouter.get('/editions/:id/top3', h(async (req) => stages.top3Preview(req.params.id)));
adminRouter.post('/editions/:id/top3', requireAdminStepUp('impact_top3'), h(async (req) => {
    const r = await stages.top3Confirm(admin(req), req.params.id, req.body ?? {});
    return { edition: editions.adminEdition(r.edition), ranking: r.ranking };
}));
adminRouter.get('/editions/:id/submissions', h(async (req) => submissions.listSubmissions(req.params.id, req.query)));
adminRouter.post('/submissions/:id/review', h(async (req) => submissions.reviewSubmission(admin(req), req.params.id, req.body ?? {})));
adminRouter.patch('/submissions/:id', h(async (req) => submissions.setExternalUrl(admin(req), req.params.id, req.body ?? {})));
adminRouter.get('/editions/:id/free-votes', h(async (req) => votes.listFreeVotes(req.params.id, req.query)));
adminRouter.get('/editions/:id/purchases', h(async (req) => votes.listPurchases(req.params.id, req.query)));
adminRouter.post('/purchases/:id/refund', requireAdminStepUp('impact_vote_refund'), h(async (req) => votes.refundPurchase(admin(req), req.params.id, req.body ?? {})));
adminRouter.get('/editions/:id/anomalies', h(async (req) => votes.anomalies(req.params.id)));
adminRouter.get('/editions/:id/candidates.csv', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const csv = await candidates.exportCandidatesCsv(req.params.id);
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="candidats-sbc-impact.csv"');
        res.send(csv);
    } catch (err) {
        next(err);
    }
});

export const mountImpact = (router: Router) => {
    router.use('/tickets/impact/public', publicRouter);
    router.use('/tickets/impact/admin', authenticate, authorizeAdmin, adminRouter);
    router.use('/tickets/impact', authenticate, memberRouter);
};
