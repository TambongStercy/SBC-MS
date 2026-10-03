import { Types } from 'mongoose';
import Ticket, { TicketStatus } from '../../../database/models/ticket.model';

/**
 * Does the user hold a valid ticket for the event (§7, §12)? Optionally of one
 * of `ticketTypeIds`. A refunded or cancelled ticket does not count; a scanned
 * one (CHECKED_IN) does — they came.
 */
export const holdsValidTicket = async (userId: string, eventId: string | Types.ObjectId, ticketTypeIds?: (string | Types.ObjectId)[]) => {
    const filter: Record<string, unknown> = {
        ownerUserId: new Types.ObjectId(userId),
        eventId: new Types.ObjectId(String(eventId)),
        status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] },
    };
    if (ticketTypeIds?.length) filter.ticketTypeId = { $in: ticketTypeIds.map((id) => new Types.ObjectId(String(id))) };
    return Boolean(await Ticket.exists(filter));
};

/** Distinct holders of a valid ticket (draw entrants), optionally restricted to ticket types. */
export const ticketHolderIds = async (eventId: string | Types.ObjectId, ticketTypeIds?: (string | Types.ObjectId)[]): Promise<string[]> => {
    const filter: Record<string, unknown> = {
        eventId: new Types.ObjectId(String(eventId)),
        status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] },
    };
    if (ticketTypeIds?.length) filter.ticketTypeId = { $in: ticketTypeIds.map((id) => new Types.ObjectId(String(id))) };
    const ids = await Ticket.distinct('ownerUserId', filter);
    return ids.map(String);
};
