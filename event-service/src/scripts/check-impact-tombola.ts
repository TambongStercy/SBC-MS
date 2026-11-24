/**
 * SBC Impact Challenge v2, Phase 4 — the tombola: tickets from counted paid
 * votes, Rufus's weights, commit–reveal draw, one prize per member, the
 * 365-day same-category rule, live reveal, history, and an independent
 * recomputation of the winners from the public proof alone. Real MongoDB;
 * user-service and notifications stubbed.
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_impact4_check \
 *     npx ts-node --transpile-only src/scripts/check-impact-tombola.ts
 */
process.env.REDIS_KEY_PREFIX = `impact4-check-${Date.now()}:`;
import { createHash, createHmac, randomBytes } from 'crypto';
import mongoose, { Types } from 'mongoose';
import * as userClient from '../services/clients/user.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import { ImpactEdition, ImpactTombolaDraw, ImpactVoteTx } from '../modules/impact/models';
import { CompetitionStage, DEFAULT_SETTINGS, EditionStatus, PayMethod, RoundStatus, VoteTxStatus } from '../modules/impact/types';
import * as tombola from '../modules/impact/services/tombola.service';
import * as editions from '../modules/impact/services/edition.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_impact4_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };

(userClient as any).getEventUserDetails = async (ids: string[]) => ids.map((id) => ({ _id: id, name: `Awa Ngono${id.slice(-2)}` }));
const pushes: { kind: string; userId?: string }[] = [];
(notificationClient as any).notifyUser = async (a: any) => { pushes.push({ kind: a.kind, userId: a.userId }); return 1; };

const ADMIN = { role: 'admin' as const, userId: new Types.ObjectId().toString() };
let t0 = Date.now() - 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const edition = async (name: string, over: Record<string, unknown> = {}) => ImpactEdition.create({
    name, slug: `${name}-${Date.now()}`.toLowerCase().replace(/\s+/g, '-'), rulesText: 'R'.repeat(300),
    status: EditionStatus.FINAL, stage: CompetitionStage.TOP3,
    schedule: { qualificationOpensAt: new Date(Date.now() - 50 * 86_400_000), qualificationClosesAt: new Date(Date.now() - 40 * 86_400_000) },
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), createdBy: new Types.ObjectId(ADMIN.userId),
    rounds: { PAID: { status: RoundStatus.OPEN } }, ...over,
});
const buy = (editionId: Types.ObjectId, userId: string, votes: number, over: Record<string, unknown> = {}) => ImpactVoteTx.create({
    editionId, candidateId: new Types.ObjectId(), userId: new Types.ObjectId(userId), votes, amount: votes * 200,
    method: PayMethod.MOBILE_MONEY, status: VoteTxStatus.SUCCESS, idempotencyKey: `k${new Types.ObjectId()}`,
    votesCreditedAt: new Date(t0 += 1000), settledAt: new Date(t0), ...over,
});

/** A from-scratch verifier: only the public proof, Node's crypto, and the published method. */
const verifyFromProof = (p: any) => {
    const seg = p.segments as { from: number; to: number; weight: number; holderHash: string }[];
    const canonical = seg.map((g) => `${g.from}-${g.to}:${g.weight}:${g.holderHash}`).join('\n');
    const okCommit = sha(p.seed) === p.seedCommitment;
    const okSegments = sha(canonical) === p.segmentsHash;
    const winners = p.prizes.map((_: unknown, i: number) => {
        const k = i + 1;
        const excl = new Set((p.exclusions.find((x: any) => x.order === k)?.holderHashes) ?? []);
        const el = seg.filter((g) => !excl.has(g.holderHash));
        const W = el.reduce((s, g) => s + (g.to - g.from + 1) * g.weight, 0);
        if (!W) return null;
        const limit = Math.floor(2 ** 48 / W) * W;
        let r = -1;
        for (let a = 0; a < 1000 && r < 0; a++) {
            const x = createHmac('sha256', Buffer.from(p.seed, 'hex')).update(`${p.drawId}|${k}|${a}`).digest().readUIntBE(0, 6);
            if (x < limit) r = x % W;
        }
        for (const g of el) {
            const span = (g.to - g.from + 1) * g.weight;
            if (r < span) return g.from + Math.floor(r / g.weight);
            r -= span;
        }
        return null;
    });
    return { okCommit, okSegments, winners };
};

