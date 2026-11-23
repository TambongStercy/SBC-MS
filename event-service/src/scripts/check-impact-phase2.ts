/**
 * SBC Impact Challenge v2, Phase 2 — weeks 1–3, submissions, free and paid
 * votes, refunds, TOP 3. End-to-end against a real MongoDB; user-service,
 * payment-service and notifications stubbed (the stubs keep the same
 * exactly-once-per-reference behaviour as the real services).
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_impact2_check \
 *     npx ts-node --transpile-only src/scripts/check-impact-phase2.ts
 */
process.env.REDIS_KEY_PREFIX = `impact2-check-${Date.now()}:`;
import mongoose, { Types } from 'mongoose';
import * as userClient from '../services/clients/user.service.client';
import * as paymentClient from '../services/clients/payment.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import { ImpactCandidate, ImpactEdition, ImpactFreeVote, ImpactSubmission, ImpactVoteTx } from '../modules/impact/models';
import {
    CandidateStatus, CompetitionStage, EditionStatus, PayMethod, RoundStatus, SubmissionStatus, VoteTxStatus,
} from '../modules/impact/types';
import * as editions from '../modules/impact/services/edition.service';
import * as candidates from '../modules/impact/services/candidate.service';
import * as stages from '../modules/impact/services/stage.service';
import * as submissions from '../modules/impact/services/submission.service';
import * as votes from '../modules/impact/services/vote.service';
import * as board from '../modules/impact/services/board.service';
import { qualificationTick } from '../modules/impact/services/qualification.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_impact2_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };

// ---------- stubs ----------
const members = new Map<string, { isMember: boolean; createdAt: Date }>();
(userClient as any).getImpactMembers = async (ids: string[]) => ids.filter((id) => members.has(id)).map((id) => ({
    _id: id, name: `M${id.slice(-4)}`, referralCode: `c${id.slice(-4)}`, isMember: members.get(id)!.isMember, unavailable: false, createdAt: members.get(id)!.createdAt.toISOString(),
}));
(userClient as any).getImpactInvitations = async (a: { referrerIds: string[] }) =>
    a.referrerIds.map((id) => ({ referrerId: id, valid: 1, pending: 0, reachedAt: new Date(Date.now() - 3_600_000 + Number(`0x${id.slice(-4)}`) % 1000).toISOString() }));
(userClient as any).getEventUserDetails = async (ids: string[]) => ids.map((id) => ({ _id: id, name: `Buyer ${id.slice(-3)}` }));
const pushes: { kind: string; userId?: string }[] = [];
(notificationClient as any).notifyUser = async (a: any) => { pushes.push({ kind: a.kind, userId: a.userId }); return 1; };

let sess = 0;
const intents = new Map<string, { status: string; amount: number }>();
(paymentClient as any).createImpactVoteIntent = async (a: any) => { const id = `sess-${++sess}`; intents.set(id, { status: 'PENDING', amount: a.amount }); return { sessionId: id }; };
(paymentClient as any).getPaymentIntentState = async (id: string) => (intents.has(id) ? { sessionId: id, ...intents.get(id)!, currency: 'XAF', paymentType: 'IMPACT_VOTE' } : null);
const balances = new Map<string, number>();
const spends = new Map<string, number>(); // reference -> amount (exactly once)
const spendCalls: string[] = [];
let failNextSpend = false;
(paymentClient as any).spendFromBalance = async (a: { userId: string; amount: number; reference: string }) => {
    spendCalls.push(a.reference);
    if (failNextSpend) { failNextSpend = false; throw new Error('socket hang up'); }
    if (spends.has(a.reference)) return { transactionId: `t-${a.reference}`, amount: a.amount };
    const b = balances.get(a.userId) ?? 0;
    if (b < a.amount) throw new (paymentClient as any).InsufficientBalanceError();
    balances.set(a.userId, b - a.amount);
    spends.set(a.reference, a.amount);
    return { transactionId: `t-${a.reference}`, amount: a.amount };
};
const balanceRefunds = new Set<string>();
(paymentClient as any).refundBalanceSpend = async (a: { userId: string; reference: string }) => {
    if (!spends.has(a.reference) || balanceRefunds.has(a.reference)) return null;
    balanceRefunds.add(a.reference);
    balances.set(a.userId, (balances.get(a.userId) ?? 0) + spends.get(a.reference)!);
    return {};
};
const deposits = new Map<string, number>();
(paymentClient as any).creditBuyerBalance = async (a: { userId: string; amount: number; reference: string }) => {
    if (!deposits.has(a.reference)) { deposits.set(a.reference, a.amount); balances.set(a.userId, (balances.get(a.userId) ?? 0) + a.amount); }
    return { transactionId: `d-${a.reference}`, status: 'completed' };
};

