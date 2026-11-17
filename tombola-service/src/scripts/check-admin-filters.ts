/**
 * Asserts the admin list filters ?country, ?from, ?to (admin plan, phase 3)
 * on the tombola and Impact Challenge admin endpoints.
 *
 *  - tombola months: startDate; country does not apply.
 *  - tickets / ticket numbers of a month: purchaseTimestamp; buyer's country.
 *  - challenges list: startDate; has an entrepreneur from the country.
 *  - challenge details: entrepreneurs by entrepreneur.country (code or name) and createdAt.
 *  - votes: createdAt; voter's country. Analytics: same votes, counted ones only.
 *
 * user-service is replaced by a stubbed country resolver. Uses its own
 * database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import TombolaMonthModel, { TombolaStatus } from '../database/models/tombolaMonth.model';
import TombolaTicketModel from '../database/models/tombolaTicket.model';
import ImpactChallengeModel, { ChallengeStatus } from '../database/models/impact-challenge.model';
import EntrepreneurModel from '../database/models/entrepreneur.model';
import ChallengeVoteModel, { VotePaymentStatus, VoteType } from '../database/models/challenge-vote.model';
import { userServiceClient } from '../services/clients/user.service.client';
import { setCountryResolverForTests } from '../utils/country-members';
import { parseAdminFilters } from '../utils/admin-filters';
import { tombolaService } from '../services/tombola.service';
import { impactChallengeService } from '../services/impact-challenge.service';
import { challengeVoteService } from '../services/challenge-vote.service';
import { entrepreneurService } from '../services/entrepreneur.service';
import { adminController } from '../api/controllers/admin.controller';
import { impactChallengeController } from '../api/controllers/impact-challenge.controller';

const DB = process.env.FILTERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_tombola_filters_check';

const cm1 = new Types.ObjectId();
const cm2 = new Types.ObjectId();
const bj1 = new Types.ObjectId();

let resolverCalls = 0;
setCountryResolverForTests(async (code) => {
    resolverCalls++;
    if (code === 'GA') throw new Error('user-service down');
    if (code === 'CM') return [cm1.toString(), cm2.toString(), new Types.ObjectId().toString()];
    if (code === 'BJ') return [bj1.toString()];
    return [];
});
// No network in this check.
(userServiceClient as any).getUsersByIds = async () => [];
(userServiceClient as any).findUserIdsBySearchTerm = async () => [cm1.toString(), bj1.toString()];

const f = (q: Record<string, string>) => parseAdminFilters(q);
const setCreatedAt = (model: mongoose.Model<any>, _id: Types.ObjectId, at: string) =>
    model.collection.updateOne({ _id }, { $set: { createdAt: new Date(at) } });

/** Runs an express handler with a fake req/res; returns what it answered or passed on. */
async function call(handler: (req: any, res: any, next: any) => Promise<void>, params: Record<string, string>, query: Record<string, string>) {
    const out: { status?: number; body?: any; error?: any } = {};
    const res: any = {
        status(code: number) { out.status = code; return res; },
        json(body: any) { out.body = body; if (out.status === undefined) out.status = 200; return res; },
    };
    await handler({ params, query, body: {} }, res, (err: any) => { out.error = err; });
    return out;
}

