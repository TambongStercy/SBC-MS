/**
 * Sale-window enforcement (spec §6/§7) and resale-listing expiry (spec §30).
 *
 * Run: npx ts-node --transpile-only src/scripts/check-event-rules.ts
 * Seeds its own throwaway database and drops it at the end.
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import TicketType, { TicketTypeStatus } from '../database/models/ticket-type.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import { OrderStatus } from '../database/models/order.model';
import * as paymentClient from '../services/clients/payment.service.client';
import { createPrimaryOrder } from '../services/order.service';
import { getPublicEventBySlug } from '../services/event.service';
import { expireEndedResaleListings } from '../services/scheduler.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_event_rules_check';
const HOUR = 3_600_000;

const buyerId = new Types.ObjectId();
const organizerId = new Types.ObjectId();
const holder = { firstName: 'Awa', lastName: 'Ndiaye', phone: '+237600000000', email: 'awa@example.test' };

const mkEvent = async (slug: string, startsAt: Date, endsAt: Date, status = EventStatus.PUBLISHED) =>
    Event.create({
        organizerId, slug, title: `Concert ${slug}`, description: 'Un concert.',
        category: 'concert', city: 'Douala', venue: 'Palais', address: 'Rue 1',
        startsAt, endsAt, status,
    });

const mkTicket = async (eventId: Types.ObjectId, ticketTypeId: Types.ObjectId, serial: string) =>
    Ticket.create({
        orderId: new Types.ObjectId(), eventId, ticketTypeId, ownerUserId: buyerId,
        serial, qrToken: `qr-${serial}`, status: TicketStatus.ISSUED,
        holderName: 'Awa Ndiaye', holderPhone: '+237600000000', issuedAt: new Date(),
    });

/** Buy one ticket of `ticketTypeId` and return the thrown error, or null on success. */
const tryBuy = async (eventId: Types.ObjectId, ticketTypeId: Types.ObjectId) => {
    try {
        return { err: null, ...(await createPrimaryOrder({
            userId: String(buyerId), eventId: String(eventId),
            items: [{ ticketTypeId: String(ticketTypeId), quantity: 1 }], holder,
        })) };
    } catch (err: any) {
        return { err, order: null };
    }
};

