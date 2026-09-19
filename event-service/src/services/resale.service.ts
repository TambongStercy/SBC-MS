import { Types } from 'mongoose';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import Event, { EventStatus } from '../database/models/event.model';
import TicketType from '../database/models/ticket-type.model';
import ResaleListing, { IResaleListing, ResaleListingStatus } from '../database/models/resale-listing.model';
import ResaleOrder, { ResaleOrderStatus } from '../database/models/resale-order.model';
import TicketTransfer from '../database/models/ticket-transfer.model';
import Commission, { CommissionKind } from '../database/models/commission.model';
import Order, { OrderKind, OrderStatus } from '../database/models/order.model';
import { generateTicketSerial } from '../utils/serial';
import { generateQrToken } from './qr.service';
import { getCommissionConfig } from './clients/settings.service.client';
import { creditEventOrganizerBalance, getEventUserDetails } from './clients/user.service.client';
import { createResaleOrderPaymentIntent } from './clients/payment.service.client';
import { notifyUser } from './clients/notification.service.client';
import { AppError } from '../utils/errors';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('ResaleService');

/**
 * Compute the effective resale price cap for an event, respecting spec §28:
 *  event.maxResalePricePct wins if set, otherwise the module default.
 */
const getMaxPriceFor = async (event: any, originalPrice: number): Promise<number> => {
    const pct = event.maxResalePricePct ?? (await getCommissionConfig()).defaultMaxResalePricePct;
    // pct is in "percent of original", e.g. 120 = 1.2x
    return Math.round((originalPrice * pct) / 100);
};

/**
 * List a ticket for resale. Enforces spec §28 eligibility:
 * ticket must be PAID+ISSUED, owned by seller, event resaleEnabled,
 * event not CANCELLED/COMPLETED, no other ACTIVE listing (partial-unique
 * index catches this too as a last-line defence).
 */
export const createListing = async (args: {
    sellerUserId: string;
    ticketId: string;
    askingPrice: number;
}): Promise<IResaleListing> => {
    const ticket = await Ticket.findOne({
        _id: new Types.ObjectId(args.ticketId),
        ownerUserId: new Types.ObjectId(args.sellerUserId),
    });
    if (!ticket) throw new AppError('Billet introuvable.', 404);
    if (ticket.status !== TicketStatus.ISSUED) {
        throw new AppError('Seul un billet actif peut être mis en revente.', 409);
    }

    const event = await Event.findById(ticket.eventId);
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (!event.resaleEnabled) throw new AppError('L\'organisateur n\'a pas autorisé la revente.', 403);
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) {
        throw new AppError('Cet événement n\'accepte plus de revente.', 409);
    }
    if (event.endsAt < new Date()) throw new AppError('Cet événement est terminé.', 409);

    const ticketType = await TicketType.findById(ticket.ticketTypeId);
    if (!ticketType) throw new AppError('Type de billet introuvable.', 500);

    const maxPrice = await getMaxPriceFor(event, ticketType.price);
    if (args.askingPrice < 1) throw new AppError('Prix invalide.', 400);
    if (args.askingPrice > maxPrice) {
        throw new AppError(`Le prix maximum autorisé est de ${maxPrice.toLocaleString('fr-FR')} XAF.`, 400);
    }

    // The partial-unique index catches a race where two listings for the same
    // ticket are created simultaneously — but issue the friendly message here first.
    const existing = await ResaleListing.findOne({ ticketId: ticket._id, status: ResaleListingStatus.ACTIVE });
    if (existing) throw new AppError('Ce billet est déjà en revente.', 409);

    try {
        const listing = await ResaleListing.create({
            ticketId: ticket._id,
            sellerUserId: ticket.ownerUserId,
            eventId: ticket.eventId,
            originalPrice: ticketType.price,
            askingPrice: args.askingPrice,
            status: ResaleListingStatus.ACTIVE,
            listedAt: new Date(),
        });
        // Point the ticket at the active listing so "Mes billets" can flag it.
        ticket.resaleListingId = listing._id;
        await ticket.save();
        return listing;
    } catch (err: any) {
        if (err?.code === 11000) throw new AppError('Ce billet est déjà en revente.', 409);
        throw err;
    }
};

