import { Types } from 'mongoose';
import Dispute, { DisputeKind, DisputeStatus, IDispute } from '../database/models/dispute.model';
import Ticket from '../database/models/ticket.model';
import ResaleOrder from '../database/models/resale-order.model';
import { AppError } from '../utils/errors';

/**
 * Opens a dispute filed by a user. The user must actually own the ticket
 * (or be the buyer on the resale order) to prevent someone from filing
 * disputes against arbitrary tickets they didn't buy.
 */
export const openDispute = async (args: {
    complainantUserId: string;
    kind: string;
    description: string;
    ticketId?: string;
    resaleOrderId?: string;
}): Promise<IDispute> => {
    if (!args.description?.trim() || args.description.trim().length < 10) {
        throw new AppError('Décrivez le problème en au moins 10 caractères.', 400);
    }
    if (!Object.values(DisputeKind).includes(args.kind as DisputeKind)) {
        throw new AppError('Type de litige invalide.', 400);
    }
    if (!args.ticketId && !args.resaleOrderId) {
        throw new AppError('Précisez un billet ou une revente concerné(e).', 400);
    }

    let eventId: Types.ObjectId | undefined;

    if (args.ticketId) {
        const ticket = await Ticket.findOne({
            _id: new Types.ObjectId(args.ticketId),
            ownerUserId: new Types.ObjectId(args.complainantUserId),
        });
        if (!ticket) throw new AppError('Billet introuvable ou ne vous appartient pas.', 404);
        eventId = ticket.eventId;
    }
    if (args.resaleOrderId) {
        const ro = await ResaleOrder.findOne({
            _id: new Types.ObjectId(args.resaleOrderId),
            buyerUserId: new Types.ObjectId(args.complainantUserId),
        });
        if (!ro) throw new AppError('Revente introuvable ou vous ne l\'avez pas achetée.', 404);
        // Prefer the resale order's ticket's event
        if (!eventId && ro.newTicketId) {
            const t = await Ticket.findById(ro.newTicketId).select('eventId').lean();
            if (t) eventId = t.eventId;
        }
    }

    return Dispute.create({
        kind: args.kind,
        complainantUserId: new Types.ObjectId(args.complainantUserId),
        ticketId: args.ticketId ? new Types.ObjectId(args.ticketId) : undefined,
        resaleOrderId: args.resaleOrderId ? new Types.ObjectId(args.resaleOrderId) : undefined,
        eventId,
        description: args.description.trim(),
        status: DisputeStatus.OPEN,
    });
};

export const listMyDisputes = async (userId: string) => {
    return Dispute.find({ complainantUserId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .lean();
};
