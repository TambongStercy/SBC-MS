import { Types } from 'mongoose';
import Ticket, { ITicket, TicketStatus } from '../database/models/ticket.model';
import Event from '../database/models/event.model';
import TicketType from '../database/models/ticket-type.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import { renderQrDataUrl } from './qr.service';
import { AppError } from '../utils/errors';

export interface TicketWithContext {
    ticket: any;
    event: any;
    ticketType: any;
    qrImageDataUrl?: string;
    activeResaleListing?: any;
}

export const listMyTickets = async (userId: string, params: { limit?: number; skip?: number; past?: boolean }) => {
    const now = new Date();
    const eventFilter: any = params.past ? { endsAt: { $lt: now } } : { endsAt: { $gte: now } };
    // Fetch tickets, then hydrate event + ticketType
    const tickets = await Ticket.find({
        ownerUserId: new Types.ObjectId(userId),
        status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] },
    })
        .sort({ createdAt: -1 })
        .limit(params.limit ?? 50)
        .skip(params.skip ?? 0)
        .lean();

    if (tickets.length === 0) return { items: [], total: 0 };

    const eventIds = [...new Set(tickets.map((t) => String(t.eventId)))];
    const events = await Event.find({ _id: { $in: eventIds }, ...eventFilter }).lean();
    const eventById = new Map(events.map((e) => [String(e._id), e]));

    const ttIds = [...new Set(tickets.map((t) => String(t.ticketTypeId)))];
    const tts = await TicketType.find({ _id: { $in: ttIds } }).lean();
    const ttById = new Map(tts.map((t) => [String(t._id), t]));

    const items = tickets
        .filter((t) => eventById.has(String(t.eventId)))
        .map((t) => ({
            ticket: t,
            event: eventById.get(String(t.eventId)),
            ticketType: ttById.get(String(t.ticketTypeId)),
        }));

    return { items, total: items.length };
};

export const getMyTicket = async (userId: string, ticketId: string): Promise<TicketWithContext> => {
    const ticket = await Ticket.findOne({
        _id: new Types.ObjectId(ticketId),
        ownerUserId: new Types.ObjectId(userId),
    }).lean();
    if (!ticket) throw new AppError('Billet introuvable.', 404);

    const [event, ticketType, activeResaleListing] = await Promise.all([
        Event.findById(ticket.eventId).lean(),
        TicketType.findById(ticket.ticketTypeId).lean(),
        ResaleListing.findOne({ ticketId: ticket._id, status: ResaleListingStatus.ACTIVE }).lean(),
    ]);

    let qrImageDataUrl: string | undefined;
    if (ticket.status === TicketStatus.ISSUED && ticket.qrToken) {
        qrImageDataUrl = await renderQrDataUrl(ticket.qrToken);
    }

    return {
        ticket,
        event,
        ticketType,
        qrImageDataUrl,
        activeResaleListing: activeResaleListing || undefined,
    };
};