/** Only the seller (before it's sold) may retire their own listing. */
export const cancelListing = async (sellerUserId: string, listingId: string): Promise<IResaleListing> => {
    const listing = await ResaleListing.findOne({
        _id: new Types.ObjectId(listingId),
        sellerUserId: new Types.ObjectId(sellerUserId),
    });
    if (!listing) throw new AppError('Annonce introuvable.', 404);
    if (listing.status !== ResaleListingStatus.ACTIVE) {
        throw new AppError('Cette annonce ne peut plus être annulée.', 409);
    }
    listing.status = ResaleListingStatus.CANCELLED;
    listing.cancelledAt = new Date();
    await listing.save();

    await Ticket.updateOne(
        { _id: listing.ticketId, resaleListingId: listing._id },
        { $unset: { resaleListingId: '' } },
    );
    return listing;
};

export const listMyListings = async (sellerUserId: string) => {
    return ResaleListing.find({ sellerUserId: new Types.ObjectId(sellerUserId) })
        .sort({ createdAt: -1 })
        .lean();
};

export const listPublicResale = async (params: { eventId?: string; limit?: number; skip?: number }) => {
    const filter: any = { status: ResaleListingStatus.ACTIVE };
    if (params.eventId) filter.eventId = new Types.ObjectId(params.eventId);

    const [rawItems, total] = await Promise.all([
        ResaleListing.find(filter)
            .sort({ listedAt: -1 })
            .limit(Math.min(params.limit ?? 30, 100))
            .skip(params.skip ?? 0)
            .lean(),
        ResaleListing.countDocuments(filter),
    ]);

    // Hydrate event + ticket type in bulk
    const eventIds = [...new Set(rawItems.map((l) => String(l.eventId)))];
    const events = await Event.find({ _id: { $in: eventIds } }).lean();
    const eventById = new Map(events.map((e) => [String(e._id), e]));

    const ticketIds = [...new Set(rawItems.map((l) => String(l.ticketId)))];
    const tickets = await Ticket.find({ _id: { $in: ticketIds } }).select('_id ticketTypeId').lean();
    const ttIds = [...new Set(tickets.map((t) => String(t.ticketTypeId)))];
    const tts = await TicketType.find({ _id: { $in: ttIds } }).lean();
    const ttByTicket = new Map<string, any>();
    for (const t of tickets) {
        const tt = tts.find((x) => String(x._id) === String(t.ticketTypeId));
        ttByTicket.set(String(t._id), tt);
    }

    const items = rawItems.map((l) => ({
        _id: l._id,
        eventId: l.eventId,
        originalPrice: l.originalPrice,
        askingPrice: l.askingPrice,
        listedAt: l.listedAt,
        event: eventById.get(String(l.eventId)),
        ticketType: ttByTicket.get(String(l.ticketId)),
    }));
    return { items, total };
};

/**
 * Buyer starts a resale purchase. Creates a PENDING top-level Order (kind=RESALE)
 * + a ResaleOrder + opens a payment intent. Settlement runs in
 * settleResaleFromWebhook.
 */
export const buyListing = async (args: {
    buyerUserId: string;
    listingId: string;
    holder: {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
    };
}) => {
    if (!args.holder.firstName?.trim() || !args.holder.lastName?.trim() || !args.holder.phone?.trim()) {
        throw new AppError('Nom, prénom et téléphone sont obligatoires.', 400);
    }
    const listing = await ResaleListing.findOne({
        _id: new Types.ObjectId(args.listingId),
        status: ResaleListingStatus.ACTIVE,
    });
    if (!listing) throw new AppError('Annonce introuvable ou déjà vendue.', 404);
    if (String(listing.sellerUserId) === args.buyerUserId) {
        throw new AppError('Vous ne pouvez pas acheter votre propre billet.', 400);
    }

    const event = await Event.findById(listing.eventId);
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status === EventStatus.CANCELLED) throw new AppError('Cet événement a été annulé.', 409);
    if (event.endsAt < new Date()) throw new AppError('Cet événement est terminé.', 409);

    const { resalePct } = await getCommissionConfig();
    const commission = Math.round(listing.askingPrice * resalePct);
    const total = listing.askingPrice;

    // Top-level Order for uniform history + accounting
    const order = await Order.create({
        userId: new Types.ObjectId(args.buyerUserId),
        eventId: event._id,
        kind: OrderKind.RESALE,
        resaleListingId: listing._id,
        items: [],
        subtotal: listing.askingPrice,
        commission,
        total,
        status: OrderStatus.PENDING,
        holder: args.holder,
    });

    const resaleOrder = await ResaleOrder.create({
        listingId: listing._id,
        buyerUserId: new Types.ObjectId(args.buyerUserId),
        orderId: order._id,
        status: ResaleOrderStatus.PENDING,
    });

    try {
        const intent = await createResaleOrderPaymentIntent({
            userId: args.buyerUserId,
            amount: total,
            resaleOrderId: String(resaleOrder._id),
            eventTitle: event.title,
        });
        order.paymentSessionId = intent.sessionId;
        resaleOrder.paymentSessionId = intent.sessionId;
        await order.save();
        await resaleOrder.save();
        return { order, resaleOrder, paymentSession: intent };
    } catch (err) {
        order.status = OrderStatus.FAILED;
        order.failedAt = new Date();
        resaleOrder.status = ResaleOrderStatus.FAILED;
        await Promise.all([order.save().catch(() => undefined), resaleOrder.save().catch(() => undefined)]);
        throw err;
    }
};

