/**
 * Animation & Engagement — end-to-end service checks against real MongoDB and
 * Redis (other services stubbed). Concurrency, quotas, money, rewards, draws,
 * results, cancellation, isolation.
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_anim_check REDIS_URL=redis://127.0.0.1:6379 \
 *     npx ts-node --transpile-only src/scripts/check-animation.ts
 * Uses its own database (dropped at the end) and Redis key prefix.
 */
process.env.REDIS_KEY_PREFIX = `anim-check-${Date.now()}:`;
import assert from 'assert';
import { createHmac } from 'crypto';
import mongoose, { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import TicketType, { TicketTypeStatus } from '../database/models/ticket-type.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import Organizer, { OrganizerStatus } from '../database/models/organizer.model';
import Commission from '../database/models/commission.model';
import Order, { OrderKind, OrderStatus } from '../database/models/order.model';
import Refund from '../database/models/refund.model';
import { refundOrder } from '../services/refund.service';
import * as userClient from '../services/clients/user.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import * as paymentClient from '../services/clients/payment.service.client';
import * as settingsClient from '../services/clients/settings.service.client';
import { AnimCandidate, AnimChallenge } from '../modules/animation/models/challenge.model';
import { AnimAuditLog, AnimFraudFlag, AnimInvite, AnimTeamMember } from '../modules/animation/models/governance.model';
import { AnimRewardRule, AnimRewardWinner, AnimResult, AnimReward } from '../modules/animation/models/reward.model';
import { AnimVote, AnimVoteRefund, AnimVoteTransaction } from '../modules/animation/models/vote.model';
import {
    AnimCtx, CandidateStatus, ChallengeStatus, EligibilityScope, Perm, ROLE_PERMS, RuleKind, RuleTrigger, TeamRole,
    TieRule, VoteStatus, VoteTxStatus, VotingMode,
} from '../modules/animation/types';
import { resolveEventRole } from '../modules/animation/lib/context';
import { SYSTEM_ACTOR as SYSTEM } from '../modules/animation/lib/audit';
import { kv } from '../modules/animation/lib/kv';
import { drawWinners, sha256 } from '../modules/animation/lib/rules';
import * as challenges from '../modules/animation/services/challenge.service';
import * as candidates from '../modules/animation/services/candidate.service';
import * as votes from '../modules/animation/services/vote.service';
import * as paid from '../modules/animation/services/paid-vote.service';
import * as packages from '../modules/animation/services/package.service';
import * as rewards from '../modules/animation/services/reward.service';
import * as results from '../modules/animation/services/result.service';
import * as board from '../modules/animation/services/board.service';
import * as fraud from '../modules/animation/services/fraud.service';
import * as team from '../modules/animation/services/team.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_anim_check';
const HOUR = 3_600_000;
const ok = (msg: string) => console.log(`ok  ${msg}`);
const oid = () => new Types.ObjectId();

// ---- stubs: no other service runs ----
const credits: { userId: string; amount: number; reference: string }[] = [];
const debits: { userId: string; amount: number; reference: string }[] = [];
const deposits: { userId: string; amount: number; reference: string }[] = [];
(userClient as any).creditEventOrganizerBalance = async (a: any) => { credits.push(a); return {}; };
(userClient as any).debitEventOrganizerBalance = async (a: any) => { debits.push(a); return {}; };
(userClient as any).getEventUserDetails = async () => [];
(notificationClient as any).notifyUser = async () => 1;
(settingsClient as any).getCommissionConfig = async () => ({ primaryPct: 0.05, resalePct: 0.1, defaultMaxResalePricePct: 120, votePct: 0.1 });
const intents = new Map<string, { status: string; amount: number }>();
let intentSeq = 0;
(paymentClient as any).createVotePaymentIntent = async (a: any) => {
    const sessionId = `vs-${++intentSeq}`;
    intents.set(sessionId, { status: 'PENDING_PROVIDER', amount: a.amount });
    return { sessionId };
};
(paymentClient as any).getPaymentIntentState = async (sessionId: string) => {
    const i = intents.get(sessionId);
    return i ? { sessionId, status: i.status, amount: i.amount, currency: 'XAF', paymentType: 'EVENT_CHALLENGE_VOTE', metadata: {} } : null;
};
(paymentClient as any).creditBuyerBalance = async (a: any) => { deposits.push(a); return { transactionId: 'tx', status: 'completed' }; };

(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    for (const m of mongoose.modelNames()) await mongoose.model(m).syncIndexes();

    // ---------- world ----------
    const ownerUserId = oid();
    const organizer = await Organizer.create({ userId: ownerUserId, displayName: 'Prod Douala', status: OrganizerStatus.APPROVED });
    const event = await Event.create({
        organizerId: organizer._id, slug: 'gala', title: 'Gala', description: 'Gala.', category: 'concert', city: 'Douala',
        venue: 'Palais', address: 'Rue 1', startsAt: new Date(Date.now() + 48 * HOUR), endsAt: new Date(Date.now() + 52 * HOUR), status: EventStatus.PUBLISHED,
    });
    const vip = await TicketType.create({ eventId: event._id, name: 'VIP', price: 10000, quantityTotal: 1000, maxPerOrder: 5, status: TicketTypeStatus.ACTIVE });
    const ctx: AnimCtx = { organizerId: String(organizer._id), eventId: String(event._id), actorUserId: String(ownerUserId), role: TeamRole.OWNER, perms: ROLE_PERMS.OWNER };
    const users = Array.from({ length: 220 }, () => oid());
    let serial = 0;
    const giveTicket = (u: Types.ObjectId, typeId = vip._id) => Ticket.create({
        orderId: oid(), eventId: event._id, ticketTypeId: typeId, ownerUserId: u, serial: `S-${++serial}`, qrToken: `q-${serial}`,
        status: TicketStatus.ISSUED, holderName: 'X', holderPhone: '+237600000000', issuedAt: new Date(),
    });

    // ---------- (1) isolation and roles ----------
    const stranger = oid();
    assert.strictEqual(await resolveEventRole(String(stranger), String(event._id)), null, 'a stranger has no role');
    const otherOrg = await Organizer.create({ userId: oid(), displayName: 'Autre', status: OrganizerStatus.APPROVED });
    await AnimTeamMember.create({ organizerId: otherOrg._id, eventId: null, userId: stranger, role: TeamRole.MANAGER, invitedBy: otherOrg.userId });
    assert.strictEqual(await resolveEventRole(String(stranger), String(event._id)), null, 'another organizer’s manager has no role here');
    const mod = oid();
    await AnimTeamMember.create({ organizerId: organizer._id, eventId: event._id, userId: mod, role: TeamRole.MODERATOR, invitedBy: ownerUserId });
    const modRole = await resolveEventRole(String(mod), String(event._id));
    assert.strictEqual(modRole?.ctx.role, TeamRole.MODERATOR);
    assert.ok(!modRole?.ctx.perms.includes(Perm.CONFIGURE), 'a moderator cannot configure');
    assert.strictEqual((await resolveEventRole(String(ownerUserId), String(event._id)))?.ctx.role, TeamRole.OWNER);
    ok('(1) isolation: strangers and other organizers’ teams resolve to nothing; roles carry their permissions');

    // ---------- (2) config validation, locking, state machine ----------
    const past = new Date(Date.now() - HOUR);
    const later = new Date(Date.now() + 24 * HOUR);
    let c = await challenges.createChallenge(ctx, {
        name: 'Meilleur outfit', description: 'Le plus stylé.',
        schedule: { registrationOpensAt: past, registrationClosesAt: later, votingOpensAt: new Date(later.getTime() + HOUR), votingClosesAt: new Date(later.getTime() + 48 * HOUR) },
        participation: { mode: 'OPEN', maxCandidates: 50, requiresApproval: true, photoRequired: false },
        voting: { mode: VotingMode.FREE_AND_PAID, voterScope: 'ANY_SBC_USER', free: { perPeriod: 5, period: 'DAY', perCandidatePerPeriod: 3 } },
        scoring: { method: 'VOTES' }, tieRule: TieRule.SPLIT_PRIZE,
    });
    await assert.rejects(challenges.transition(ctx, c._id, ChallengeStatus.REGISTRATION_OPEN), /impossible/, 'DRAFT cannot jump to registration');
    await challenges.transition(ctx, c._id, ChallengeStatus.PROGRAMMED, { manual: true });
    await challenges.transition(ctx, c._id, ChallengeStatus.REGISTRATION_OPEN, { manual: true });
    await assert.rejects(challenges.updateChallenge(ctx, String(c._id), { participation: { maxCandidates: 500 } }), (e: any) => e.code === 'LOCKED_FIELDS');
    await assert.rejects(challenges.transition(ctx, c._id, ChallengeStatus.REGISTRATION_CLOSED, { manual: true }), (e: any) => e.code === 'SCHEDULED_LATER', 'manual moves can’t run ahead of the schedule');
    ok('(2) DRAFT→PROGRAMMED→REGISTRATION_OPEN; participation locked; manual close before the date refused');

    // ---------- (3) 200 parallel sign-ups for 50 places ----------
    const signups = await Promise.allSettled(users.slice(0, 200).map((u, i) => candidates.register(String(u), String(c._id), { displayName: `Cand ${i}` })));
    const won = signups.filter((s) => s.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    assert.strictEqual(won.length, 50, 'exactly 50 candidates');
    const numbers = new Set(won.map((w) => w.value.number));
    assert.strictEqual(numbers.size, 50, 'unique numbers');
    assert.ok([...numbers].every((n) => n >= 1 && n <= 50), 'numbers 1..50');
    assert.ok(signups.filter((s) => s.status === 'rejected').every((s: any) => s.reason.code === 'CHALLENGE_FULL'));
    c = (await AnimChallenge.findById(c._id))!;
    assert.strictEqual(c.counters.candidates, 50);
    await assert.rejects(candidates.register(String(won[0].value.userId), String(c._id), { displayName: 'again' }), (e: any) => e.code === 'ALREADY_REGISTERED' || e.code === 'CHALLENGE_FULL');
    ok('(3) 200 parallel registrations against 50 places → exactly 50, numbered 1–50');

    // withdraw frees a place; the same person re-registering keeps their number
    const leaver = won[0].value;
    await candidates.withdraw(String(leaver.userId), String(leaver._id));
    const back = await candidates.register(String(leaver.userId), String(c._id), { displayName: 'Revenu' });
    assert.strictEqual(back.number, leaver.number, 're-registration keeps the number');
    ok('(3b) withdrawal frees the place; re-registration reuses the same candidate and number');

    // moderation
    const cands = await AnimCandidate.find({ challengeId: c._id }).sort({ number: 1 });
    for (const cand of cands.slice(0, 12)) await candidates.moderate(ctx, String(cand._id), 'approve');
    await assert.rejects(candidates.moderate(ctx, String(cands[12]._id), 'reject'), (e: any) => e.code === 'REASON_REQUIRED');
    await candidates.moderate(ctx, String(cands[12]._id), 'reject', 'photo floue');
    await candidates.moderate(ctx, String(cands[11]._id), 'disqualify', 'triche');
    c = (await AnimChallenge.findById(c._id))!;
    assert.strictEqual(c.counters.approved, 11);
    assert.ok(await AnimAuditLog.exists({ action: 'candidate.disqualified', targetId: String(cands[11]._id) }), 'disqualification is logged');
    ok('(4) moderation: approve/reject (reason required)/disqualify, counters and audit consistent');

    // ---------- (5) to voting ----------
    await AnimChallenge.updateOne({ _id: c._id }, { $set: { 'schedule.registrationClosesAt': new Date(Date.now() - 30 * 60_000), 'schedule.votingOpensAt': new Date(Date.now() - 20 * 60_000) } });
    await challenges.transition(ctx, c._id, ChallengeStatus.REGISTRATION_CLOSED, { manual: true });
    const pack10 = await packages.createPackage(ctx, String(c._id), { label: '10 votes', votes: 10, price: 500 });
    await challenges.transition(ctx, c._id, ChallengeStatus.ACTIVE, { manual: true });
    await assert.rejects(packages.createPackage(ctx, String(c._id), { label: 'cheap', votes: 100, price: 100 }), (e: any) => e.code === 'LOCKED_FIELDS', 'packs lock once ACTIVE');
    await challenges.transition(ctx, c._id, ChallengeStatus.VOTING_OPEN, { manual: true });
    c = (await AnimChallenge.findById(c._id))!;
    ok('(5) REGISTRATION_CLOSED→ACTIVE→VOTING_OPEN; packs locked from ACTIVE');

    // ---------- (6) free votes: quota under concurrency ----------
    const approved = await AnimCandidate.find({ challengeId: c._id, status: CandidateStatus.APPROVED }).sort({ number: 1 });
    const [A, B, C] = approved;
    const voter = users[210];
    const burst = await Promise.allSettled(Array.from({ length: 50 }, (_, i) =>
        votes.castFreeVote({ userId: String(voter), challengeId: String(c._id), candidateId: String(i % 2 ? A._id : B._id), ip: '1.1.1.1' })));
    const counted = burst.filter((b) => b.status === 'fulfilled').length;
    assert.ok(counted <= 5, `quota 5 per day, got ${counted}`);
    const ledger = await AnimVote.countDocuments({ challengeId: c._id, voterUserId: voter, status: VoteStatus.COUNTED });
    assert.strictEqual(ledger, counted, 'ledger matches successful votes');
    const refusedCodes = new Set(burst.filter((b) => b.status === 'rejected').map((b: any) => b.reason.code));
    assert.ok([...refusedCodes].every((code) => ['QUOTA_EXHAUSTED', 'RATE_LIMITED'].includes(code)), [...refusedCodes].join(','));
    // per-candidate cap (3/day)
    const v2 = users[211];
    for (let i = 0; i < 3; i++) await votes.castFreeVote({ userId: String(v2), challengeId: String(c._id), candidateId: String(C._id) });
    await assert.rejects(votes.castFreeVote({ userId: String(v2), challengeId: String(c._id), candidateId: String(C._id) }), (e: any) => e.code === 'QUOTA_EXHAUSTED');
    await votes.castFreeVote({ userId: String(v2), challengeId: String(c._id), candidateId: String(A._id) }); // still has 2 for others
    await assert.rejects(votes.castFreeVote({ userId: String(A.userId), challengeId: String(c._id), candidateId: String(A._id) }), (e: any) => e.code === 'SELF_VOTE');
    ok(`(6) 50 parallel free votes with a 5/day quota → ${counted} counted, ledger matches; per-candidate cap and self-vote refusal`);

    // ---------- (7) paid votes: exactly once ----------
    const buyer = users[212];
    const start = await paid.startPurchase({ userId: String(buyer), challengeId: String(c._id), candidateId: String(A._id), packageId: String(pack10._id), idempotencyKey: 'key-buyer-0001' });
    const again = await paid.startPurchase({ userId: String(buyer), challengeId: String(c._id), candidateId: String(A._id), packageId: String(pack10._id), idempotencyKey: 'key-buyer-0001' });
    assert.strictEqual(String(again.transaction._id), String(start.transaction._id), 'same idempotency key → same purchase');
    intents.get(start.sessionId!)!.status = 'SUCCEEDED';
    const settles = await Promise.all(Array.from({ length: 10 }, () => paid.settleVoteFromWebhook({ sessionId: start.sessionId!, status: 'SUCCEEDED', verifiedAmount: 500 })));
    assert.strictEqual(settles.filter((s: any) => s.outcome === 'paid').length, 1, 'one settlement');
    assert.strictEqual(await AnimVote.countDocuments({ transactionId: start.transaction._id }), 1, 'one ledger row');
    assert.strictEqual((await AnimCandidate.findById(A._id))!.paidVotes, 10);
    assert.strictEqual(await Commission.countDocuments({ voteTransactionId: start.transaction._id }), 1, 'one commission row');
    const cred = credits.filter((x) => x.reference === `event-vote:${start.transaction._id}`);
    assert.strictEqual(cred.length, 1, 'organizer credited once');
    assert.strictEqual(cred[0].userId, String(ownerUserId), 'credit goes to the organizer’s user');
    assert.strictEqual(cred[0].amount, 450, '500 − 10 % commission');
    ok('(7) idempotent start; 10 parallel confirmations → 1 vote row, +10 votes, 1 commission, 1 credit of 450 to the organizer user');

    // amount mismatch
    const mm = await paid.startPurchase({ userId: String(users[213]), challengeId: String(c._id), candidateId: String(B._id), packageId: String(pack10._id), idempotencyKey: 'key-mismatch-01' });
    const mmRes: any = await paid.settleVoteFromWebhook({ sessionId: mm.sessionId!, status: 'SUCCEEDED', verifiedAmount: 50 });
    assert.strictEqual(mmRes.outcome, 'amount_mismatch');
    assert.strictEqual(await AnimVote.countDocuments({ transactionId: mm.transaction._id }), 0, 'nothing credited');
    assert.ok(await AnimFraudFlag.exists({ subjectId: String(mm.transaction._id), status: 'OPEN' }), 'flagged for SBC');
    ok('(8) paid amount ≠ pack price → not credited, flagged "À vérifier"');

    // failed, then succeeded late by the provider: counted
    const fl = await paid.startPurchase({ userId: String(users[214]), challengeId: String(c._id), candidateId: String(B._id), packageId: String(pack10._id), idempotencyKey: 'key-failed-001' });
    await paid.settleVoteFromWebhook({ sessionId: fl.sessionId!, status: 'FAILED' });
    assert.strictEqual((await AnimVoteTransaction.findById(fl.transaction._id))!.status, VoteTxStatus.FAILED);
    const late: any = await paid.settleVoteFromWebhook({ sessionId: fl.sessionId!, status: 'SUCCEEDED', verifiedAmount: 500 });
    assert.strictEqual(late.outcome, 'paid', 'a FAILED that the provider later confirms is honoured');
    ok('(9) FAILED then SUCCEEDED (provider confirms late) → counted once');

    // refund: votes uncounted, money back, organizer debited, replay-safe
    const beforeB = (await AnimCandidate.findById(B._id))!.paidVotes;
    await paid.refundTransaction({ actorUserId: '', role: TeamRole.SYSTEM }, fl.transaction._id, 'test');
    await paid.refundTransaction({ actorUserId: '', role: TeamRole.SYSTEM }, fl.transaction._id, 'test (replay)');
    assert.strictEqual((await AnimCandidate.findById(B._id))!.paidVotes, beforeB - 10, 'votes uncounted once');
    assert.strictEqual(deposits.filter((d) => d.reference === `event-vote-refund:${fl.transaction._id}`).length, 1, 'wallet credited once');
    assert.strictEqual(deposits.find((d) => d.reference === `event-vote-refund:${fl.transaction._id}`)!.amount, 500, 'full amount, commission included');
    assert.strictEqual(debits.filter((d) => d.reference === `event-vote-refund:${fl.transaction._id}`).length, 1, 'organizer debited once');
    assert.ok((await Commission.findOne({ voteTransactionId: fl.transaction._id }))!.reversedAt, 'commission reversed');
    assert.strictEqual((await AnimVoteRefund.findOne({ voteTransactionId: fl.transaction._id }))!.status, 'COMPLETED');
    ok('(10) refund (twice) → votes voided once, 500 back to the wallet once, organizer debited once, commission reversed');

    // ---------- (11) board and recount ----------
    await board.refreshBoard(String(c._id));
    const b1 = await board.getBoard(String(c._id));
    assert.strictEqual(b1!.entries[0].candidateId, String(A._id), 'A leads with 10 paid votes');
    await AnimCandidate.updateOne({ _id: A._id }, { $inc: { freeVotes: 1000, totalVotes: 1000 } }); // simulated drift
    const fixed = await board.recountFromLedger(c._id);
    assert.ok(fixed >= 1, 'drift healed');
    assert.strictEqual((await AnimCandidate.findById(A._id))!.freeVotes, await AnimVote.aggregate([{ $match: { candidateId: A._id, kind: 'FREE', status: 'COUNTED' } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]).then((r) => r[0]?.q ?? 0));
    ok('(11) board ranks by votes; ledger recount heals counter drift');

    // ---------- (12) rewards: position, periodic, replay, draw ----------
    const third = await rewards.createReward(ctx, { name: 'Montre', type: 'PRODUCT', quantity: 1, estimatedValue: 35000 });
    const r3 = await rewards.createRuleVersion(ctx, String(third._id), { kind: RuleKind.POSITION, trigger: RuleTrigger.TICKET_ORDER_PAID, params: { position: 3, onePerUser: false } });
    await rewards.activateRule(ctx, String(r3._id));
    const every = await rewards.createReward(ctx, { name: 'Boisson', type: 'GIFT', quantity: 5 });
    const re = await rewards.createRuleVersion(ctx, String(every._id), { kind: RuleKind.PERIODIC, trigger: RuleTrigger.TICKET_ORDER_PAID, params: { every: 10, onePerUser: false } });
    await rewards.activateRule(ctx, String(re._id));
    const orders = Array.from({ length: 100 }, (_, i) => ({ u: users[i % 200], k: `order:${i}` }));
    await Promise.all(orders.map((o) => rewards.onTrigger({ trigger: RuleTrigger.TICKET_ORDER_PAID, eventId: String(event._id), userId: String(o.u), subjectKey: o.k })));
    await Promise.all(orders.slice(0, 30).map((o) => rewards.onTrigger({ trigger: RuleTrigger.TICKET_ORDER_PAID, eventId: String(event._id), userId: String(o.u), subjectKey: o.k }))); // replays
    assert.strictEqual(await AnimRewardWinner.countDocuments({ rewardId: third._id }), 1, 'exactly one 3rd buyer');
    assert.strictEqual(await AnimRewardWinner.countDocuments({ rewardId: every._id }), 5, 'every 10th, capped by stock 5');
    assert.strictEqual((await AnimReward.findById(every._id))!.status, 'EXHAUSTED');
    const slots = (await AnimRewardWinner.find({ rewardId: every._id })).map((w) => w.slotKey).sort();
    assert.deepStrictEqual(slots, ['ord:10', 'ord:20', 'ord:30', 'ord:40', 'ord:50'], `ordinals with no gaps despite replays — got ${JSON.stringify(slots)}, counter ${(await AnimRewardRule.findById(re._id))?.counter}`);
    // A revoked prize goes back to stock and the next "10th" buyer gets it.
    const w30 = await AnimRewardWinner.findOne({ rewardId: every._id, slotKey: 'ord:30' });
    await rewards.setWinnerStatus(ctx, String(w30!._id), 'revoke', { note: 'fraude' });
    await Promise.all(Array.from({ length: 10 }, (_, i) => rewards.onTrigger({ trigger: RuleTrigger.TICKET_ORDER_PAID, eventId: String(event._id), userId: String(users[i]), subjectKey: `order:late-${i}` })));
    assert.ok(await AnimRewardWinner.exists({ rewardId: every._id, slotKey: 'ord:110', status: 'AWARDED' }), 'the 110th buyer gets the returned unit');
    assert.strictEqual(await AnimRewardWinner.countDocuments({ rewardId: every._id, status: 'AWARDED' }), 5, 'still 5 awarded in total');
    await assert.rejects(rewards.updateReward(ctx, String(third._id), { quantity: 0 }), /invalide|Déjà/);
    await assert.rejects(rewards.updateReward(ctx, String(third._id), { estimatedValue: 1 }), (e: any) => e.code === 'LOCKED_FIELDS');
    ok('(12) 100 parallel purchases (+30 replays): one 3rd-buyer prize, every-10th prize ×5 (stock) to exactly the 10th…50th; a revoked prize goes to the next 10th buyer; awarded reward locked');

    // draw among ticket holders
    for (const u of users.slice(0, 40)) await giveTicket(u);
    const drawReward = await rewards.createReward(ctx, { name: 'Billet VIP', type: 'TICKET', quantity: 3 });
    const dr = await rewards.createRuleVersion(ctx, String(drawReward._id), { kind: RuleKind.RANDOM_DRAW, params: { winners: 3 }, eligibility: { scope: EligibilityScope.TICKET_HOLDERS } });
    await rewards.activateRule(ctx, String(dr._id));
    const draw = await rewards.drawNow(ctx, String(dr._id));
    const rerun = await rewards.runDraw(dr._id);
    assert.deepStrictEqual(rerun?.winners.map((w: any) => String(w.userId)), draw?.winners.map((w: any) => String(w.userId)), 'a re-run returns the same draw');
    const proof = await rewards.drawProof(String(draw!._id));
    assert.strictEqual(sha256(proof.seed!), proof.seedCommitment, 'revealed seed matches the commitment');
    const recomputed = drawWinners(proof.entrantHashes, 3, proof.seed!);
    const winnersHashes = draw!.winners.map((w: any) => sha256(`${w.userId}:${draw!._id}`));
    assert.deepStrictEqual(recomputed, winnersHashes, 'anyone can recompute the winners from the proof');
    assert.strictEqual(await AnimRewardWinner.countDocuments({ rewardId: drawReward._id }), 3);
    assert.ok(createHmac('sha256', 'x').update('1').digest().length === 32);
    ok('(13) draw among 40 holders: 3 winners, re-run identical, proof (commitment + entrant hashes) verifies');

    // ---------- (14) close, result, ties (SPLIT_PRIZE), freeze, rank prizes ----------
    const podium = await rewards.createReward(ctx, { name: 'Trophée', type: 'GIFT', quantity: 2 });
    await challenges.updateChallenge(ctx, String(c._id), { description: 'ok' }); // still editable text
    await AnimChallenge.updateOne({ _id: c._id }, { $set: { rankRewards: [{ rank: 1, rewardId: podium._id }] } });
    // make A and C tie exactly for first: equalise votes in the ledger
    const tot = async (id: Types.ObjectId) => (await AnimVote.aggregate([{ $match: { candidateId: id, status: 'COUNTED' } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]))[0]?.q ?? 0;
    const diff = (await tot(A._id)) - (await tot(C._id));
    await AnimVote.create({ organizerId: organizer._id, eventId: event._id, challengeId: c._id, candidateId: C._id, voterUserId: users[215], kind: 'ADJUSTMENT', quantity: diff, at: new Date() });
    await AnimChallenge.updateOne({ _id: c._id }, { $set: { 'schedule.votingClosesAt': new Date(Date.now() - 20 * 60_000) } });
    await challenges.transition(ctx, c._id, ChallengeStatus.VOTING_CLOSED, { manual: true });
    await challenges.transition(ctx, c._id, ChallengeStatus.RESULTS_PENDING);
    let result = await AnimResult.findOne({ challengeId: c._id });
    assert.ok(result, 'result computed on RESULTS_PENDING');
    const first = result!.entries.filter((e) => e.rank === 1);
    assert.strictEqual(first.length, 2, 'A and C share rank 1 (SPLIT_PRIZE)');
    // late payment after close is refunded, never counted
    const lp = await AnimVoteTransaction.create({
        organizerId: organizer._id, eventId: event._id, challengeId: c._id, candidateId: B._id, userId: users[216], packageId: pack10._id,
        packageSnapshot: { label: '10', votes: 10, price: 500 }, votes: 10, amount: 500, commissionRate: 0.1, commissionAmount: 50, organizerNet: 450,
        status: VoteTxStatus.PENDING, paymentSessionId: 'late-1', idempotencyKey: 'late-key-0001', fraud: { score: 0, flags: [], review: 'NONE' },
    });
    const lateRes: any = await paid.settleVoteFromWebhook({ sessionId: 'late-1', status: 'SUCCEEDED', verifiedAmount: 500 });
    assert.strictEqual(lateRes.outcome, 'refunded_late');
    assert.strictEqual(await AnimVote.countDocuments({ transactionId: lp._id }), 0, 'late payment never counted');
    assert.ok(deposits.some((d) => d.reference === `event-vote-refund:${lp._id}`), 'late payment refunded');
    // freeze is blocked by the open amount-mismatch flag (score 100)
    await assert.rejects(results.freezeResult(ctx, String(c._id)), (e: any) => e.code === 'FRAUD_REVIEW_PENDING');
    await fraud.reviewFlag(String(oid()), String((await AnimFraudFlag.findOne({ subjectId: String(mm.transaction._id) }))!._id), 'clear', { note: 'vérifié' });
    const frozen = await results.freezeResult(ctx, String(c._id));
    assert.strictEqual(frozen.status, 'FROZEN');
    await assert.rejects(AnimResult.updateOne({ _id: frozen._id }, { $set: { entries: [] } }), /frozen/, 'a frozen result is immutable');
    assert.strictEqual(await AnimRewardWinner.countDocuments({ rewardId: podium._id }), 2, 'both tied winners get the rank-1 prize');
    assert.ok((await AnimRewardWinner.find({ rewardId: podium._id })).every((w) => w.sharePct === 50), 'each with a 50 % share');
    assert.strictEqual((await AnimChallenge.findById(c._id))!.status, ChallengeStatus.COMPLETED);
    result = await AnimResult.findOne({ challengeId: c._id });
    ok('(14) close → RESULTS_PENDING → result from the ledger; tie shared; late payment refunded; freeze blocked by fraud flag until reviewed; frozen = immutable; prize split 50/50');

    // ---------- (15) cancellation with paid votes ----------
    let c2 = await challenges.createChallenge(ctx, {
        name: 'Karaoké', schedule: { votingOpensAt: past, votingClosesAt: later },
        participation: { mode: 'TICKET_HOLDERS', maxCandidates: 10, requiresApproval: false, photoRequired: false },
        voting: { mode: VotingMode.PAID, voterScope: 'TICKET_HOLDERS' }, scoring: { method: 'VOTES' },
    });
    await challenges.transition(ctx, c2._id, ChallengeStatus.PROGRAMMED, { manual: true });
    const k = await AnimChallenge.findById(c2._id);
    assert.strictEqual(k!.status, ChallengeStatus.PROGRAMMED);
    const pk = await packages.createPackage(ctx, String(c2._id), { label: '50', votes: 50, price: 2000 });
    await challenges.transition(ctx, c2._id, ChallengeStatus.ACTIVE, { manual: true });
    await challenges.transition(ctx, c2._id, ChallengeStatus.VOTING_OPEN, { manual: true });
    const singer = await candidates.addCandidateByOrganizer(ctx, String(c2._id), { userId: String(users[0]), displayName: 'Chanteur' });
    await assert.rejects(paid.startPurchase({ userId: String(users[150]), challengeId: String(c2._id), candidateId: String(singer._id), packageId: String(pk._id), idempotencyKey: 'no-ticket-001' }), (e: any) => e.code === 'TICKET_REQUIRED', 'voters need a ticket here');
    const p2 = await paid.startPurchase({ userId: String(users[5]), challengeId: String(c2._id), candidateId: String(singer._id), packageId: String(pk._id), idempotencyKey: 'cancel-key-001' });
    await paid.settleVoteFromWebhook({ sessionId: p2.sessionId!, status: 'SUCCEEDED', verifiedAmount: 2000 });
    const r = await challenges.cancelChallenge(ctx, c2._id, 'Salle indisponible');
    assert.strictEqual(r.refundedTransactions, 1);
    assert.ok(deposits.some((d) => d.reference === `event-vote-refund:${p2.transaction._id}` && d.amount === 2000), 'full refund incl. commission');
    assert.strictEqual((await AnimCandidate.findById(singer._id))!.paidVotes, 0);
    c2 = (await AnimChallenge.findById(c2._id))!;
    assert.strictEqual(c2.status, ChallengeStatus.CANCELLED);
    assert.strictEqual(c2.cancellation?.refundedTransactions, 1);
    ok('(15) ticket-holder-only voting enforced; cancelling after paid votes refunds every purchase in full');

    // ---------- (16) audit trail present for the sensitive actions ----------
    for (const action of ['challenge.create', 'challenge.transition', 'candidate.register', 'vote.refund', 'reward.award', 'reward.draw', 'result.freeze', 'challenge.cancel', 'rule.activate']) {
        assert.ok(await AnimAuditLog.exists({ action }), `audit has ${action}`);
    }
    await assert.rejects(AnimAuditLog.updateOne({}, { $set: { action: 'x' } }), /append-only/);
    ok('(16) every sensitive action is in the audit log, and the log is append-only');

    // ---------- (17) tie decided by the organizer: kept through freeze, published, on the board ----------
    const duelPrize = await rewards.createReward(ctx, { name: 'Trophée duel', type: 'GIFT', quantity: 1 });
    const duel = await challenges.createChallenge(ctx, {
        name: 'Duel', schedule: { votingOpensAt: past, votingClosesAt: later },
        participation: { mode: 'OPEN', maxCandidates: 2, requiresApproval: false, photoRequired: false },
        voting: { mode: VotingMode.FREE, voterScope: 'ANY_SBC_USER', free: { perPeriod: 3, period: 'DAY' } },
        scoring: { method: 'VOTES' }, tieRule: TieRule.ORGANIZER_DECIDES, rankRewards: [{ rank: 1, rewardId: String(duelPrize._id) }],
    });
    for (const s of [ChallengeStatus.PROGRAMMED, ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN]) await challenges.transition(ctx, duel._id, s, { manual: true });
    const d1 = await candidates.addCandidateByOrganizer(ctx, String(duel._id), { userId: String(users[30]), displayName: 'Premier inscrit' });
    const d2 = await candidates.addCandidateByOrganizer(ctx, String(duel._id), { userId: String(users[31]), displayName: 'Second inscrit' });
    for (const cand of [d1, d2]) {
        await AnimVote.create({ organizerId: organizer._id, eventId: event._id, challengeId: duel._id, candidateId: cand._id, voterUserId: users[217], kind: 'ADJUSTMENT', quantity: 3, at: new Date() });
    }
    await AnimChallenge.updateOne({ _id: duel._id }, { $set: { 'schedule.votingClosesAt': new Date(Date.now() - 20 * 60_000) } });
    await challenges.transition(ctx, duel._id, ChallengeStatus.VOTING_CLOSED, { manual: true });
    await challenges.transition(ctx, duel._id, ChallengeStatus.RESULTS_PENDING);
    assert.strictEqual((await AnimResult.findOne({ challengeId: duel._id }))!.status, 'AWAITING_TIE_DECISION');
    await assert.rejects(results.freezeResult(ctx, String(duel._id)), (e: any) => e.code === 'TIES_PENDING');
    // The organizer puts the second-registered candidate first.
    await results.resolveTie(ctx, String(duel._id), { rank: 1, order: [String(d2._id), String(d1._id)], note: 'Prestation scénique' });
    const decided = await AnimResult.findOne({ challengeId: duel._id }).lean();
    assert.deepStrictEqual(decided!.entries.map((e) => [String(e.candidateId), e.rank]), [[String(d2._id), 1], [String(d1._id), 2]], 'the decided order is the ranking');
    await results.computeResult(SYSTEM, duel._id); // a recompute on the same ledger keeps the decision
    assert.strictEqual((await AnimResult.findOne({ challengeId: duel._id }))!.status, 'COMPUTED', 'recompute does not reopen a decided tie');
    await results.freezeResult(ctx, String(duel._id));
    const duelFrozen = await AnimResult.findOne({ challengeId: duel._id }).lean();
    assert.strictEqual(String(duelFrozen!.entries.find((e) => e.rank === 1)!.candidateId), String(d2._id), 'freeze keeps the decision');
    assert.strictEqual(String((await AnimRewardWinner.findOne({ rewardId: duelPrize._id }))!.userId), String(users[31]), 'rank prize to the decided winner');
    await results.publishResult(ctx, String(duel._id));
    assert.ok((await AnimResult.findOne({ challengeId: duel._id }))!.publishedAt, 'a frozen result can be published');
    const duelBoard = await board.refreshBoard(String(duel._id));
    assert.strictEqual(duelBoard!.entries[0].candidateId, String(d2._id), 'the live board shows the frozen ranking');
    assert.strictEqual((await AnimCandidate.findById(d2._id))!.rank, 1, 'candidate rank follows the frozen result');
    ok('(17) ORGANIZER_DECIDES tie: decided order ranks, survives recompute and freeze, prize to the decided winner, publishable, board follows');

    // ---------- (18) a candidate who leaves takes their paid votes with them ----------
    const race = await challenges.createChallenge(ctx, {
        name: 'Course', schedule: { votingOpensAt: past, votingClosesAt: later },
        participation: { mode: 'OPEN', maxCandidates: 5, requiresApproval: false, photoRequired: false },
        voting: { mode: VotingMode.PAID, voterScope: 'ANY_SBC_USER' }, scoring: { method: 'VOTES' },
    });
    await challenges.transition(ctx, race._id, ChallengeStatus.PROGRAMMED, { manual: true });
    const rp = await packages.createPackage(ctx, String(race._id), { label: '10', votes: 10, price: 1000 });
    for (const s of [ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN]) await challenges.transition(ctx, race._id, s, { manual: true });
    const runner = async (i: number) => candidates.addCandidateByOrganizer(ctx, String(race._id), { userId: String(users[40 + i]), displayName: `Coureur ${i}` });
    const [quitter, cheat, crashed] = [await runner(0), await runner(1), await runner(2)];
    const buy = async (cand: any, u: Types.ObjectId, key: string) => {
        const p = await paid.startPurchase({ userId: String(u), challengeId: String(race._id), candidateId: String(cand._id), packageId: String(rp._id), idempotencyKey: key });
        await paid.settleVoteFromWebhook({ sessionId: p.sessionId!, status: 'SUCCEEDED', verifiedAmount: 1000 });
        return p.transaction._id;
    };
    const txQuit = await buy(quitter, users[218], 'race-quit-0001');
    const txCheat = await buy(cheat, users[219], 'race-cheat-001');
    const txCrash = await buy(crashed, users[218], 'race-crash-001');
    const modCtx: AnimCtx = { ...ctx, actorUserId: String(mod), role: TeamRole.MODERATOR, perms: ROLE_PERMS.MODERATOR };
    await assert.rejects(candidates.moderate(modCtx, String(cheat._id), 'disqualify', 'triche'), (e: any) => e.code === 'FORBIDDEN_ROLE', 'a moderator cannot trigger refunds');
    await candidates.moderate(ctx, String(cheat._id), 'disqualify', 'triche');
    await candidates.withdraw(String(quitter.userId), String(quitter._id));
    for (const tx of [txQuit, txCheat]) {
        assert.strictEqual((await AnimVoteTransaction.findById(tx))!.status, VoteTxStatus.REFUNDED);
        assert.strictEqual(deposits.filter((d) => d.reference === `event-vote-refund:${tx}`).length, 1, 'buyer refunded once');
        assert.strictEqual(debits.filter((d) => d.reference === `event-vote-refund:${tx}`).length, 1, 'organizer debited once');
    }
    // A crash between the status change and the refund leaves paid votes stranded: the sweeper finds them.
    await AnimCandidate.updateOne({ _id: crashed._id }, { $set: { status: CandidateStatus.WITHDRAWN } });
    await AnimVoteTransaction.updateOne({ _id: txCrash }, { $set: { settledAt: new Date(Date.now() - 5 * 60_000) } });
    assert.strictEqual(await paid.sweepStrandedPaidVotes(), 1, 'stranded purchase refunded by the sweeper');
    assert.strictEqual(await paid.sweepStrandedPaidVotes(), 0, 'and only once');
    assert.strictEqual((await AnimVoteTransaction.findById(txCrash))!.status, VoteTxStatus.REFUNDED);
    ok('(18) withdrawal / disqualification refund the candidate’s paid votes (moderators may not); the sweeper catches an interrupted refund');

    // ---------- (19) pending invites (contacts) are for team managers only ----------
    await AnimInvite.create({ organizerId: organizer._id, eventId: event._id, kind: 'TEAM', role: TeamRole.STAFF, contact: 'secret@example.test', tokenHash: sha256('tok'), expiresAt: new Date(Date.now() + HOUR), invitedBy: ownerUserId });
    assert.strictEqual((await team.listTeam(ctx)).invites.length, 1, 'the owner sees pending invites');
    assert.strictEqual((await team.listTeam(modCtx)).invites.length, 0, 'a moderator does not see invitees’ contacts');
    ok('(19) pending invites (with contacts) only listed for roles that manage the team');

    // ---------- (20) refunding a ticket sale takes back the organizer's credit ----------
    const sale = await Order.create({
        eventId: event._id, userId: users[220 - 1], kind: OrderKind.PRIMARY, status: OrderStatus.PAID, items: [{ ticketTypeId: vip._id, quantity: 1, unitPrice: 10000 }],
        subtotal: 10000, commission: 500, total: 10000, currency: 'XAF', paymentSessionId: 'sale-1', creditedAt: new Date(),
        
        holder: { firstName: 'A', lastName: 'B', phone: '+237600000000' },
    });
    await Commission.create({ kind: 'PRIMARY', orderId: sale._id, eventId: event._id, organizerId: organizer._id, basisAmount: 10000, rate: 0.05, amount: 500 });
    await refundOrder({ orderId: String(sale._id), initiatedByAdminId: String(oid()), reason: 'test' });
    await refundOrder({ orderId: String(sale._id), initiatedByAdminId: String(oid()), reason: 'replay' });
    assert.strictEqual(deposits.filter((d) => d.reference === `event-refund:${sale._id}`).length, 1, 'buyer refunded once');
    const saleDebits = debits.filter((d) => d.reference === `event-order-refund:${sale._id}`);
    assert.strictEqual(saleDebits.length, 1, 'organizer debited once');
    assert.strictEqual(saleDebits[0].amount, 9500, 'the net they were credited');
    assert.strictEqual(saleDebits[0].userId, String(ownerUserId), 'from the organizer’s user');
    assert.ok((await Commission.findOne({ orderId: sale._id }))!.reversedAt, 'commission reversed');
    assert.ok((await Refund.findOne({ orderId: sale._id }))!.organizerDebitedAt);
    ok('(20) ticket refund: buyer +10000 once, organizer −9500 once (net credited), commission reversed');

    // ---------- (21) SECOND_ROUND: the run-off's order settles the parent's tie ----------
    const finale = await challenges.createChallenge(ctx, {
        name: 'Finale', schedule: { votingOpensAt: past, votingClosesAt: later },
        participation: { mode: 'OPEN', maxCandidates: 3, requiresApproval: false, photoRequired: false },
        voting: { mode: VotingMode.FREE, voterScope: 'ANY_SBC_USER', free: { perPeriod: 3, period: 'DAY' } },
        scoring: { method: 'VOTES' }, tieRule: TieRule.SECOND_ROUND,
    });
    for (const s of [ChallengeStatus.PROGRAMMED, ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN]) await challenges.transition(ctx, finale._id, s, { manual: true });
    const f1 = await candidates.addCandidateByOrganizer(ctx, String(finale._id), { userId: String(users[50]), displayName: 'Finaliste 1' });
    const f2 = await candidates.addCandidateByOrganizer(ctx, String(finale._id), { userId: String(users[51]), displayName: 'Finaliste 2' });
    for (const cand of [f1, f2]) {
        await AnimVote.create({ organizerId: organizer._id, eventId: event._id, challengeId: finale._id, candidateId: cand._id, voterUserId: users[217], kind: 'ADJUSTMENT', quantity: 4, at: new Date() });
    }
    await AnimChallenge.updateOne({ _id: finale._id }, { $set: { 'schedule.votingClosesAt': new Date(Date.now() - 20 * 60_000) } });
    await challenges.transition(ctx, finale._id, ChallengeStatus.VOTING_CLOSED, { manual: true });
    await challenges.transition(ctx, finale._id, ChallengeStatus.RESULTS_PENDING);
    assert.strictEqual((await AnimResult.findOne({ challengeId: finale._id }))!.status, 'AWAITING_SECOND_ROUND');
    const runoff = await results.startSecondRound(ctx, String(finale._id), {
        votingOpensAt: new Date(Date.now() - 60_000).toISOString(), votingClosesAt: new Date(Date.now() + HOUR).toISOString(),
    });
    assert.strictEqual(await AnimCandidate.countDocuments({ challengeId: runoff!._id, status: CandidateStatus.APPROVED }), 2, 'the tied pair runs again');
    for (const s of [ChallengeStatus.PROGRAMMED, ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN]) await challenges.transition(ctx, runoff!._id, s, { manual: true });
    const r2 = await AnimCandidate.findOne({ challengeId: runoff!._id, userId: users[51] });
    await votes.castFreeVote({ userId: String(users[60]), challengeId: String(runoff!._id), candidateId: String(r2!._id) });
    await AnimChallenge.updateOne({ _id: runoff!._id }, { $set: { 'schedule.votingClosesAt': new Date(Date.now() - 20 * 60_000) } });
    await challenges.transition(ctx, runoff!._id, ChallengeStatus.VOTING_CLOSED, { manual: true });
    await challenges.transition(ctx, runoff!._id, ChallengeStatus.RESULTS_PENDING);
    await results.freezeResult(ctx, String(runoff!._id));
    const settled = await AnimResult.findOne({ challengeId: finale._id }).lean();
    assert.strictEqual(settled!.status, 'COMPUTED', 'the run-off settled the parent');
    assert.strictEqual(String(settled!.entries.find((e) => e.rank === 1)!.candidateId), String(f2._id), 'the run-off winner ranks first in the parent');
    await results.freezeResult(ctx, String(finale._id));
    assert.strictEqual(String((await AnimResult.findOne({ challengeId: finale._id }).lean())!.entries.find((e) => e.rank === 1)!.candidateId), String(f2._id), 'and stays first once frozen');
    ok('(21) SECOND_ROUND: tie opens a run-off with the tied pair; its result orders the parent, which then freezes with that order');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (kv().backend === 'redis') console.log('(redis keys were namespaced under', process.env.REDIS_KEY_PREFIX, ')');
    console.log('\nAll animation checks passed.');
    process.exit(0);
})().catch(async (err) => {
    console.error(err);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
});
