/**
 * Read-only: what the organizer-credit fix will pay out.
 *
 * Until the fix, primary ticket sales credited `event.organizerId` (the
 * Organizer document) instead of the organizer's user, so user-service 404'd
 * and every PAID order stayed without creditedAt. Once deployed, the scheduler
 * sweeper credits them all (decision: pay the backlog automatically). This
 * prints the total per organizer so the amount is known before it moves.
 *
 *   npx ts-node --transpile-only src/scripts/report-unpaid-organizer-credits.ts
 */
import mongoose from 'mongoose';
import config from '../config';
import Order, { OrderKind, OrderStatus } from '../database/models/order.model';
import Event from '../database/models/event.model';
import Organizer from '../database/models/organizer.model';

(async () => {
    await mongoose.connect(config.mongodb.uri);

    const rows = await Order.aggregate([
        { $match: { kind: OrderKind.PRIMARY, status: OrderStatus.PAID, creditedAt: { $exists: false } } },
        { $project: { eventId: 1, net: { $subtract: ['$subtotal', '$commission'] }, paidAt: 1 } },
        { $group: { _id: '$eventId', orders: { $sum: 1 }, net: { $sum: '$net' }, firstPaid: { $min: '$paidAt' }, lastPaid: { $max: '$paidAt' } } },
    ]);

    const events = await Event.find({ _id: { $in: rows.map((r) => r._id) } }).select('title organizerId').lean();
    const eventById = new Map(events.map((e) => [String(e._id), e]));
    const organizers = await Organizer.find({ _id: { $in: events.map((e) => e.organizerId) } }).select('userId displayName').lean();
    const orgById = new Map(organizers.map((o) => [String(o._id), o]));

    const perOrganizer = new Map<string, { name: string; userId: string; orders: number; net: number; events: string[] }>();
    for (const r of rows) {
        const ev = eventById.get(String(r._id));
        const org = ev ? orgById.get(String(ev.organizerId)) : undefined;
        const key = org ? String(org._id) : `missing:${ev?.organizerId ?? r._id}`;
        const acc = perOrganizer.get(key) ?? { name: org?.displayName ?? '(organisateur introuvable)', userId: org ? String(org.userId) : '-', orders: 0, net: 0, events: [] };
        acc.orders += r.orders;
        acc.net += r.net;
        acc.events.push(`${ev?.title ?? r._id} (${r.orders} cmd, ${r.net} XAF)`);
        perOrganizer.set(key, acc);
    }

    let total = 0;
    let orders = 0;
    for (const [orgId, a] of perOrganizer) {
        total += a.net;
        orders += a.orders;
        console.log(`${a.name} — organizer ${orgId}, user ${a.userId}: ${a.orders} orders, ${a.net} XAF`);
        for (const e of a.events) console.log(`    ${e}`);
    }
    console.log(`\nTOTAL to be credited by the sweeper: ${total} XAF over ${orders} orders, ${perOrganizer.size} organizers.`);
    const zeroNet = await Order.countDocuments({ kind: OrderKind.PRIMARY, status: OrderStatus.PAID, creditedAt: { $exists: false }, $expr: { $lte: [{ $subtract: ['$subtotal', '$commission'] }, 0] } });
    if (zeroNet) console.log(`(${zeroNet} of them have a zero net and will just be stamped credited.)`);
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