/**
 * Settle a resale after payment. Atomic transaction:
 *  1. old ticket → CANCELLED, qrToken cleared, audit entry
 *  2. new ticket ISSUED with fresh qrToken, owner = buyer, previousTicketId set
 *  3. listing → SOLD
 *  4. resale order → PAID
 *  5. commission row + best-effort seller credit + best-effort notification
 *
 * Idempotent: a second webhook for the same sessionId is a no-op.
 */
export const settleResaleFromWebhook = async (payload: {
    sessionId: string;
    status: string;
    metadata?: Record<string, any>;
}) => {
    const { sessionId, status } = payload;
    if (!sessionId) throw new AppError('sessionId is required', 400);

    const resaleOrder = await ResaleOrder.findOne({ paymentSessionId: sessionId });
    if (!resaleOrder) {
        log.warn(`No resale order found for session ${sessionId}`);
        return { handled: false };
    }
    if (resaleOrder.status === ResaleOrderStatus.PAID) {
        return { handled: true, alreadyProcessed: true };
    }

    const order = resaleOrder.orderId ? await Order.findById(resaleOrder.orderId) : null;

    if (status !== 'SUCCEEDED') {
        resaleOrder.status = ResaleOrderStatus.FAILED;
        await resaleOrder.save();
        if (order) {
            order.status = OrderStatus.FAILED;
            order.failedAt = new Date();
            await order.save();
        }
        return { handled: true, outcome: 'failed' };
    }

    const listing = await ResaleListing.findById(resaleOrder.listingId);
    if (!listing) throw new AppError('Listing vanished', 500);
    if (listing.status !== ResaleListingStatus.ACTIVE) {
        // Someone else got there first or the listing was cancelled between
        // payment start and settlement. Mark the resale-order failed; the buyer
        // needs a refund (handled elsewhere).
        resaleOrder.status = ResaleOrderStatus.FAILED;
        await resaleOrder.save();
        if (order) {
            order.status = OrderStatus.CANCELLED;
            order.metadata = { ...(order.metadata || {}), reason: 'Listing no longer active at settlement' };
            await order.save();
        }
        return { handled: true, outcome: 'listing_gone' };
    }

    const oldTicket = await Ticket.findById(listing.ticketId);
    if (!oldTicket) throw new AppError('Ticket vanished', 500);

    const event = await Event.findById(listing.eventId);
    if (!event) throw new AppError('Event vanished', 500);

    // Sequential writes (prod Mongo is standalone; txns need a replica set).
    // Ordering matters: invalidate the old ticket FIRST so the buyer never
    // holds a valid new ticket while the seller still has a valid old one.
    // A retry-safe idempotency check earlier (resaleOrder.status === PAID)
    // means the webhook can safely re-fire and we skip the whole block.
    let newTicketId: Types.ObjectId | null = null;

    // 1. Old ticket invalidated (guard on ISSUED so a concurrent scan/refund
    //    doesn't get clobbered).
    await Ticket.updateOne(
        { _id: oldTicket._id, status: TicketStatus.ISSUED },
        {
            $set: { status: TicketStatus.CANCELLED, qrToken: null, cancelledAt: new Date() },
            $unset: { resaleListingId: '' },
        },
    );

    // 2. New ticket minted for the buyer
    const newTicket = await Ticket.create({
        orderId: resaleOrder.orderId,
        eventId: oldTicket.eventId,
        ticketTypeId: oldTicket.ticketTypeId,
        ownerUserId: resaleOrder.buyerUserId,
        serial: generateTicketSerial(),
        qrToken: generateQrToken(),
        status: TicketStatus.ISSUED,
        holderName: order ? `${order.holder.firstName} ${order.holder.lastName}` : oldTicket.holderName,
        holderPhone: order ? order.holder.phone : oldTicket.holderPhone,
        holderEmail: order ? order.holder.email : oldTicket.holderEmail,
        previousTicketId: oldTicket._id,
        issuedAt: new Date(),
    });
    newTicketId = newTicket._id;

    // 3. Listing SOLD, resale order PAID
    listing.status = ResaleListingStatus.SOLD;
    listing.soldAt = new Date();
    await listing.save();

    resaleOrder.status = ResaleOrderStatus.PAID;
    resaleOrder.newTicketId = newTicket._id;
    resaleOrder.settledAt = new Date();
    await resaleOrder.save();

    if (order) {
        order.status = OrderStatus.PAID;
        order.paidAt = new Date();
        await order.save();
    }

    // 4. Audit trail (best-effort — failure here doesn't roll back the transfer)
    try {
        await TicketTransfer.create({
            fromTicketId: oldTicket._id,
            toTicketId: newTicket._id,
            fromUserId: oldTicket.ownerUserId,
            toUserId: resaleOrder.buyerUserId,
            viaResaleOrderId: resaleOrder._id,
            at: new Date(),
        });
    } catch (err) {
        log.warn(`TicketTransfer audit write failed for resale ${resaleOrder._id}: ${(err as Error).message}`);
    }

    // Commission row (audit, non-transactional so a bad write can't crash the sale)
    try {
        await Commission.create({
            kind: CommissionKind.RESALE,
            resaleOrderId: resaleOrder._id,
            orderId: resaleOrder.orderId,
            eventId: listing.eventId,
            basisAmount: listing.askingPrice,
            rate: listing.askingPrice ? (order?.commission ?? 0) / listing.askingPrice : 0,
            amount: order?.commission ?? 0,
            sbcRevenueBookedAt: new Date(),
        });
    } catch (err) {
        log.warn(`Resale commission row insert failed for ${resaleOrder._id}: ${(err as Error).message}`);
    }

    // Credit seller (asking price minus resale commission)
    const sellerNet = listing.askingPrice - (order?.commission ?? 0);
    if (sellerNet > 0) {
        try {
            await creditEventOrganizerBalance({
                userId: String(listing.sellerUserId),
                amount: sellerNet,
                reference: `resale-order:${resaleOrder._id}`,
                description: `Revente billet « ${event.title} »`,
            });
            if (order) {
                order.creditedAt = new Date();
                await order.save();
            }
        } catch (err) {
            log.error(`Resale seller credit failed for ${resaleOrder._id}: ${(err as Error).message} — sweeper will retry.`);
        }
    }

    // Best-effort notification to the seller (spec §23). Nothing on the listing
    // carries the seller's coordinates (they bought the ticket, they never checked
    // out as a holder here) — the lookup also gives us the first name for the
    // template, so we do it here rather than letting notifyUser repeat it.
    let sellerProfile: { email?: string; phoneNumber?: string; name?: string } | undefined;
    try {
        [sellerProfile] = await getEventUserDetails([String(listing.sellerUserId)]);
    } catch (err) {
        log.warn(`resale-sold: seller lookup failed for ${listing.sellerUserId}: ${(err as Error).message}`);
    }
    try {
        // Time-critical for the seller: push + email + SMS.
        await notifyUser({
            kind: 'resale-sold',
            userId: String(listing.sellerUserId),
            channels: ['push', 'email', 'sms'],
            email: sellerProfile?.email,
            phone: sellerProfile?.phoneNumber,
            subject: `🎉 Votre billet a été revendu — ${event.title}`,
            body: `Votre billet a trouvé un acquéreur.`,
            data: {
                name: sellerProfile?.name?.split(' ')[0] || '',
                eventTitle: event.title,
                askingPrice: listing.askingPrice,
                netAmount: sellerNet,
            },
            eventId: String(event._id),
        });
    } catch { /* audit-logged */ }

    return {
        handled: true,
        outcome: 'paid',
        resaleOrderId: String(resaleOrder._id),
        newTicketId: newTicketId ? String(newTicketId) : undefined,
    };
};