const main = async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([ImpactEdition, ImpactTombolaDraw, ImpactVoteTx].map((m) => m.init()));

    // ---------- Weights and numbering ----------
    const tiers = DEFAULT_SETTINGS.ticketTiers;
    check('weights: tickets 1–10 = 1, 11–50 = ½, 51+ = ¼ (× 10 000)',
        tombola.tierWeight(1, tiers) === 10000 && tombola.tierWeight(10, tiers) === 10000 && tombola.tierWeight(11, tiers) === 5000
        && tombola.tierWeight(50, tiers) === 5000 && tombola.tierWeight(51, tiers) === 2500 && tombola.tierWeight(500, tiers) === 2500);

    const e = await edition('Tombola test');
    const [X, Y, Z, U] = Array.from({ length: 4 }, () => new Types.ObjectId().toString());
    await buy(e._id, X, 5);   // X: tickets 1–5
    await buy(e._id, Y, 2);   // Y: 6–7
    await buy(e._id, X, 7);   // X: 8–14 (X's 6th–12th: 8–12 weigh 1, 13–14 weigh ½)
    await buy(e._id, Z, 60);  // Z: 15–74 (1×10, ½×40, ¼×10)
    await buy(e._id, U, 1);   // U: 75
    await buy(e._id, Y, 3, { lateSettlement: true }); // refunded late: no ticket
    await buy(e._id, Y, 3, { status: VoteTxStatus.REFUNDED }); // refunded: no ticket
    await buy(e._id, Y, 3, { status: VoteTxStatus.PENDING, votesCreditedAt: undefined }); // unpaid: no ticket
    const tk = await tombola.buildTickets(e, 'k');
    const segOf = (u: string) => tk.segments.filter((g) => String(g.userId) === u).map((g) => `${g.from}-${g.to}@${g.weight}`).join(' ');
    check('tickets numbered in counting order, only counted votes', tk.totalTickets === 75 && tk.participants === 4);
    check('a holder’s 11th ticket weighs ½ (X)', segOf(X) === '1-5@10000 8-12@10000 13-14@5000', segOf(X));
    check('a big buyer: 10 at 1, 40 at ½, then ¼ (Z)', segOf(Z) === '15-24@10000 25-64@5000 65-74@2500', segOf(Z));
    // X: 10 at 1 + 2 at ½; Y: 2 at 1; Z: 10 at 1 + 40 at ½ + 10 at ¼; U: 1 at 1.
    check('total weight', tk.totalWeight === (10 * 10000 + 2 * 5000) + 2 * 10000 + (10 * 10000 + 40 * 5000 + 10 * 2500) + 10000, String(tk.totalWeight));

    // ---------- Fairness of the sampling ----------
    const two = [
        { from: 1, to: 100, weight: 1, holderHash: 'A' },
        { from: 101, to: 101, weight: 1, holderHash: 'B' },
    ] as any[];
    const big = [{ from: 1, to: 10, weight: 10000, holderHash: 'A' }, { from: 11, to: 50, weight: 5000, holderHash: 'A' }, { from: 51, to: 100, weight: 2500, holderHash: 'A' }, { from: 101, to: 101, weight: 10000, holderHash: 'B' }] as any[];
    let bWins = 0;
    for (let i = 0; i < 4000; i++) if (tombola.pickTicket(randomBytes(32).toString('hex'), 'd', 1, big, new Set())!.segment.holderHash === 'B') bWins++;
    // B's chance = 1 / (10 + 20 + 12.5 + 1) = 2.30 % → ~92 of 4000
    check('chances follow the weights (1 ticket vs 100 weighted: ~2.3 %)', bWins > 50 && bWins < 140, `${bWins}/4000`);
    const p1 = tombola.pickTicket('ab'.repeat(32), 'd', 1, two, new Set());
    const p2 = tombola.pickTicket('ab'.repeat(32), 'd', 1, two, new Set());
    check('same seed, same result (reproducible)', p1!.ticketNumber === p2!.ticketNumber);
    check('an excluded holder can never be picked', Array.from({ length: 200 }, (_, i) => tombola.pickTicket(randomBytes(32).toString('hex'), 'd', i, two, new Set(['A']))!.segment.holderHash).every((h) => h === 'B'));

    // ---------- A past win (other edition, 100 days ago): X won « cash » ----------
    const old = await edition('Ancienne édition', { status: EditionStatus.FINISHED });
    await ImpactTombolaDraw.create({
        editionId: old._id, status: 'DONE', seedCommitment: 'x', seed: 'x', committedAt: new Date(), committedBy: new Types.ObjectId(),
        committedBeforeTicketsClosed: true, drawnAt: new Date(Date.now() - 100 * 86_400_000),
        prizes: [{ key: 'cash', label: 'Cash', category: 'cash' }],
        winners: [{ order: 1, prizeKey: 'cash', prizeLabel: 'Cash', category: 'cash', ticketNumber: 3, userId: new Types.ObjectId(X), holderHash: 'h', displayName: 'X', attempts: 1, status: 'DELIVERED' }],
    });

    // ---------- Commit, draw ----------
    const id = String(e._id);
    const c = await tombola.commitDraw(ADMIN, id);
    check('commitment: sha256 published, seed hidden, fixed before tickets closed', /^[0-9a-f]{64}$/.test(c.seedCommitment) && c.seed === null && c.committedBeforeTicketsClosed === true);
    check('one commitment per edition', (await refusal(() => tombola.commitDraw(ADMIN, id)))?.code === 'ALREADY_COMMITTED');
    check('no draw before the tickets are final (TOP 3)', (await refusal(() => tombola.runDraw(ADMIN, id)))?.code === 'TICKETS_NOT_FINAL');
    const pub0: any = await tombola.publicTombola();
    check('public before the draw: commitment and live ticket count, no seed', pub0 === null || pub0.draw?.seed === null);
    await ImpactEdition.updateOne({ _id: e._id }, { $set: { 'top3.decidedAt': new Date(), 'rounds.PAID.status': RoundStatus.CLOSED } });
    const ov: any = await tombola.overview(id);
    check('overview: tickets, participants, biggest holders with their share', ov.tickets.totalTickets === 75 && ov.tickets.participants === 4 && ov.tickets.topHolders[0].userId === Z && ov.canDraw === true);

    const drawn: any = await tombola.runDraw(ADMIN, id);
    check('draw done: seed revealed and matches the commitment', drawn.status === 'DONE' && sha(drawn.seed) === c.seedCommitment);
    check('3 prizes, 3 different winners', drawn.winners.length === 3 && new Set(drawn.winners.map((w: any) => w.userId)).size === 3);
    const cashWinner = drawn.winners.find((w: any) => w.prizeKey === 'cash');
    check('X won « cash » 100 days ago: cannot win it again', cashWinner.userId !== X);
    const d = await ImpactTombolaDraw.findOne({ editionId: e._id }).lean();
    const xHash = tombola.holderHashOf(X, String(d!._id));
    check('the exclusion is published (proof)', d!.snapshot!.exclusions[0].holderHashes.includes(xHash) && !d!.snapshot!.exclusions[1].holderHashes.includes(xHash));
    check('the draw is final', (await refusal(() => tombola.runDraw(ADMIN, id)))?.code === 'ALREADY_DRAWN');
    const ovAfter: any = await tombola.overview(id);
    check('admin read after the draw carries the seed', ovAfter.draw.seed === drawn.seed);
    check('the edition says when the tombola was drawn', Boolean((await ImpactEdition.findById(e._id))!.tombolaDrawnAt));
    check('prizes lock once drawn', (await refusal(() => editions.updateEdition(ADMIN, id, { settings: { prizes: [{ key: 'velo', label: 'Un vélo', category: 'velo' }] } })))?.details?.fields?.includes('settings.prizes'));
    check('no winner told before the reveal', !pushes.some((p) => p.kind === 'impact-tombola-won'));

    // ---------- Anyone can check it ----------
    const proof: any = await tombola.proof(String(d!._id));
    const v = verifyFromProof(proof);
    check('independent check: seed matches the commitment', v.okCommit);
    check('independent check: the published tickets match their hash', v.okSegments);
    check('independent check: same winning tickets as the server', v.winners.join() === drawn.winners.map((w: any) => w.ticketNumber).join(), `${v.winners.join()} vs ${drawn.winners.map((w: any) => w.ticketNumber).join()}`);
    check('the proof shows no member id', !JSON.stringify(proof).includes(X) && !JSON.stringify(proof).includes(Z));

    // ---------- Live reveal ----------
    tombola.invalidateTombola();
    const pub1: any = await tombola.publicTombola();
    check('public: no winner shown before the reveal', pub1.draw.winners.length === 0 && pub1.draw.revealedCount === 0 && pub1.totalTickets === 75);
    await tombola.reveal(ADMIN, id);
    tombola.invalidateTombola();
    const pub2: any = await tombola.publicTombola();
    check('reveal one: first prize shown (ticket, masked name)', pub2.draw.winners.length === 1 && pub2.draw.winners[0].ticketNumber === drawn.winners[0].ticketNumber && /^\S+ \S\.$/.test(pub2.draw.winners[0].displayName) && !('userId' in pub2.draw.winners[0]));
    check('the revealed winner is told then', pushes.filter((p) => p.kind === 'impact-tombola-won').length === 1 && pushes[0].userId === drawn.winners[0].userId);
    await tombola.reveal(ADMIN, id); await tombola.reveal(ADMIN, id);
    check('no reveal beyond the winners', (await refusal(() => tombola.reveal(ADMIN, id)))?.code === 'ALL_REVEALED');

    // ---------- Members, statuses, history ----------
    const mine = await tombola.myTickets(X);
    check('member: tickets, number ranges, share', mine!.tickets === 12 && mine!.ranges.map((r) => `${r.from}-${r.to}`).join() === '1-5,8-14' && mine!.sharePct > 0);
    const w1 = drawn.winners[0];
    check('a forfeited prize needs a reason', (await refusal(() => tombola.setWinnerStatus(ADMIN, id, 1, { status: 'FORFEITED' })))?.code === 'REASON_REQUIRED');
    await tombola.setWinnerStatus(ADMIN, id, 1, { status: 'DELIVERED', note: 'Remis en main propre' });
    const hist = await tombola.history({ admin: false });
    check('history: edition, date, ticket, winner, prize, status (no member id)', hist.length === 2 && hist[0].editionName === 'Tombola test' && hist[0].winners[0].status === 'DELIVERED' && hist[0].winners[0].ticketNumber === w1.ticketNumber && !JSON.stringify(hist).includes(X));

    // ---------- Fewer holders than prizes ----------
    const e2 = await edition('Petite tombola', { 'top3': { decidedAt: new Date() }, rounds: { PAID: { status: RoundStatus.CLOSED } } });
    const [P, Q] = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
    await buy(e2._id, P, 3); await buy(e2._id, Q, 1);
    const c2 = await tombola.commitDraw(ADMIN, String(e2._id));
    check('a commitment made after the tickets closed says so', c2.committedBeforeTicketsClosed === false);
    const d2: any = await tombola.runDraw(ADMIN, String(e2._id));
    check('2 holders, 3 prizes: the third is not awarded', d2.winners.filter((w: any) => w.status === 'NOT_AWARDED').length === 1 && d2.winners[2].ticketNumber === null);
    const v2 = verifyFromProof(await tombola.proof(String((await ImpactTombolaDraw.findOne({ editionId: e2._id }))!._id)));
    check('independent check holds with exclusions', v2.okCommit && v2.okSegments && v2.winners.join() === d2.winners.map((w: any) => w.ticketNumber).join());

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
