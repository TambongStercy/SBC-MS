/**
 * Admin list/stats filters ?country, ?from, ?to (admin plan, phase 3) on every
 * /tickets/admin/* endpoint, animation admin included. Real Express routers
 * against a throwaway MongoDB; the user-service country lookup is stubbed.
 *
 *   mise exec node@22 -- npx ts-node --transpile-only src/scripts/check-admin-filters.ts
 * Uses its own database (dropped at the end).
 */
import assert from 'assert';
import { AddressInfo } from 'net';
import axios from 'axios';
import express, { NextFunction, Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Event from '../database/models/event.model';
import Organizer from '../database/models/organizer.model';
import Order from '../database/models/order.model';
import Ticket from '../database/models/ticket.model';
import ResaleListing from '../database/models/resale-listing.model';
import Dispute from '../database/models/dispute.model';
import Commission from '../database/models/commission.model';
import Refund from '../database/models/refund.model';
import { AnimCandidate, AnimChallenge } from '../modules/animation/models/challenge.model';
import { AnimAuditLog, AnimChangeRequest, AnimFraudFlag } from '../modules/animation/models/governance.model';
import { AnimVoteRefund, AnimVoteTransaction } from '../modules/animation/models/vote.model';
import { setMemberIdsResolver } from '../utils/country-members';
import { eventCountryCode } from '../utils/event-country';
import adminRoutes from '../api/routes/admin.routes';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_event_filters_check';
const oid = () => new Types.ObjectId();
const d = (s: string) => new Date(s);

(async () => {
    // No index builds: they would recreate collections after the final drop.
    await mongoose.connect(URI, { autoIndex: false, autoCreate: false });
    await mongoose.connection.db!.dropDatabase();

    // ---- pure resolver ----
    for (const [raw, code] of [['CM', 'CM'], ['cm ', 'CM'], ['Cameroun', 'CM'], ['CAMEROON', 'CM'], ['Bénin', 'BJ'],
        ['benin', 'BJ'], ["Côte d'Ivoire", 'CI'], ['cote-d’ivoire', 'CI'], ['RDC', 'CD'], ['Congo-Brazzaville', 'CG']] as const) {
        assert.strictEqual(eventCountryCode(raw), code, `eventCountryCode(${raw})`);
    }
    assert.strictEqual(eventCountryCode('Atlantis'), undefined);
    assert.strictEqual(eventCountryCode(''), undefined);

    // ---- fixtures ----
    const [U1, U2, U3, U4] = [oid(), oid(), oid(), oid()];
    const [O1, O2, O3, O4] = [oid(), oid(), oid(), oid()];
    await Organizer.collection.insertMany([
        { _id: O1, userId: U1, status: 'APPROVED', createdAt: d('2026-01-05') },
        { _id: O2, userId: U2, status: 'APPROVED', createdAt: d('2026-02-05') },
        { _id: O3, userId: U3, status: 'PENDING', createdAt: d('2026-03-05') }, // no event, member in CM
        { _id: O4, userId: U4, status: 'PENDING', createdAt: d('2026-04-05') }, // no event, member in BJ
    ] as any[]);
    const members: Record<string, string[]> = { CM: [String(U3), String(U1)], BJ: [String(U4)] };
    let lookups = 0;
    setMemberIdsResolver(async (c) => { lookups++; return members[c] ?? []; });

    const [E1, E2, E3, E4, E5, E6] = [oid(), oid(), oid(), oid(), oid(), oid()];
    const ev = (_id: Types.ObjectId, organizerId: Types.ObjectId, country: string | undefined, startsAt: string, status = 'PUBLISHED') =>
        ({ _id, organizerId, country, startsAt: d(startsAt), status, title: `ev ${_id}`, city: 'x', createdAt: d('2026-01-01') });
    await Event.collection.insertMany([
        ev(E1, O1, 'CM', '2026-03-10T12:00:00Z'),
        ev(E2, O1, 'Cameroun', '2026-05-10T12:00:00Z', 'COMPLETED'),
        ev(E3, O1, 'cm ', '2026-06-10T12:00:00Z'),
        ev(E4, O2, 'Bénin', '2026-03-10T12:00:00Z'),
        ev(E5, O2, 'BJ', '2026-05-10T12:00:00Z'),
        ev(E6, O2, undefined, '2026-05-10T12:00:00Z'),
    ] as any[]);
    const CM = [E1, E2, E3];

    // One order + ticket + listing + dispute + commission per event; March for E1/E4, May otherwise.
    const when = (e: Types.ObjectId) => (e.equals(E1) || e.equals(E4) ? d('2026-03-15') : d('2026-05-15'));
    const all = [E1, E2, E3, E4, E5, E6];
    const orderIds = new Map<string, Types.ObjectId>();
    for (const e of all) {
        const o = oid(); orderIds.set(String(e), o);
        await Order.collection.insertOne({ _id: o, eventId: e, userId: U1, kind: 'PRIMARY', status: 'PAID', subtotal: 1000, total: 1100, paidAt: when(e), createdAt: when(e) } as any);
        await Ticket.collection.insertOne({ eventId: e, orderId: o, status: 'ISSUED', serial: `S${o}`, createdAt: when(e) } as any);
        await ResaleListing.collection.insertOne({ eventId: e, ticketId: oid(), sellerUserId: U1, status: 'ACTIVE', listedAt: when(e), createdAt: when(e) } as any);
        await Dispute.collection.insertOne({ eventId: e, kind: 'OTHER', complainantUserId: U1, status: 'OPEN', description: 'xxxxxxxxxx', createdAt: when(e) } as any);
        await Commission.collection.insertOne({ eventId: e, kind: 'PRIMARY', amount: 100, basisAmount: 1000, rate: 0.1, sbcRevenueBookedAt: when(e), createdAt: when(e) } as any);
        await Refund.collection.insertOne({ orderId: o, amount: 1100, status: 'COMPLETED', initiatedByAdminId: U1, createdAt: when(e) } as any);
    }
    await Dispute.collection.insertOne({ kind: 'OTHER', complainantUserId: U1, status: 'OPEN', description: 'no event at all', createdAt: d('2026-05-15') } as any);

    // Animation: a challenge on E1 (CM) and on E4 (BJ), with records of each kind.
    const [C1, C4] = [oid(), oid()];
    for (const [c, e, org, at] of [[C1, E1, O1, d('2026-03-15')], [C4, E4, O2, d('2026-05-15')]] as const) {
        await AnimChallenge.collection.insertOne({ _id: c, eventId: e, organizerId: org, name: `ch ${e}`, slug: String(c), status: 'LIVE', counters: { freeVotes: 3, paidVotes: 2, candidates: 1, paidRevenue: 500 }, createdAt: at, updatedAt: at } as any);
        await AnimCandidate.collection.insertOne({ challengeId: c, eventId: e, organizerId: org, userId: oid(), number: 1, createdAt: at } as any);
        await AnimFraudFlag.collection.insertOne({ challengeId: c, eventId: e, organizerId: org, status: 'OPEN', subjectType: 'IP', subjectId: 'h', score: 1, createdAt: at } as any);
        await AnimVoteTransaction.collection.insertOne({ challengeId: c, eventId: e, organizerId: org, userId: U1, status: 'SUCCESS', amount: 500, commissionAmount: 50, votes: 2, createdAt: at } as any);
        await AnimChangeRequest.collection.insertOne({ eventId: e, organizerId: org, status: 'PENDING', targetType: 'CHALLENGE', targetId: c, diff: [], createdAt: at } as any);
        await AnimVoteRefund.collection.insertOne({ challengeId: c, eventId: e, userId: U1, status: 'FAILED', createdAt: at, updatedAt: at } as any);
        await AnimAuditLog.collection.insertOne({ eventId: e, challengeId: c, action: 'x', at } as any);
    }
    await AnimAuditLog.collection.insertOne({ action: 'platform', at: d('2026-03-15') } as any);

    // ---- HTTP through the real routers ----
    const app = express();
    app.use(express.json());
    app.use('/a', adminRoutes);
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/a`;
    const get = async (path: string) => {
        const r = await axios.get(base + path, { validateStatus: () => true });
        return r;
    };
    const total = async (path: string) => {
        const r = await get(path);
        assert.strictEqual(r.status, 200, `${path} → ${r.status} ${JSON.stringify(r.data)}`);
        return Array.isArray(r.data.data) ? r.data.data.length : r.data.data.total;
    };

    try {
        // Validation (every list endpoint, same helper).
        for (const p of ['/events', '/orders', '/tickets', '/resale-listings', '/disputes', '/organizers', '/dashboard',
            '/animation/stats', '/animation/challenges', '/animation/fraud', '/animation/transactions', '/animation/audit',
            '/animation/change-requests', '/animation/refunds']) {
            for (const q of ['country=zz9', 'country=C', 'from=yesterday', 'from=2026-05-01&to=2026-04-01']) {
                const r = await get(`${p}?${q}`);
                assert.strictEqual(r.status, 400, `${p}?${q} should be 400, got ${r.status}`);
                assert.ok(/[éè]|Code pays|Date|date/.test(r.data.message), `French message for ${p}?${q}`);
            }
        }

        // Events: country on the free-text field, dates on startsAt.
        assert.strictEqual(await total('/events'), 6);
        assert.strictEqual(await total('/events?country=ALL'), 6);
        assert.strictEqual(await total('/events?country=CM'), 3, 'CM + Cameroun + "cm "');
        assert.strictEqual(await total('/events?country=cm'), 3, 'code any case');
        assert.strictEqual(await total('/events?country=BJ'), 2, 'BJ + Bénin');
        assert.strictEqual(await total('/events?country=FR'), 0);
        assert.strictEqual(await total('/events?to=2026-03-10'), 2, 'bare `to` = end of day (startsAt 12:00)');
        assert.strictEqual(await total('/events?from=2026-04-01T00:00:00Z'), 4);
        assert.strictEqual(await total('/events?country=CM&from=2026-04-01&to=2026-05-31'), 1);
        assert.strictEqual(await total('/events?country=CM&status=COMPLETED'), 1, 'other filters still apply');

        // Event-owned lists.
        for (const p of ['/orders', '/tickets', '/resale-listings']) {
            assert.strictEqual(await total(p), 6, p);
            assert.strictEqual(await total(`${p}?country=CM`), 3, `${p} CM`);
            assert.strictEqual(await total(`${p}?country=BJ&from=2026-05-01`), 1, `${p} BJ May`);
            assert.strictEqual(await total(`${p}?country=FR`), 0, `${p} FR`);
            assert.strictEqual(await total(`${p}?from=2026-03-01&to=2026-03-31`), 2, `${p} March`);
        }
        assert.strictEqual(await total(`/orders?country=CM&eventId=${E4}`), 0, 'eventId and country both apply');
        assert.strictEqual(await total(`/orders?country=CM&eventId=${E1}`), 1);
        assert.strictEqual(await total('/disputes'), 7);
        assert.strictEqual(await total('/disputes?country=CM'), 3, 'event-less dispute left out');
        assert.strictEqual(await total('/disputes?from=2026-05-01'), 5);

        // Organizers: by their events, else by their member's country.
        assert.strictEqual(await total('/organizers'), 4);
        const cmOrgs = (await get('/organizers?country=CM')).data.data.items.map((o: any) => String(o._id)).sort();
        assert.deepStrictEqual(cmOrgs, [String(O1), String(O3)].sort(), 'O1 (CM events) + O3 (eventless CM member)');
        const bjOrgs = (await get('/organizers?country=BJ')).data.data.items.map((o: any) => String(o._id)).sort();
        assert.deepStrictEqual(bjOrgs, [String(O2), String(O4)].sort());
        assert.strictEqual(await total('/organizers?country=CM&from=2026-02-01'), 1, 'O3 only');
        const before = lookups;
        await total('/organizers?country=CM');
        assert.strictEqual(lookups, before, 'member ids cached');
        setMemberIdsResolver(async () => { throw new Error('down'); });
        const down = await get('/organizers?country=SN');
        assert.strictEqual(down.status, 502, 'user-service down → 502');
        assert.ok(/indisponible/.test(down.data.message));
        setMemberIdsResolver(async (c) => members[c] ?? []);

        // Dashboard: every figure filtered.
        const dash = async (q: string) => (await get(`/dashboard${q}`)).data.data;
        const full = await dash('');
        assert.strictEqual(full.events.total, 6);
        assert.strictEqual(full.orders.paidCount, 6);
        const cm = await dash('?country=CM');
        assert.strictEqual(cm.events.total, 3);
        assert.strictEqual(cm.events.completed, 1);
        assert.strictEqual(cm.organizers.total, 2);
        assert.strictEqual(cm.orders.paidCount, 3);
        assert.strictEqual(cm.orders.gross, 3000);
        assert.strictEqual(cm.tickets.total, 3);
        assert.strictEqual(cm.commissions.primary.total, 300);
        assert.strictEqual(cm.resale.active, 3);
        assert.strictEqual(cm.refunds.count, 3, 'refunds through their order');
        const cmMarch = await dash('?country=CM&from=2026-03-01&to=2026-03-31');
        assert.strictEqual(cmMarch.events.total, 1);
        assert.strictEqual(cmMarch.orders.paidCount, 1);
        assert.strictEqual(cmMarch.refunds.total, 1100);
        assert.strictEqual(cmMarch.organizers.total, 1, 'O3 created in March');
        const fr = await dash('?country=FR');
        assert.strictEqual(fr.events.total + fr.orders.paidCount + fr.tickets.total + fr.refunds.count, 0);

        // Animation admin.
        const st = async (q: string) => (await get(`/animation/stats${q}`)).data.data;
        const s0 = await st('');
        assert.strictEqual(s0.challenges.total, 2);
        assert.strictEqual(s0.eventsUsingModule, 2);
        const sCm = await st('?country=CM');
        assert.strictEqual(sCm.challenges.total, 1);
        assert.strictEqual(sCm.candidates, 1);
        assert.strictEqual(sCm.paid.volume, 500);
        assert.strictEqual(sCm.openFraudFlags, 1);
        assert.deepStrictEqual(sCm.perEvent.map((e: any) => String(e._id)), [String(E1)]);
        const sMay = await st('?from=2026-05-01');
        assert.strictEqual(sMay.challenges.total, 1);
        assert.strictEqual(sMay.openFraudFlags, 2, 'open queue ignores dates');
        assert.strictEqual((await st('?to=2026-03-15')).challenges.total, 1, 'bare `to` inclusive');
        for (const p of ['challenges', 'fraud', 'transactions', 'change-requests', 'refunds']) {
            assert.strictEqual(await total(`/animation/${p}`), 2, p);
            assert.strictEqual(await total(`/animation/${p}?country=BJ`), 1, `${p} BJ`);
            assert.strictEqual(await total(`/animation/${p}?country=CM&from=2026-04-01`), 0, `${p} CM April+`);
            assert.strictEqual(await total(`/animation/${p}?country=FR`), 0, `${p} FR`);
        }
        assert.strictEqual(await total('/animation/audit'), 3);
        assert.strictEqual(await total('/animation/audit?country=CM'), 1, 'platform entry left out');
        assert.strictEqual(await total('/animation/audit?to=2026-03-31'), 2);
        assert.strictEqual(await total(`/animation/audit?country=CM&eventId=${E4}`), 0);
    } finally {
        server.close();
        await mongoose.connection.db!.dropDatabase();
        await mongoose.disconnect();
    }
    console.log('OK admin filters: events/orders/tickets/listings/disputes/organizers/dashboard + animation stats/challenges/fraud/transactions/change-requests/refunds/audit');
    process.exit(0);
})().catch(async (err) => {
    console.error(err);
    try { await mongoose.connection.db?.dropDatabase(); } catch { /* ignore */ }
    process.exit(1);
});
