/**
 * Asserts the money and safety rules of the Impact Challenge.
 *
 * Votes are paid (200 F each) and the pot is paid out to three accounts, so a
 * vote counted twice inflates the payout, and a payout retried after a failure
 * must not pay anyone twice. payment-service is replaced by an in-memory
 * ledger. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-impact-challenge.ts
 */
process.env.LOTTERY_POOL_ACCOUNT_ID = '000000000000000000000aaa';
process.env.SBC_COMMISSION_ACCOUNT_ID = '000000000000000000000bbb';

import mongoose, { Types } from 'mongoose';
import ImpactChallengeModel, { ChallengeStatus } from '../database/models/impact-challenge.model';
import EntrepreneurModel from '../database/models/entrepreneur.model';
import ChallengeVoteModel, { VotePaymentStatus, VoteType } from '../database/models/challenge-vote.model';
import { paymentService } from '../services/clients/payment.service.client';

const deposits: Array<{ userId: string; amount: number; type: string }> = [];
let failDepositNumber = 0; // fail the Nth deposit call (1-based), once
let depositCalls = 0;
(paymentService as any).recordInternalDeposit = async (p: { userId: string; amount: number; metadata: any }) => {
    depositCalls++;
    await new Promise(r => setTimeout(r, 5));
    if (failDepositNumber && depositCalls === failDepositNumber) { failDepositNumber = 0; throw new Error('payment-service down'); }
    deposits.push({ userId: p.userId, amount: p.amount, type: p.metadata?.type });
    return { transactionId: `tx${deposits.length}` };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { impactChallengeService } = require('../services/impact-challenge.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { challengeVoteService } = require('../services/challenge-vote.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { impactChallengeController } = require('../api/controllers/impact-challenge.controller');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../api/routes/impact-challenge.routes').default;

const DB = process.env.CHALLENGE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_tombola_challenge_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

let month = 1;
const makeChallenge = (over: Record<string, unknown> = {}) => ImpactChallengeModel.create({
    campaignName: `C${month}`, month: month, year: 2030 + month++,
    status: ChallengeStatus.ACTIVE,
    startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000),
    description: { fr: 'x', en: 'x' }, tombolaMonthId: new Types.ObjectId(),
    totalCollected: 0, totalVoteCount: 0, fundsDistributed: false, ...over,
});
const makeEntrepreneur = (challengeId: Types.ObjectId, over: Record<string, unknown> = {}) => EntrepreneurModel.create({
    challengeId, name: 'Awa', email: 'awa@example.com', phoneNumber: '+237600000000', country: 'CM', city: 'Douala',
    projectName: 'P', projectDescription: { fr: 'x', en: 'x' }, businessCategory: 'agri',
    videoUrl: 'https://v', videoFilename: 'v.mp4', voteCount: 0, totalAmount: 0, isWinner: false, approved: true,
    userId: new Types.ObjectId(), ...over,
});
const fresh = async (id: unknown) => (await ImpactChallengeModel.findById(id).lean()) as any;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- Routes: admin before the public /:challengeId ---
    const paths = router.stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    check('GET /admin is registered before GET /:challengeId', paths.indexOf('GET /admin') < paths.indexOf('GET /:challengeId'), paths.slice(0, 3).join(' | '));

    // --- A payment confirmed twice counts once ---
    const ch = await makeChallenge();
    const ent = await makeEntrepreneur(ch._id);
    await ChallengeVoteModel.create({ challengeId: ch._id, entrepreneurId: ent._id, amountPaid: 1000, voteQuantity: 5, voteType: VoteType.SUPPORT, paymentStatus: VotePaymentStatus.PENDING, paymentIntentId: 'S1', isAnonymous: false, tombolaTicketIds: [], ticketsGenerated: false });
    await Promise.all([challengeVoteService.confirmPayment('S1', {}), challengeVoteService.confirmPayment('S1', {})]);
    let c = await fresh(ch._id);
    check('two simultaneous confirmations count the money once', c.totalCollected === 1000 && c.totalVoteCount === 5, `${c.totalCollected} XAF, ${c.totalVoteCount} votes`);
    const e1 = await EntrepreneurModel.findById(ent._id).lean() as any;
    check('and the entrepreneur once', e1.voteCount === 5, String(e1.voteCount));

    // --- Paid after voting closed: kept, not counted ---
    const closed = await makeChallenge({ status: ChallengeStatus.VOTING_CLOSED });
    const ent2 = await makeEntrepreneur(closed._id);
    await ChallengeVoteModel.create({ challengeId: closed._id, entrepreneurId: ent2._id, amountPaid: 400, voteQuantity: 2, voteType: VoteType.SUPPORT, paymentStatus: VotePaymentStatus.PENDING, paymentIntentId: 'S2', isAnonymous: false, tombolaTicketIds: [], ticketsGenerated: false });
    await challengeVoteService.confirmPayment('S2', {});
    c = await fresh(closed._id);
    check('a late payment does not change the result', c.totalCollected === 0, String(c.totalCollected));
    check('but is kept and reported', c.lateCollected === 400, String(c.lateCollected));

    // --- No votes after the end date ---
    const ended = await makeChallenge({ endDate: new Date(Date.now() - 60000) });
    const ent3 = await makeEntrepreneur(ended._id);
    let msg = '';
    try { await challengeVoteService.initiateSupport({ challengeId: String(ended._id), entrepreneurId: String(ent3._id), amount: 200 }); } catch (e: any) { msg = e.message; }
    check('support after the end date is refused', /ended/i.test(msg), msg);

    // --- Status changes cannot skip the work ---
    const s1 = await makeChallenge({ totalCollected: 2000 });
    msg = '';
    try { await impactChallengeService.updateStatus(String(s1._id), ChallengeStatus.VOTING_CLOSED); } catch (e: any) { msg = e.message; }
    check('closing by status change is refused (it would skip the ranking)', /close-voting/.test(msg), msg);
    msg = '';
    try { await impactChallengeService.updateStatus(String(s1._id), ChallengeStatus.CANCELLED); } catch (e: any) { msg = e.message; }
    check('a challenge that collected money cannot be cancelled', /collected money/.test(msg), msg);

    // --- Auto-close past the end date (+ grace) ranks the entrepreneurs ---
    const auto = await makeChallenge({ endDate: new Date(Date.now() - 2 * 3600000) });
    const a1 = await makeEntrepreneur(auto._id, { voteCount: 3, name: 'Low' });
    const a2 = await makeEntrepreneur(auto._id, { voteCount: 9, name: 'High' });
    const recent = await makeChallenge({ endDate: new Date(Date.now() - 10 * 60000) });
    await impactChallengeService.closeEndedChallenges();
    check('a challenge 2h past its end is closed', (await fresh(auto._id)).status === ChallengeStatus.VOTING_CLOSED);
    check('one 10 min past its end keeps its grace hour', (await fresh(recent._id)).status === ChallengeStatus.ACTIVE);
    const w = await EntrepreneurModel.findById(a2._id).lean() as any;
    const l = await EntrepreneurModel.findById(a1._id).lean() as any;
    check('the most-voted entrepreneur wins', w.isWinner === true && w.rank === 1 && l.rank === 2);

    // --- Payout: a failure part-way, then a retry, pays each leg once ---
    const pot = await makeChallenge({ status: ChallengeStatus.VOTING_CLOSED, totalCollected: 10001 });
    const winner = await makeEntrepreneur(pot._id, { isWinner: true, rank: 1 });
    deposits.length = 0; depositCalls = 0; failDepositNumber = 2;
    msg = '';
    try { await impactChallengeService.distributeFunds(String(pot._id)); } catch (e: any) { msg = e.message; }
    c = await fresh(pot._id);
    check('a failure on the 2nd deposit stops and says so', /part-way/.test(msg), msg);
    check('the winner leg is recorded as paid', Boolean(c.winnerTransactionId) && !c.lotteryTransactionId);
    check('and the distribution is released for a retry', c.distributionInProgress === false && c.fundsDistributed === false);
    await impactChallengeService.distributeFunds(String(pot._id));
    c = await fresh(pot._id);
    const toWinner = deposits.filter(d => d.type === 'challenge_winner_payout');
    check('retry: the winner was paid exactly once', toWinner.length === 1 && toWinner[0].userId === String(winner.userId), `${toWinner.length} payment(s)`);
    check('every leg paid once: 5000 / 3000 / 2001', deposits.length === 3 && deposits.map(d => d.amount).join('/') === '5000/3000/2001', deposits.map(d => d.amount).join('/'));
    check('marked distributed', c.fundsDistributed === true && c.status === ChallengeStatus.FUNDS_DISTRIBUTED);

    // --- Two payouts at once: one runs ---
    const pot2 = await makeChallenge({ status: ChallengeStatus.VOTING_CLOSED, totalCollected: 1000 });
    await makeEntrepreneur(pot2._id, { isWinner: true, rank: 1 });
    deposits.length = 0;
    const results = await Promise.allSettled([impactChallengeService.distributeFunds(String(pot2._id)), impactChallengeService.distributeFunds(String(pot2._id))]);
    check('two simultaneous payouts: one succeeds, one is refused', results.filter(r => r.status === 'fulfilled').length === 1, results.map(r => r.status).join(','));
    check('and the money moved once', deposits.length === 3, `${deposits.length} deposits`);

    // --- Public entrepreneur: no contact details, no unapproved ---
    let body: any = null; let code = 0;
    const res: any = { status(s: number) { code = s; return this; }, json(b: any) { body = b; return this; } };
    await impactChallengeController.getEntrepreneurById({ params: { entrepreneurId: String(ent._id) } }, res, () => undefined);
    check('public entrepreneur has no email, phone or account', code === 200 && body.data && !('email' in body.data) && !('phoneNumber' in body.data) && !('userId' in body.data), JSON.stringify(Object.keys(body?.data ?? {})));
    const hidden = await makeEntrepreneur(ch._id, { approved: false });
    await impactChallengeController.getEntrepreneurById({ params: { entrepreneurId: String(hidden._id) } }, res, () => undefined);
    check('an unapproved entrepreneur is not public', code === 404);
    await impactChallengeController.getEntrepreneurs({ params: { challengeId: String(ch._id) }, query: { approved: 'false' } }, res, () => undefined);
    check('?approved=false no longer lists unapproved ones', body.data.every((e: any) => e.approved === true) && body.data.every((e: any) => !('email' in e)));

    // --- Member API: rules sent with the challenge, and the member's own votes ---
    await ImpactChallengeModel.updateMany({ _id: { $ne: ch._id }, status: ChallengeStatus.ACTIVE }, { $set: { status: ChallengeStatus.CANCELLED } });
    await impactChallengeController.getCurrentChallenge({}, res, () => undefined);
    check('the current challenge carries the vote price and ticket cap', body?.data?.rules?.votePrice === 200 && body?.data?.rules?.maxTicketsPerMonth === 25, JSON.stringify(body?.data?.rules));
    const member = new Types.ObjectId();
    await ChallengeVoteModel.create({ challengeId: ch._id, entrepreneurId: ent._id, userId: member, amountPaid: 600, voteQuantity: 3, voteType: VoteType.VOTE, paymentStatus: VotePaymentStatus.COMPLETED, paymentIntentId: 'M1', isAnonymous: false, tombolaTicketIds: [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()], ticketsGenerated: true });
    await ChallengeVoteModel.create({ challengeId: ch._id, entrepreneurId: ent._id, userId: member, amountPaid: 200, voteQuantity: 1, voteType: VoteType.VOTE, paymentStatus: VotePaymentStatus.PENDING, paymentIntentId: 'M2', isAnonymous: false, tombolaTicketIds: [], ticketsGenerated: false });
    await impactChallengeController.getMyVotes({ user: { userId: String(member) }, params: { challengeId: String(ch._id) } }, res, () => undefined);
    check('my votes lists only completed ones, with their tickets', body?.data?.length === 1 && body.data[0].tickets === 3 && body.data[0].amountPaid === 600, JSON.stringify(body?.data));

    // --- Admin edits cannot touch money or status ---
    const edited = await makeChallenge({ totalCollected: 5000 });
    await impactChallengeService.updateChallenge(String(edited._id), { campaignName: 'Nouveau nom', totalCollected: 999999, status: ChallengeStatus.FUNDS_DISTRIBUTED, winnerTransactionId: 'fake' } as any);
    c = await fresh(edited._id);
    check('an admin edit changes the name but not totals, status or payout ids', c.campaignName === 'Nouveau nom' && c.totalCollected === 5000 && c.status === ChallengeStatus.ACTIVE && !c.winnerTransactionId);

    // --- A payout claim left by a crash can be resumed after 15 minutes ---
    const stuck = await makeChallenge({ status: ChallengeStatus.VOTING_CLOSED, totalCollected: 1000, distributionInProgress: true, distributionStartedAt: new Date(Date.now() - 20 * 60000) });
    await makeEntrepreneur(stuck._id, { isWinner: true, rank: 1 });
    deposits.length = 0;
    await impactChallengeService.distributeFunds(String(stuck._id));
    check('a stale payout claim is taken over and finished', (await fresh(stuck._id)).fundsDistributed === true && deposits.length === 3);
    const busy = await makeChallenge({ status: ChallengeStatus.VOTING_CLOSED, totalCollected: 1000, distributionInProgress: true, distributionStartedAt: new Date() });
    await makeEntrepreneur(busy._id, { isWinner: true, rank: 1 });
    msg = '';
    try { await impactChallengeService.distributeFunds(String(busy._id)); } catch (e: any) { msg = e.message; }
    check('a payout running right now is not taken over', /already running/.test(msg), msg);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
