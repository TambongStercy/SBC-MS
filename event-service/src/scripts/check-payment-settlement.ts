/**
 * Settlement must be exactly-once however payment-service, its payin
 * reconciler and our own reconciler deliver the outcome — and must pay the
 * organizer's user, not the Organizer document.
 *
 * Run: npx ts-node --transpile-only src/scripts/check-payment-settlement.ts
 * Seeds its own throwaway database (CHECK_MONGO_URI) and drops it at the end.
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import TicketType, { TicketTypeStatus } from '../database/models/ticket-type.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import Order, { OrderKind, OrderStatus } from '../database/models/order.model';
import Organizer, { OrganizerStatus } from '../database/models/organizer.model';
import Commission from '../database/models/commission.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import ResaleOrder, { ResaleOrderStatus } from '../database/models/resale-order.model';
import * as userClient from '../services/clients/user.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import * as paymentClient from '../services/clients/payment.service.client';
import { settleFromWebhook, sweepPendingPayouts } from '../services/order.service';
import { settleResaleFromWebhook } from '../services/resale.service';
import { reconcilePendingPayments } from '../services/payment-reconciler.service';
import { paymentConfirmation } from '../api/controllers/webhook.controller';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_event_settlement_check';
const MIN = 60_000;

const organizerUserId = new Types.ObjectId();
const buyerId = new Types.ObjectId();
const sellerId = new Types.ObjectId();
const holder = { firstName: 'Awa', lastName: 'Ndiaye', phone: '+237600000000', email: 'awa@example.test' };

// Stubs: no other service runs during a check. Patching the module object
// works because CommonJS resolves the export at call time.
const credits: { userId: string; amount: number; reference: string }[] = [];
(userClient as any).creditEventOrganizerBalance = async (a: { userId: string; amount: number; reference: string }) => {
    credits.push(a);
    return { newEventOrganizerBalance: 0 };
};
(userClient as any).getEventUserDetails = async () => [];
(notificationClient as any).notifyUser = async () => undefined;
const intents = new Map<string, string>(); // sessionId → status payment-service would report
(paymentClient as any).getPaymentIntentState = async (sessionId: string) =>
    intents.has(sessionId) ? { sessionId, status: intents.get(sessionId), amount: 0, currency: 'XAF', paymentType: 'X', metadata: {} } : null;

const callWebhook = async (body: Record<string, unknown>) => {
    let payload: any;
    let code = 200;
    const res: any = {
        status(c: number) { code = c; return res; },
        json(p: any) { payload = p; return res; },
    };
    await paymentConfirmation({ body } as any, res, () => undefined);
    return { code, payload };
};

(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([Commission.syncIndexes(), Order.syncIndexes(), Ticket.syncIndexes()]);

    const organizer = await Organizer.create({ userId: organizerUserId, displayName: 'Prod Douala', status: OrganizerStatus.APPROVED });
    const event = await Event.create({
        organizerId: organizer._id, slug: 'concert', title: 'Concert', description: 'Un concert.',
        category: 'concert', city: 'Douala', venue: 'Palais', address: 'Rue 1',
        startsAt: new Date(Date.now() + 48 * 3_600_000), endsAt: new Date(Date.now() + 52 * 3_600_000),
        status: EventStatus.PUBLISHED,
    });
    const vip = await TicketType.create({ eventId: event._id, name: 'VIP', price: 10000, quantityTotal: 100, maxPerOrder: 5, status: TicketTypeStatus.ACTIVE });
    const std = await TicketType.create({ eventId: event._id, name: 'Standard', price: 5000, quantityTotal: 100, maxPerOrder: 5, status: TicketTypeStatus.ACTIVE });

    const mkOrder = (sessionId: string, extra: Record<string, unknown> = {}) => Order.create({
        userId: buyerId, eventId: event._id, kind: OrderKind.PRIMARY,
        items: [{ ticketTypeId: vip._id, quantity: 2, unitPrice: 10000 }, { ticketTypeId: std._id, quantity: 1, unitPrice: 5000 }],
        subtotal: 25000, commission: 1250, total: 25000, paymentSessionId: sessionId, holder, ...extra,
    });

    // ---- (a) ten simultaneous SUCCEEDED deliveries settle once ----
    const order = await mkOrder('sess-a');
    const results = await Promise.all(Array.from({ length: 10 }, () => settleFromWebhook({ sessionId: 'sess-a', status: 'SUCCEEDED' })));
    assert.strictEqual(results.filter((r: any) => r.outcome === 'paid').length, 1, 'exactly one delivery settles');
    assert.strictEqual(await Ticket.countDocuments({ orderId: order._id }), 3, 'three tickets, not thirty');
    assert.strictEqual(await Commission.countDocuments({ orderId: order._id }), 1, 'one commission row');
    assert.strictEqual((await TicketType.findById(vip._id))!.quantitySold, 2, 'VIP seats taken once');
    assert.strictEqual((await TicketType.findById(std._id))!.quantitySold, 1, 'Standard seats taken once');
    assert.strictEqual((await Order.findById(order._id))!.status, OrderStatus.PAID);
    assert.strictEqual(credits.length, 1, 'organizer credited once');
    assert.strictEqual(credits[0].userId, String(organizerUserId), "credit goes to the organizer's USER, not the Organizer doc");
    assert.strictEqual(credits[0].amount, 23750, 'net of commission');
    assert.strictEqual(credits[0].reference, `event-order:${order._id}`);
    console.log('ok  (a) 10 parallel deliveries → 1 settlement, 3 tickets, 1 commission, 1 credit to the organizer user');

    // ---- (b) a late FAILED never downgrades a paid order ----
    await settleFromWebhook({ sessionId: 'sess-a', status: 'FAILED' });
    assert.strictEqual((await Order.findById(order._id))!.status, OrderStatus.PAID);
    console.log('ok  (b) FAILED after PAID is ignored');

    // ---- (c) a crashed settlement is resumed without double seats or tickets ----
    const crashed = await mkOrder('sess-c', { settlingAt: new Date(Date.now() - 11 * MIN), seatsAllocatedAt: new Date() });
    await TicketType.updateOne({ _id: vip._id }, { $inc: { quantitySold: 2 } });
    await TicketType.updateOne({ _id: std._id }, { $inc: { quantitySold: 1 } });
    await Ticket.create({ // one of the two VIP tickets was minted before the crash
        orderId: crashed._id, eventId: event._id, ticketTypeId: vip._id, ownerUserId: buyerId,
        serial: 'SBC-CRASH-1', qrToken: 'qr-crash-1', status: TicketStatus.ISSUED,
        holderName: 'Awa Ndiaye', holderPhone: holder.phone, issuedAt: new Date(),
    });
    const resumed: any = await settleFromWebhook({ sessionId: 'sess-c', status: 'SUCCEEDED' });
    assert.strictEqual(resumed.outcome, 'paid');
    assert.strictEqual(await Ticket.countDocuments({ orderId: crashed._id }), 3, 'only the two missing tickets are minted');
    assert.strictEqual((await TicketType.findById(vip._id))!.quantitySold, 4, 'seats are not taken again on resume');
    console.log('ok  (c) resumed settlement tops up tickets and keeps seat counts');

    // ---- (d) a live claim blocks a second settler ----
    const busy = await mkOrder('sess-d', { settlingAt: new Date() });
    const blocked: any = await settleFromWebhook({ sessionId: 'sess-d', status: 'SUCCEEDED' });
    assert.ok(blocked.alreadyProcessed, 'a fresh claim is respected');
    assert.strictEqual(await Ticket.countDocuments({ orderId: busy._id }), 0);
    console.log('ok  (d) a settlement in progress is not run twice');

    // ---- (e) the webhook only believes payment-service ----
    const forged = await mkOrder('sess-e');
    intents.set('sess-e', 'PENDING_PROVIDER');
    const r1 = await callWebhook({ sessionId: 'sess-e', status: 'SUCCEEDED' });
    assert.strictEqual(r1.payload.data.note, 'unverified success');
    assert.strictEqual((await Order.findById(forged._id))!.status, OrderStatus.PENDING, 'forged success settles nothing');
    intents.set('sess-e', 'CONFIRMED'); // crypto success
    const r2 = await callWebhook({ sessionId: 'sess-e', status: 'CONFIRMED' });
    assert.strictEqual(r2.payload.data.outcome, 'paid', 'CONFIRMED (crypto) settles');
    console.log('ok  (e) unverified SUCCEEDED ignored; verified CONFIRMED settles');

    // ---- (f) the reconciler settles a paid order whose callback was lost ----
    const lost = await mkOrder('sess-f');
    await Order.collection.updateOne({ _id: lost._id }, { $set: { createdAt: new Date(Date.now() - 20 * MIN) } });
    intents.set('sess-f', 'SUCCEEDED');
    const recovered = await reconcilePendingPayments();
    assert.strictEqual(recovered, 1);
    assert.strictEqual((await Order.findById(lost._id))!.status, OrderStatus.PAID);
    const again = await reconcilePendingPayments();
    assert.strictEqual(again, 0, 'nothing left to recover');
    console.log('ok  (f) reconciler recovers a lost callback, once');

    // ---- (g) the sweeper pays the organizer user for old uncredited orders ----
    const before = credits.length;
    const old = await mkOrder('sess-g', { status: OrderStatus.PAID, paidAt: new Date() });
    await sweepPendingPayouts();
    const swept = credits.slice(before).find((c) => c.reference === `event-order:${old._id}`);
    assert.ok(swept, 'backlog order credited');
    assert.strictEqual(swept!.userId, String(organizerUserId));
    assert.ok((await Order.findById(old._id))!.creditedAt);
    console.log('ok  (g) sweeper credits the backlog to the organizer user');

    // ---- (h) ten simultaneous resale deliveries mint one ticket ----
    const sellerTicket = await Ticket.create({
        orderId: new Types.ObjectId(), eventId: event._id, ticketTypeId: std._id, ownerUserId: sellerId,
        serial: 'SBC-SELL-1', qrToken: 'qr-sell-1', status: TicketStatus.ISSUED,
        holderName: 'Seller', holderPhone: '+237600000001', issuedAt: new Date(),
    });
    const listing = await ResaleListing.create({
        ticketId: sellerTicket._id, sellerUserId: sellerId, eventId: event._id,
        originalPrice: 5000, askingPrice: 6000, status: ResaleListingStatus.ACTIVE,
    });
    const resaleTop = await Order.create({
        userId: buyerId, eventId: event._id, kind: OrderKind.RESALE, resaleListingId: listing._id,
        items: [{ ticketTypeId: std._id, quantity: 1, unitPrice: 6000 }],
        subtotal: 6000, commission: 600, total: 6000, paymentSessionId: 'sess-h-top', holder,
    });
    const resale = await ResaleOrder.create({
        listingId: listing._id, buyerUserId: buyerId, orderId: resaleTop._id, paymentSessionId: 'sess-h',
    });
    const resaleResults = await Promise.all(Array.from({ length: 10 }, () => settleResaleFromWebhook({ sessionId: 'sess-h', status: 'SUCCEEDED' })));
    assert.strictEqual(resaleResults.filter((r: any) => r.outcome === 'paid').length, 1, 'exactly one resale settlement');
    assert.strictEqual(await Ticket.countDocuments({ previousTicketId: sellerTicket._id }), 1, 'one new ticket for the buyer');
    assert.strictEqual(await Commission.countDocuments({ resaleOrderId: resale._id }), 1, 'one resale commission row');
    assert.strictEqual((await ResaleOrder.findById(resale._id))!.status, ResaleOrderStatus.PAID);
    assert.strictEqual(credits.filter((c) => c.reference === `resale-order:${resale._id}`).length, 1, 'seller credited once');
    console.log('ok  (h) 10 parallel resale deliveries → 1 new ticket, 1 commission, 1 seller credit');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('\nAll settlement checks passed.');
})().catch(async (err) => {
    console.error(err);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
});