(async () => {
    // payment-service isn't running for a check script, and the window guard sits
    // upstream of the intent call — stub it so the happy path can still complete.
    // Patching the module object works because TS/CommonJS resolves the export at
    // call time, not at import time.
    (paymentClient as any).createPrimaryOrderPaymentIntent = async () => ({ sessionId: `sess-${Date.now()}` });

    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();

    const now = new Date();

    // ---- (a) sale window (spec §6/§7) ----
    const event = await mkEvent('window', new Date(+now + 48 * HOUR), new Date(+now + 52 * HOUR));
    const mkType = async (name: string, salesStart?: Date, salesEnd?: Date) =>
        TicketType.create({
            eventId: event._id, name, price: 5000, quantityTotal: 100, quantitySold: 0,
            maxPerOrder: 5, salesStart, salesEnd, status: TicketTypeStatus.ACTIVE,
        });

    const notYet = await mkType('Early bird', new Date(+now + 24 * HOUR));
    const over = await mkType('Prévente', undefined, new Date(+now - HOUR));
    const open = await mkType('Standard', new Date(+now - HOUR), new Date(+now + HOUR));
    const unbounded = await mkType('VIP');

    const before = await tryBuy(event._id, notYet._id);
    assert.ok(before.err, 'a purchase before salesStart must be refused');
    assert.strictEqual(before.err.code, 'SALES_NOT_OPEN', 'refusal carries the SALES_NOT_OPEN code');
    assert.strictEqual(before.err.statusCode, 409);
    assert.match(before.err.message, /ouvre le/, 'the message is French and says when sales open');

    const after = await tryBuy(event._id, over._id);
    assert.ok(after.err, 'a purchase after salesEnd must be refused');
    assert.strictEqual(after.err.code, 'SALES_CLOSED', 'refusal carries the SALES_CLOSED code');
    assert.match(after.err.message, /terminée/, 'the message is French');

    const inside = await tryBuy(event._id, open._id);
    assert.strictEqual(inside.err, null, `a purchase inside the window must succeed (${inside.err?.message})`);
    assert.strictEqual(inside.order!.status, OrderStatus.PENDING, 'the order is opened PENDING');

    const always = await tryBuy(event._id, unbounded._id);
    assert.strictEqual(always.err, null, 'a type with no window at all is always on sale');

    // The public page keeps out-of-window types visible, flagged for greying out.
    const publicView = await getPublicEventBySlug('window');
    const byName = new Map(publicView.ticketTypes.map((t: any) => [t.name, t]));
    assert.strictEqual(byName.get('Early bird').onSale, false);
    assert.strictEqual(byName.get('Early bird').saleWindow, 'SALES_NOT_OPEN');
    assert.strictEqual(byName.get('Prévente').onSale, false);
    assert.strictEqual(byName.get('Prévente').saleWindow, 'SALES_CLOSED');
    assert.strictEqual(byName.get('Standard').onSale, true, 'in-window type is on sale');
    assert.strictEqual(byName.get('VIP').onSale, true);
    assert.strictEqual(publicView.ticketTypes.length, 4, 'nothing is hidden, only flagged');

    // ---- (b) resale listing expiry (spec §30) ----
    const ended = await mkEvent('ended', new Date(+now - 5 * HOUR), new Date(+now - 2 * HOUR));
    const live = await mkEvent('live', new Date(+now + 5 * HOUR), new Date(+now + 8 * HOUR));

    const mkListing = async (ev: any, serial: string) => {
        const tt = await TicketType.create({
            eventId: ev._id, name: 'Standard', price: 5000, quantityTotal: 10, quantitySold: 1,
            status: TicketTypeStatus.ACTIVE,
        });
        const ticket = await mkTicket(ev._id, tt._id, serial);
        const listing = await ResaleListing.create({
            ticketId: ticket._id, sellerUserId: buyerId, eventId: ev._id,
            originalPrice: 5000, askingPrice: 5500,
            status: ResaleListingStatus.ACTIVE, listedAt: now,
        });
        ticket.resaleListingId = listing._id;
        await ticket.save();
        return { ticket, listing };
    };

    const dead = await mkListing(ended, 'SER-DEAD');
    const alive = await mkListing(live, 'SER-ALIVE');

    assert.strictEqual(await expireEndedResaleListings(), 1, 'exactly the ended event\'s listing is swept');

    const deadListing = await ResaleListing.findById(dead.listing._id);
    assert.strictEqual(deadListing!.status, ResaleListingStatus.EXPIRED, 'listing on an ended event becomes EXPIRED');
    assert.ok(deadListing!.expiredAt, 'expiredAt is stamped');
    const deadTicket = await Ticket.findById(dead.ticket._id);
    assert.strictEqual(deadTicket!.resaleListingId, undefined, 'the ticket pointer is cleared');

    const aliveListing = await ResaleListing.findById(alive.listing._id);
    assert.strictEqual(aliveListing!.status, ResaleListingStatus.ACTIVE, 'a listing on a live event is untouched');
    const aliveTicket = await Ticket.findById(alive.ticket._id);
    assert.ok(aliveTicket!.resaleListingId, 'a live listing keeps its ticket pointer');

    assert.strictEqual(await expireEndedResaleListings(), 0, 'the sweep is idempotent');

    // A CANCELLED event counts as over even while its endsAt is still ahead.
    await Event.updateOne({ _id: live._id }, { $set: { status: EventStatus.CANCELLED } });
    assert.strictEqual(await expireEndedResaleListings(), 1, 'a CANCELLED event expires its listings too');

  // --- a resale session must never be claimed by primary settlement ---
  // Regression: a resale purchase writes BOTH Order(kind=RESALE) and ResaleOrder
  // against one session. Primary settlement used to match that Order, answer
  // "handled", and the resale transfer never ran — buyer paid, got nothing.
  {
    const { default: Order, OrderKind, OrderStatus } = await import('../database/models/order.model');
    const orderService = await import('../services/order.service');
    const sessionId = `sess-resale-${Date.now()}`;
    await Order.create({
      userId: new Types.ObjectId(),
      eventId: new Types.ObjectId(),
      kind: OrderKind.RESALE,
      status: OrderStatus.PENDING,
      items: [],
      subtotal: 6000,
      commission: 0,
      total: 6000,
      holder: { firstName: 'E2E', lastName: 'Buyer', phone: '237600000000' },
      paymentSessionId: sessionId,
    } as any);
    const res = await orderService.settleFromWebhook({ sessionId, status: 'SUCCEEDED' });
    assert.strictEqual(res.handled, false, 'primary settlement must ignore a RESALE order');
    const after = await Order.findOne({ paymentSessionId: sessionId }).lean();
    assert.strictEqual(after?.status, OrderStatus.PENDING, 'primary settlement must not touch a RESALE order');
  }

  // --- two invalidated tickets may coexist (qrToken null) ---
  // Regression: the unique index was sparse, which still indexes explicit
  // nulls, so the SECOND refunded/resold ticket threw E11000 mid-settlement.
  {
    const { default: Ticket, TicketStatus } = await import('../database/models/ticket.model');
    const base = {
      eventId: new Types.ObjectId(), ticketTypeId: new Types.ObjectId(), orderId: new Types.ObjectId(),
      ownerUserId: new Types.ObjectId(), holderName: 'E2E', holderPhone: '237600000000',
      status: TicketStatus.REFUNDED, qrToken: null,
    };
    await Ticket.create({ ...base, serial: `SBC-NULL01` } as any);
    await Ticket.create({ ...base, serial: `SBC-NULL02` } as any);
    const nulls = await Ticket.countDocuments({ qrToken: null, serial: { $in: ['SBC-NULL01', 'SBC-NULL02'] } });
    assert.strictEqual(nulls, 2, 'two tickets with a null qrToken must be storable');
  }

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('check-event-rules: OK');
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