async function main() {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    // Let the index builds finish now, or one lands after the final drop and
    // leaves the database behind.
    await Promise.all([TombolaMonthModel, TombolaTicketModel, ImpactChallengeModel, EntrepreneurModel, ChallengeVoteModel].map(m => (m as mongoose.Model<any>).init()));

    // --- parse rules ---
    assert.deepStrictEqual(f({}), {});
    assert.deepStrictEqual(f({ country: 'ALL' }), {});
    assert.strictEqual(f({ country: 'cm' }).country, 'CM');
    assert.throws(() => f({ country: 'zz9' }), /Code pays invalide/);
    assert.throws(() => f({ from: '16/11/2026' }), /Date « from » invalide/);
    assert.throws(() => f({ from: '2026-02-01', to: '2026-01-01' }), /doit précéder/);
    assert.strictEqual(f({ to: '2026-01-31' }).to!.toISOString(), '2026-01-31T23:59:59.999Z');

    // --- tombola fixtures ---
    const m1 = await TombolaMonthModel.create({ month: 1, year: 2026, status: TombolaStatus.OPEN, startDate: new Date('2026-01-05'), lastTicketNumber: 3 });
    await TombolaMonthModel.create({ month: 3, year: 2026, status: TombolaStatus.CLOSED, startDate: new Date('2026-03-05') });
    const ticket = (userId: Types.ObjectId, n: number, at: string) => TombolaTicketModel.create({
        userId, tombolaMonthId: m1._id, ticketId: `t${n}`, ticketNumber: n, purchaseTimestamp: new Date(at),
    });
    await ticket(cm1, 1, '2026-01-10T10:00:00Z');
    await ticket(cm1, 2, '2026-02-10T10:00:00Z');
    await ticket(bj1, 3, '2026-01-15T10:00:00Z');
    const m1id = m1._id.toString();

    // Months: dates on startDate, country ignored.
    assert.strictEqual((await tombolaService.listAllTombolasAdmin(20, 0, {})).totalCount, 2);
    assert.strictEqual((await tombolaService.listAllTombolasAdmin(20, 0, f({ from: '2026-02-01' }))).totalCount, 1);
    assert.strictEqual((await tombolaService.listAllTombolasAdmin(20, 0, f({ to: '2026-01-05' }))).totalCount, 1);
    assert.strictEqual((await tombolaService.listAllTombolasAdmin(20, 0, f({ country: 'BJ' }))).totalCount, 2);

    // Tickets: buyer's country, purchaseTimestamp.
    const tickets = (q: Record<string, string>, search?: string) => tombolaService.listTicketsForMonthAdmin(m1id, 50, 0, search, f(q));
    assert.strictEqual((await tickets({})).totalCount, 3);
    assert.strictEqual((await tickets({ country: 'CM' })).totalCount, 2);
    assert.strictEqual((await tickets({ country: 'bj' })).totalCount, 1);
    assert.strictEqual((await tickets({ country: 'SN' })).totalCount, 0);
    assert.strictEqual((await tickets({ from: '2026-01-01', to: '2026-01-31' })).totalCount, 2);
    assert.strictEqual((await tickets({ country: 'CM', to: '2026-01-31' })).totalCount, 1);
    assert.strictEqual((await tickets({ country: 'CM' }, 'awa')).totalCount, 2, 'search ∩ country');
    assert.deepStrictEqual((await tombolaService.getAllTicketNumbersForMonth(m1id, f({ country: 'CM' }))).sort(), [1, 2]);
    assert.deepStrictEqual((await tombolaService.getAllTicketNumbersForMonth(m1id, f({ from: '2026-02-01' }))), [2]);
    assert.strictEqual((await tombolaService.getAllTicketNumbersForMonth(m1id, {})).length, 3);

    // Cache: CM and BJ were each resolved once.
    const before = resolverCalls;
    await tickets({ country: 'CM' });
    assert.strictEqual(resolverCalls, before, 'country ids are cached');

    // Controllers: 400 on bad input, 502 when user-service fails.
    let r = await call(adminController.listTicketsForMonth.bind(adminController), { monthId: m1id }, { country: 'zz9' });
    assert.strictEqual(r.status, 400);
    r = await call(adminController.listTicketsForMonth.bind(adminController), { monthId: m1id }, { country: 'GA' });
    assert.strictEqual(r.status, 502);
    assert.match(r.body.message, /Filtre pays indisponible/);
    r = await call(adminController.listTombolas.bind(adminController), {}, { from: 'demain' });
    assert.strictEqual(r.status, 400);
    r = await call(adminController.getAllTicketNumbers.bind(adminController), { monthId: m1id }, { country: 'CM' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data.length, 2);

    // --- Impact Challenge fixtures ---
    const challenge = (month: number, start: string) => ImpactChallengeModel.create({
        campaignName: `C${month}`, month, year: 2026, status: ChallengeStatus.ACTIVE,
        startDate: new Date(start), endDate: new Date(new Date(start).getTime() + 20 * 86400000),
        description: { fr: 'x', en: 'x' }, tombolaMonthId: new Types.ObjectId(),
    });
    const c1 = await challenge(1, '2026-01-01T00:00:00Z');
    const c2 = await challenge(6, '2026-06-01T00:00:00Z');
    const entrepreneur = (challengeId: Types.ObjectId, name: string, country: string) => EntrepreneurModel.create({
        challengeId, name, email: `${name}@example.com`, phoneNumber: '+237600000000', country, city: 'X',
        projectName: 'P', projectDescription: { fr: 'x', en: 'x' }, businessCategory: 'agri',
        videoUrl: 'https://v', videoFilename: 'v.mp4', approved: true,
    });
    const e1 = await entrepreneur(c1._id, 'awa', 'CM');
    const e2 = await entrepreneur(c1._id, 'kofi', 'Bénin');
    const e3 = await entrepreneur(c2._id, 'fatou', 'sn');
    await setCreatedAt(EntrepreneurModel, e1._id, '2025-12-20T00:00:00Z');
    await setCreatedAt(EntrepreneurModel, e2._id, '2025-12-28T00:00:00Z');
    await setCreatedAt(EntrepreneurModel, e3._id, '2026-05-20T00:00:00Z');

    const vote = async (entrepreneurId: Types.ObjectId, userId: Types.ObjectId | undefined, qty: number, at: string, over: Record<string, unknown> = {}) => {
        const v = await ChallengeVoteModel.create({
            challengeId: c1._id, entrepreneurId, userId, amountPaid: qty * 200, voteQuantity: qty,
            paymentStatus: VotePaymentStatus.COMPLETED, voteType: userId ? VoteType.VOTE : VoteType.SUPPORT, ...over,
        });
        await setCreatedAt(ChallengeVoteModel, v._id, at);
    };
    await vote(e1._id, cm1, 3, '2026-01-10T00:00:00Z');
    await vote(e2._id, bj1, 2, '2026-02-01T00:00:00Z');
    await vote(e1._id, undefined, 1, '2026-01-12T00:00:00Z');                                       // non-member support
    await vote(e2._id, cm2, 5, '2026-01-13T00:00:00Z', { paymentStatus: VotePaymentStatus.PENDING }); // not paid
    await vote(e1._id, cm2, 4, '2026-01-20T00:00:00Z', { lateAfterClose: true });                    // paid late: listed, not counted
    const c1id = c1._id.toString();

    // Challenges list: startDate; country through entrepreneur.country (code or name, any case).
    const list = (q: Record<string, string>) => impactChallengeService.listChallenges(1, 10, undefined, f(q));
    assert.strictEqual((await list({})).total, 2);
    assert.strictEqual((await list({ country: 'cm' })).total, 1);
    assert.strictEqual((await list({ country: 'BJ' })).total, 1, '"Bénin" matches BJ');
    assert.strictEqual((await list({ country: 'SN' })).challenges[0].campaignName, 'C6', '"sn" matches SN');
    assert.strictEqual((await list({ country: 'CI' })).total, 0);
    assert.strictEqual((await list({ from: '2026-03-01' })).total, 1);
    assert.strictEqual((await list({ to: '2026-01-01' })).total, 1);

    // Details: entrepreneurs filtered.
    const ents = (q: Record<string, string>) => entrepreneurService.listEntrepreneursByChallenge(c1id, false, f(q));
    assert.strictEqual((await ents({})).length, 2);
    assert.deepStrictEqual((await ents({ country: 'BJ' })).map(e => e.name), ['kofi']);
    assert.deepStrictEqual((await ents({ from: '2025-12-25' })).map(e => e.name), ['kofi']);
    r = await call(impactChallengeController.getAdminChallengeDetails.bind(impactChallengeController), { challengeId: c1id }, { country: 'CM' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.data.entrepreneurs.map((e: any) => e.name), ['awa']);

    // Votes: completed only (late ones included, as before), voter's country, createdAt.
    const votes = (q: Record<string, string>) => challengeVoteService.getVotesByChallenge(c1id, 1, 20, f(q));
    assert.strictEqual((await votes({})).total, 4);
    assert.strictEqual((await votes({ country: 'CM' })).total, 2);
    assert.strictEqual((await votes({ country: 'BJ' })).total, 1);
    assert.strictEqual((await votes({ country: 'SN' })).total, 0);
    assert.strictEqual((await votes({ from: '2026-01-11', to: '2026-01-31' })).total, 2);

    // Analytics: unfiltered = stored totals; filtered = recomputed from counted votes.
    await ImpactChallengeModel.updateOne({ _id: c1._id }, { totalVoteCount: 6, totalCollected: 1200 });
    const a0 = await impactChallengeService.getChallengeAnalytics(c1id, {});
    assert.strictEqual(a0.totalVotes, 6);
    const aCM = await impactChallengeService.getChallengeAnalytics(c1id, f({ country: 'CM' }));
    assert.strictEqual(aCM.totalVotes, 3, 'late CM vote not counted');
    assert.strictEqual(aCM.totalAmount, 600);
    assert.deepStrictEqual(aCM.entrepreneurBreakdown.map(e => [e.name, e.voteCount]), [['awa', 3], ['kofi', 0]]);
    const aJan = await impactChallengeService.getChallengeAnalytics(c1id, f({ from: '2026-01-01', to: '2026-01-31' }));
    assert.strictEqual(aJan.totalVotes, 4, 'cm1 3 + support 1');
    const aAll = await impactChallengeService.getChallengeAnalytics(c1id, f({ from: '2020-01-01' }));
    assert.strictEqual(aAll.totalVotes, a0.totalVotes, 'recomputed = stored totals');

    r = await call(impactChallengeController.getVotes.bind(impactChallengeController), { challengeId: c1id }, { country: 'GA' });
    assert.strictEqual(r.error?.statusCode, 502, 'votes: user-service down → 502');
    r = await call(impactChallengeController.getChallengeAnalytics.bind(impactChallengeController), { challengeId: c1id }, { to: 'x' });
    assert.strictEqual(r.status, 400);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('OK tombola admin filters (months, tickets, ticket numbers, challenges, details, votes, analytics)');
}

main().catch(async (error) => {
    console.error('FAIL', error);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