const ADMIN = { role: 'admin' as const, userId: new Types.ObjectId().toString() };
const RULES = 'Règlement du SBC Impact Challenge. '.repeat(10);
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const ahead = (min: number) => new Date(Date.now() + min * 60_000);
const member = (opts: { isMember?: boolean; createdAt?: Date } = {}) => {
    const id = new Types.ObjectId().toString();
    members.set(id, { isMember: opts.isMember ?? true, createdAt: opts.createdAt ?? new Date('2026-01-01') });
    return id;
};
const profile = (n: string) => ({
    consent: true, name: `Candidat ${n}`, photoFileId: `avatars/${n}.jpg`, country: 'Cameroun', city: 'Douala',
    activity: 'Commerce', category: 'Commerce', projectName: `Projet ${n}`,
    projectDescription: 'Un projet qui transforme les produits agricoles locaux.',
    presentation: 'Nous achetons aux producteurs, transformons et vendons en ligne et en boutique, avec un impact direct sur les revenus.',
});
const PROJECT = {
    problem: 'Les productrices vendent leur manioc à perte faute de transformation.',
    solution: 'Un atelier qui transforme et emballe le manioc pour les supermarchés.',
    howItWorks: 'Achat aux productrices, transformation, emballage, livraison en ville.',
    targetCustomers: 'Supermarchés et familles de Douala et Yaoundé.',
    businessModel: 'Marge sur la vente en gros et au détail des produits transformés.',
    expectedImpact: 'Quarante productrices mieux payées et dix emplois créés.',
    fundingUse: 'Une deuxième presse et un véhicule de livraison réfrigéré.',
    outlook: 'Ouvrir un second atelier à Bafoussam dans deux ans.',
};
const cand = (userId: string) => ImpactCandidate.findOne({ userId: new Types.ObjectId(userId) });
const paidOf = async (userId: string) => (await cand(userId))!.votes?.paid ?? 0;
const key = () => `k${new Types.ObjectId().toHexString()}`;
const sig = { ip: '41.202.1.1', ua: 'Mozilla/5.0 test' };

const main = async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([ImpactEdition, ImpactCandidate, ImpactSubmission, ImpactFreeVote, ImpactVoteTx].map((m) => m.init()));

    // ---------- Qualification (Phase 1) to get 4 officials ----------
    const e = await editions.createEdition(ADMIN, {
        name: 'Édition phase 2', rulesText: RULES,
        schedule: { qualificationOpensAt: ago(120), qualificationClosesAt: ahead(60 * 24) },
        settings: { maxCandidates: 4, invitationsRequired: 1, waitlistSize: 0, finalistsCount: 2, votePacks: [{ votes: 1, price: 200 }, { votes: 5, price: 1000 }, { votes: 10, price: 2000 }] },
    });
    check('new settings take their defaults', e.settings.freeVote.membersOnly === true && e.settings.balancePayment === true && e.settings.settlementGraceMin === 15);
    await editions.openQualification(ADMIN, String(e._id));
    const [A, B, C, D] = [member(), member(), member(), member()];
    for (const [id, n] of [[A, 'a'], [B, 'b'], [C, 'c'], [D, 'd']] as const) await candidates.apply(id, profile(n));
    await qualificationTick();
    const closed = await ImpactEdition.findById(e._id);
    check('4 officials, qualification closed', closed?.status === EditionStatus.QUALIFICATION_CLOSED && (await ImpactCandidate.countDocuments({ status: CandidateStatus.OFFICIAL })) === 4);

    // ---------- Launch: profiles must be validated ----------
    const notReviewed = await refusal(() => stages.launchCompetition(ADMIN, String(e._id)));
    check('launch refused while official profiles are not validated', notReviewed?.code === 'PROFILES_TO_REVIEW' && notReviewed.details.candidates.length === 4);
    for (const id of [A, B, C, D]) {
        const c = (await cand(id))!;
        await candidates.reviewProfile(ADMIN, String(c._id), { decision: 'approve' });
    }
    const launched = await stages.launchCompetition(ADMIN, String(e._id));
    check('competition starts in week 1', launched.status === EditionStatus.COMPETITION && launched.stage === CompetitionStage.WEEK1);
    check('official profiles are published', (await ImpactCandidate.countDocuments({ publishedAt: { $exists: true } })) === 4);
    const b1 = await board.currentBoard();
    check('public board lists the 4 in seat order', b1?.candidates.length === 4 && b1.candidates.map((c) => c.seatNumber).join() === '1,2,3,4');
    check('the public board carries no member id', !JSON.stringify(b1).includes(A));

    // ---------- Week 2 video ----------
    check('a video id must be a stored file', (await refusal(() => submissions.submitMine(A, 'video', { videoFileId: 'https://x.y/v.mp4' })))?.code === 'INVALID_SUBMISSION');
    const vA = await submissions.submitMine(A, 'video', { videoFileId: 'videos/a.mp4', caption: 'Ma vision' });
    check('video submitted, waiting for validation', vA.status === SubmissionStatus.PENDING && vA.version === 1);
    const vA2 = await submissions.submitMine(A, 'video', { videoFileId: 'videos/a2.mp4' });
    check('a pending video can be replaced (same version)', vA2._id === vA._id && vA2.video?.videoFileId === 'videos/a2.mp4');
    const vB = await submissions.submitMine(B, 'video', { videoFileId: 'videos/b.mp4' });
    const vC = await submissions.submitMine(C, 'video', { videoFileId: 'videos/c.mp4' });
    const staleReview = await refusal(() => submissions.reviewSubmission(ADMIN, vA._id, { decision: 'accept', updatedAt: vA.updatedAt }));
    check('reviewing a video replaced since is refused', staleReview?.code === 'STALE');
    await submissions.reviewSubmission(ADMIN, vA._id, { decision: 'accept', updatedAt: vA2.updatedAt });
    await submissions.reviewSubmission(ADMIN, vB._id, { decision: 'accept' });
    check('asking for a new version needs a reason', (await refusal(() => submissions.reviewSubmission(ADMIN, vC._id, { decision: 'resubmit', reason: 'flou' })))?.code === 'REASON_REQUIRED');
    await submissions.reviewSubmission(ADMIN, vC._id, { decision: 'resubmit', reason: 'Le son est inaudible, merci de refaire la vidéo.' });
    const vC2 = await submissions.submitMine(C, 'video', { videoFileId: 'videos/c2.mp4' });
    check('after « nouvelle soumission demandée » a version 2 is created', vC2.version === 2 && vC2._id !== vC._id);
    await submissions.reviewSubmission(ADMIN, vC2._id, { decision: 'accept' });
    check('an accepted video cannot be replaced', (await refusal(() => submissions.submitMine(A, 'video', { videoFileId: 'videos/a3.mp4' })))?.code === 'ALREADY_ACCEPTED');
    check('notices sent for accept and resubmit', pushes.some((p) => p.kind === 'impact-video-accepted') && pushes.some((p) => p.kind === 'impact-video-resubmit'));

    // ---------- Free vote round ----------
    await stages.scheduleRound(ADMIN, String(e._id), 'FREE', { opensAt: ago(1), closesAt: ahead(60) });
    await stages.roundTick();
    check('the free vote does not open in week 1', (await ImpactEdition.findById(e._id))!.rounds.FREE.status === RoundStatus.SCHEDULED);
    check('opening by hand in week 1 is refused', (await refusal(() => stages.openRoundNow(ADMIN, String(e._id), 'FREE')))?.code === 'WRONG_STAGE');
    await stages.advanceStage(ADMIN, String(e._id));
    check('week 2: candidates move to « Étape 2 »', (await ImpactCandidate.countDocuments({ status: CandidateStatus.STAGE_2 })) === 4);
    await stages.roundTick();
    const e2 = (await ImpactEdition.findById(e._id))!;
    check('the job opens the free vote on its date', e2.rounds.FREE.status === RoundStatus.OPEN);
    check('round dates are frozen once open', (await refusal(() => stages.scheduleRound(ADMIN, String(e._id), 'FREE', { opensAt: ago(1), closesAt: ahead(90) })))?.code === 'ROUND_STARTED');

    const cA = (await cand(A))!; const cB = (await cand(B))!; const cC = (await cand(C))!; const cD = (await cand(D))!;
    const V1 = member();
    const r1 = await votes.castFreeVote(V1, { candidateId: String(cA._id) }, sig);
    check('a member votes for free', r1.candidateId === String(cA._id));
    check('1 compte = 1 vote', (await refusal(() => votes.castFreeVote(V1, { candidateId: String(cB._id) }, sig)))?.code === 'ALREADY_VOTED');
    const V2 = member();
    const burst = await Promise.allSettled(Array.from({ length: 10 }, () => votes.castFreeVote(V2, { candidateId: String(cB._id) }, sig)));
    check('10 simultaneous votes from one account count once', burst.filter((x) => x.status === 'fulfilled').length === 1 && (await ImpactFreeVote.countDocuments({ voterUserId: new Types.ObjectId(V2) })) === 1);
    check('members only (setting)', (await refusal(() => votes.castFreeVote(member({ isMember: false }), { candidateId: String(cA._id) }, sig)))?.code === 'MEMBERS_ONLY');
    check('accounts created after the vote opened are refused', (await refusal(() => votes.castFreeVote(member({ createdAt: new Date() }), { candidateId: String(cA._id) }, sig)))?.code === 'ACCOUNT_TOO_RECENT');
    check('a candidate cannot vote for themselves (default)', (await refusal(() => votes.castFreeVote(A, { candidateId: String(cA._id) }, sig)))?.code === 'SELF_VOTE');
    check('no vote for a candidate without a published video', (await refusal(() => votes.castFreeVote(member(), { candidateId: String(cD._id) }, sig)))?.code === 'CANDIDATE_NOT_VOTABLE');
    const mv = await votes.myVotes(V1);
    check('my votes: named, and no more free vote', mv.freeVote?.candidateName === 'Candidat a' && mv.canFreeVote?.ok === false && mv.canFreeVote.code === 'ALREADY_VOTED');
    check('my votes: a new member may vote', (await votes.myVotes(member())).canFreeVote?.ok === true);
    check('my votes: a non-member is told before tapping', (await votes.myVotes(member({ isMember: false }))).canFreeVote?.code === 'MEMBERS_ONLY');
    check('my votes: a candidate knows their own candidacy', (await votes.myVotes(A)).myCandidateId === String(cA._id));
    await votes.castFreeVote(member(), { candidateId: String(cA._id) }, sig);
    check('free counters', (await cand(A))!.votes.free === 2 && (await cand(B))!.votes.free === 1);
    check('paid votes are closed in week 2', (await refusal(() => votes.startPurchase(member(), { candidateId: String(cA._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig)))?.code === 'VOTE_CLOSED');
    const b2 = await board.currentBoard();
    check('week-2 board sorts by free votes', b2!.candidates[0]._id === String(cA._id) && b2!.candidates[0].votes.free === 2);

    // ---------- Week 3 ----------
    check('week 3 refused while the free vote is open', (await refusal(() => stages.advanceStage(ADMIN, String(e._id))))?.code === 'ROUND_OPEN');
    await stages.closeRoundNow(ADMIN, String(e._id), 'FREE', 'Fin du vote gratuit');
    check('no vote after closing', (await refusal(() => votes.castFreeVote(member(), { candidateId: String(cA._id) }, sig)))?.code === 'VOTE_CLOSED');
    await stages.advanceStage(ADMIN, String(e._id));
    check('week 3: candidates move to « Étape 3 »', (await ImpactCandidate.countDocuments({ status: CandidateStatus.STAGE_3 })) === 4);
    check('the video can no longer be submitted', (await refusal(() => submissions.submitMine(D, 'video', { videoFileId: 'videos/d.mp4' })))?.code === 'NOT_ALLOWED');
    check('a project needs every heading', (await refusal(() => submissions.submitMine(A, 'project', { ...PROJECT, outlook: 'court' })))?.details?.field === 'outlook');
    for (const id of [A, B, C]) {
        const p = await submissions.submitMine(id, 'project', PROJECT);
        await submissions.reviewSubmission(ADMIN, p._id, { decision: 'accept' });
    }
    await stages.scheduleRound(ADMIN, String(e._id), 'PAID', { opensAt: ago(1), closesAt: ahead(60) });
    await stages.openRoundNow(ADMIN, String(e._id), 'PAID');

    // ---------- Paid votes: Mobile Money ----------
    const P1 = member();
    const k1 = key();
    const s1 = await votes.startPurchase(P1, { candidateId: String(cA._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: k1 }, sig);
    check('a purchase opens a payment, nothing counted yet', s1.sessionId === 'sess-1' && s1.transaction.status === VoteTxStatus.PENDING && (await paidOf(A)) === 0);
    const again = await votes.startPurchase(P1, { candidateId: String(cA._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: k1 }, sig);
    check('a double tap returns the same purchase', again.transaction._id === s1.transaction._id && sess === 1);
    check('the same key for another candidate is refused', (await refusal(() => votes.startPurchase(P1, { candidateId: String(cB._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: k1 }, sig)))?.code === 'IDEMPOTENCY_MISMATCH');
    const settles = await Promise.all(Array.from({ length: 10 }, () => votes.settleImpactVote({ sessionId: 'sess-1', status: 'SUCCEEDED', verifiedAmount: 1000 })));
    check('10 confirmations of one payment count it once', (await paidOf(A)) === 5 && settles.filter((r: any) => r.outcome === 'paid').length === 1);
    check('the buyer is told by push', pushes.some((p) => p.kind === 'impact-votes-bought' && p.userId === P1));
    check('no vote for a candidate without a published project', (await refusal(() => votes.startPurchase(P1, { candidateId: String(cD._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig)))?.code === 'CANDIDATE_NOT_VOTABLE');

    const mm = await votes.startPurchase(member(), { candidateId: String(cB._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    await votes.settleImpactVote({ sessionId: mm.sessionId!, status: 'SUCCEEDED', verifiedAmount: 200 });
    const mmTx = (await ImpactVoteTx.findById(mm.transaction._id))!;
    check('a payment of the wrong amount counts nothing and is flagged', mmTx.status === VoteTxStatus.PENDING && mmTx.flags.includes('AMOUNT_MISMATCH') && (await paidOf(B)) === 0);

    const fl = await votes.startPurchase(member(), { candidateId: String(cB._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    await votes.settleImpactVote({ sessionId: fl.sessionId!, status: 'FAILED' });
    await votes.settleImpactVote({ sessionId: fl.sessionId!, status: 'SUCCEEDED', verifiedAmount: 200 });
    check('a provider success after a failure still counts', (await paidOf(B)) === 1);

    // Callback lost: the reconciler asks payment-service.
    const lost = await votes.startPurchase(member(), { candidateId: String(cC._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    await ImpactVoteTx.collection.updateOne({ _id: new Types.ObjectId(lost.transaction._id) }, { $set: { createdAt: ago(20) } });
    intents.set(lost.sessionId!, { status: 'SUCCEEDED', amount: 200 });
    await votes.reconcilePurchases();
    check('the reconciler settles a payment whose callback was lost', (await paidOf(C)) === 1);

    // ---------- Paid votes: SBC balance ----------
    const P2 = member(); balances.set(P2, 5000);
    const bal = await votes.startPurchase(P2, { candidateId: String(cB._id), packIndex: 2, method: 'BALANCE', idempotencyKey: key() }, sig);
    check('a balance payment counts at once', bal.transaction.status === VoteTxStatus.SUCCESS && bal.transaction.counted && (await paidOf(B)) === 11 && balances.get(P2) === 3000);
    const P3 = member(); balances.set(P3, 100);
    const poor = await refusal(() => votes.startPurchase(P3, { candidateId: String(cB._id), packIndex: 0, method: 'BALANCE', idempotencyKey: key() }, sig));
    check('too little balance: refused, nothing counted', poor?.code === 'INSUFFICIENT_BALANCE' && (await ImpactVoteTx.countDocuments({ userId: new Types.ObjectId(P3), status: VoteTxStatus.FAILED })) === 1);
    const P4 = member(); balances.set(P4, 1000);
    failNextSpend = true;
    const unknown = await votes.startPurchase(P4, { candidateId: String(cC._id), packIndex: 1, method: 'BALANCE', idempotencyKey: key() }, sig);
    check('a balance payment with an unknown outcome stays pending', unknown.transaction.status === VoteTxStatus.PENDING);
    await ImpactVoteTx.updateOne({ _id: unknown.transaction._id }, { $set: { balanceAttemptAt: ago(3) } });
    await votes.sweepBalancePayments();
    const ref = `impact-vote:${unknown.transaction._id}`;
    check('the sweeper retries with the same reference: debited once, counted', spendCalls.filter((r) => r === ref).length === 2 && balances.get(P4) === 0 && (await paidOf(C)) === 6);

    // Self-vote is allowed by default for paid votes.
    const self = await votes.startPurchase(A, { candidateId: String(cA._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    check('a candidate may buy votes for themselves (setting)', Boolean(self.sessionId));

    // ---------- Admin refund ----------
    check('a refund needs a reason the buyer reads', (await refusal(() => votes.refundPurchase(ADMIN, bal.transaction._id, { reason: 'non' })))?.code === 'REASON_REQUIRED');
    const rf = await votes.refundPurchase(ADMIN, bal.transaction._id, { reason: 'Achat signalé comme frauduleux' });
    check('admin refund: votes removed, balance given back', rf.status === VoteTxStatus.REFUNDED && (await paidOf(B)) === 1 && balances.get(P2) === 5000);
    check('a second refund is refused', (await refusal(() => votes.refundPurchase(ADMIN, bal.transaction._id, { reason: 'Achat signalé comme frauduleux' })))?.code === 'NOT_REFUNDABLE');

    // ---------- Closing, grace, late payments ----------
    const inGrace = await votes.startPurchase(member(), { candidateId: String(cC._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    const tooLate = await votes.startPurchase(member(), { candidateId: String(cC._id), packIndex: 1, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig);
    await stages.closeRoundNow(ADMIN, String(e._id), 'PAID', 'Fin des votes payants');
    const preEarly = await stages.top3Preview(String(e._id));
    check('TOP 3 waits while payments started before closing are settling', preEarly.blockers.some((b) => b.code === 'PAYMENTS_SETTLING'));
    await votes.settleImpactVote({ sessionId: inGrace.sessionId!, status: 'SUCCEEDED', verifiedAmount: 1000 });
    check('a payment started before closing and confirmed in the grace period counts', (await paidOf(C)) === 11);
    await ImpactEdition.updateOne({ _id: e._id }, { $set: { 'rounds.PAID.closedAt': ago(20) } }); // grace (15 min) is over
    const lateRes: any = await votes.settleImpactVote({ sessionId: tooLate.sessionId!, status: 'SUCCEEDED', verifiedAmount: 1000 });
    const lateTx = (await ImpactVoteTx.findById(tooLate.transaction._id))!;
    check('confirmed after the grace period: refunded to the SBC balance, never counted', lateRes.outcome === 'refunded_late' && lateTx.status === VoteTxStatus.REFUNDED && deposits.get(`impact-vote-refund:${lateTx._id}`) === 1000 && (await paidOf(C)) === 11);
    check('a purchase after closing is refused', (await refusal(() => votes.startPurchase(member(), { candidateId: String(cA._id), packIndex: 0, method: 'MOBILE_MONEY', idempotencyKey: key() }, sig)))?.code === 'VOTE_CLOSED');

    // ---------- TOP 3 ----------
    // A 5 (P1), B 1, C 11, D 0 → C, A finalists. Tie test: give B 4 more → B 5 = A 5; A reached 5 first.
    await ImpactVoteTx.create({ editionId: e._id, candidateId: cB._id, userId: new Types.ObjectId(), votes: 4, amount: 800, method: PayMethod.MOBILE_MONEY, status: VoteTxStatus.SUCCESS, idempotencyKey: key(), settledAt: new Date(), votesCreditedAt: new Date() });
    await ImpactCandidate.updateOne({ _id: cA._id }, { $set: { 'votes.paid': 999 } }); // a drifted counter
    const readOnly = await stages.top3Preview(String(e._id));
    check('reading the TOP 3 does not write (no recount unless asked)', readOnly.ranking.find((r) => r.candidateId === String(cA._id))?.paidVotes === 999 && (await cand(A))!.votes.paid === 999);
    const pre = await stages.top3Preview(String(e._id), { recount: true });
    const order = pre.ranking.map((r) => r.candidateId);
    check('the preview recounts from the ledgers (drifted counter ignored)', pre.ranking.find((r) => r.candidateId === String(cA._id))?.paidVotes === 5);
    check('ranking by paid votes, ties to the first to reach the total', order.join() === [cC._id, cA._id, cB._id, cD._id].map(String).join(), pre.ranking.map((r) => `${r.name}:${r.paidVotes}`).join(' '));
    check('the tie at the cut is shown', pre.tieAtCut === true);
    check('a flagged payment that was never counted is not reported as a flagged paid purchase', pre.flaggedPurchases === 0);
    check('confirming a ranking that moved is refused', (await refusal(() => stages.top3Confirm(ADMIN, String(e._id), { expectedOrder: [...order].reverse() })))?.code === 'STALE');
    const conf = await stages.top3Confirm(ADMIN, String(e._id), { expectedOrder: order });
    check('TOP 3 set: edition in final', conf.edition.status === EditionStatus.FINAL && conf.edition.stage === CompetitionStage.TOP3);
    check('finalists and eliminated', (await cand(C))!.status === CandidateStatus.FINALIST && (await cand(A))!.status === CandidateStatus.FINALIST && (await cand(B))!.status === CandidateStatus.ELIMINATED && (await cand(B))!.rank === 3);
    check('finalist and non-finalist notices', pushes.some((p) => p.kind === 'impact-finalist' && p.userId === C) && pushes.some((p) => p.kind === 'impact-not-finalist' && p.userId === B));
    const frozen = await stages.top3Preview(String(e._id));
    check('once decided, the preview is the frozen podium with its names', frozen.decided === true && frozen.ranking[0].name === 'Candidat c' && frozen.ranking.length === 4);
    check('the TOP 3 is set once', (await refusal(() => stages.top3Confirm(ADMIN, String(e._id), { expectedOrder: order })))?.code === 'ALREADY_DECIDED');
    const sOk = (await ImpactVoteTx.findOne({ status: VoteTxStatus.SUCCESS, lateSettlement: { $ne: true }, method: PayMethod.MOBILE_MONEY }))!;
    check('no refund once the TOP 3 is set', (await refusal(() => votes.refundPurchase(ADMIN, String(sOk._id), { reason: 'Achat signalé comme frauduleux' })))?.code === 'ALREADY_DECIDED');
    const selfRes: any = await votes.settleImpactVote({ sessionId: self.sessionId!, status: 'SUCCEEDED', verifiedAmount: 200 });
    check('a payment confirmed after the TOP 3 is refunded', selfRes.outcome === 'refunded_late');
    const bTop = await board.currentBoard();
    check('the public board shows the podium in rank order', bTop!.stage === CompetitionStage.TOP3 && bTop!.candidates[0]._id === String(cC._id) && bTop!.candidates[0].rank === 1);

    // ---------- Admin reads ----------
    const list = await votes.listPurchases(String(e._id), {});
    check('purchases list with revenue (refunds excluded)', list.totals.revenue > 0 && list.items.every((i) => i.buyerName));
    check('purchases carry the candidate name', list.items.every((i) => i.candidateName && i.candidateName.startsWith('Candidat')));
    await ImpactVoteTx.updateOne({ _id: sOk._id }, { $set: { 'refund.uncertain': true } });
    const unc = await votes.listPurchases(String(e._id), { refundUncertain: '1' });
    check('filter: refunds with an unknown outcome', unc.total === 1 && unc.totals.uncertainRefunds === 1);
    await ImpactVoteTx.updateOne({ _id: sOk._id }, { $unset: { 'refund.uncertain': 1 } });
    const fvl = await votes.listFreeVotes(String(e._id), {});
    check('free votes carry the candidate name', fvl.items.every((i) => i.candidateName));
    const subs = await submissions.listSubmissions(String(e._id), { kind: 'VIDEO' });
    check('contents: refused / accepted after pending ones (pending first)', subs.length > 0 && subs.every((x, i) => i === 0 || ['PENDING', 'RESUBMIT_REQUESTED', 'ACCEPTED', 'REJECTED'].indexOf(subs[i - 1].status) <= ['PENDING', 'RESUBMIT_REQUESTED', 'ACCEPTED', 'REJECTED'].indexOf(x.status)));
    const an = await votes.anomalies(String(e._id));
    check('anomaly report: the wrong-amount payment is listed', an.paidVotes.flagged.some((f) => f.flags.includes('AMOUNT_MISMATCH')));
    await ImpactCandidate.updateOne({ _id: cD._id }, { $set: { 'profile.name': '=HYPERLINK("http://x")' } });
    const csv = await candidates.exportCandidatesCsv(String(e._id));
    check('CSV export: header, one line per candidate, formulas neutralised', csv.includes('"Place","Nom"') && csv.split('\r\n').length === 5 && csv.includes(`"'=HYPERLINK`));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
