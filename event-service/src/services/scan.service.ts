import { Types } from 'mongoose';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import Event, { EventStatus } from '../database/models/event.model';
import CheckIn from '../database/models/checkin.model';
import { verifyQrToken } from './qr.service';
import { findApprovedOrganizer } from './organizer.service';
import { AppError } from '../utils/errors';

export type ScanOutcome = 'VALID' | 'ALREADY_USED' | 'INVALID' | 'CANCELLED' | 'REFUNDED' | 'WRONG_EVENT' | 'EVENT_NOT_OPEN';

export interface ScanResult {
    outcome: ScanOutcome;
    message: string;
    ticket?: {
        serial: string;
        holderName: string;
        ticketTypeId: string;
    };
    checkedInAt?: Date;
}

/**
 * Validate a scanned QR token and, if valid, atomically record the check-in.
 * All state transitions happen inside a Mongo transaction so a partial
 * failure never leaves ticket=CHECKED_IN without a matching CheckIn row.
 */
export const scanQr = async (args: {
    scannedByUserId: string;
    qrToken: string;
    /**
     * If the scanner passes their event context (they usually do — the app knows
     * which event they're at), we can refuse tickets that belong elsewhere.
     * Missing = infer from ticket.
     */
    expectedEventId?: string;
    deviceInfo?: string;
}): Promise<ScanResult> => {
    if (!args.qrToken || !verifyQrToken(args.qrToken)) {
        return { outcome: 'INVALID', message: 'QR Code invalide.' };
    }

    // Look up ticket by opaque token
    const ticket = await Ticket.findOne({ qrToken: args.qrToken });
    if (!ticket) return { outcome: 'INVALID', message: 'Billet introuvable.' };

    // Authorize: scanner must be an approved organizer AND own the event
    const event = await Event.findById(ticket.eventId);
    if (!event) return { outcome: 'INVALID', message: 'Événement introuvable.' };

    const organizer = await findApprovedOrganizer(args.scannedByUserId);
    if (!organizer || String(organizer._id) !== String(event.organizerId)) {
        throw new AppError('Vous n\'êtes pas autorisé à scanner les billets de cet événement.', 403);
    }

    if (args.expectedEventId && args.expectedEventId !== String(ticket.eventId)) {
        return { outcome: 'WRONG_EVENT', message: 'Ce billet est pour un autre événement.' };
    }

    if (event.status === EventStatus.CANCELLED) {
        return { outcome: 'CANCELLED', message: 'L\'événement a été annulé.' };
    }

    switch (ticket.status) {
        case TicketStatus.CANCELLED:
            return { outcome: 'CANCELLED', message: 'Billet annulé — accès refusé.' };
        case TicketStatus.REFUNDED:
            return { outcome: 'REFUNDED', message: 'Billet remboursé — accès refusé.' };
        case TicketStatus.CHECKED_IN:
            return {
                outcome: 'ALREADY_USED',
                message: 'Ce billet a déjà été utilisé.',
                ticket: { serial: ticket.serial, holderName: ticket.holderName, ticketTypeId: String(ticket.ticketTypeId) },
                checkedInAt: ticket.checkedInAt,
            };
        case TicketStatus.ISSUED:
            break;
        default:
            return { outcome: 'INVALID', message: 'Billet non valide.' };
    }

    // Two-write flow without a transaction (prod Mongo is standalone; txns need
    // a replica set). The unique{ticketId} index on CheckIn is the primary
    // guard against double check-in — we insert the CheckIn FIRST, and only if
    // that succeeds do we flip the ticket. E11000 on CheckIn = already scanned.
    const now = new Date();
    let checkedInAt: Date;
    try {
        await CheckIn.create({
            ticketId: ticket._id,
            eventId: ticket.eventId,
            scannedByUserId: new Types.ObjectId(args.scannedByUserId),
            deviceInfo: args.deviceInfo,
            scannedAt: now,
        });
        checkedInAt = now;
    } catch (err: any) {
        if (err?.code === 11000) {
            const fresh = await Ticket.findById(ticket._id).lean();
            return {
                outcome: 'ALREADY_USED',
                message: 'Ce billet a déjà été utilisé.',
                ticket: fresh ? { serial: fresh.serial, holderName: fresh.holderName, ticketTypeId: String(fresh.ticketTypeId) } : undefined,
                checkedInAt: fresh?.checkedInAt,
            };
        }
        throw err;
    }

    // Now flip the ticket. Guard on status: if it was refunded/cancelled between
    // our earlier read and now, roll back the CheckIn we just wrote so future
    // scans still hit the ALREADY_USED path with the correct latest status.
    const updated = await Ticket.findOneAndUpdate(
        { _id: ticket._id, status: TicketStatus.ISSUED },
        { $set: { status: TicketStatus.CHECKED_IN, checkedInAt } },
        { new: true },
    );
    if (!updated) {
        // Ticket status changed under us — undo the CheckIn.
        await CheckIn.deleteOne({ ticketId: ticket._id, scannedAt: checkedInAt }).catch(() => undefined);
        const fresh = await Ticket.findById(ticket._id).lean();
        const outcome: ScanOutcome = fresh?.status === TicketStatus.CANCELLED ? 'CANCELLED'
            : fresh?.status === TicketStatus.REFUNDED ? 'REFUNDED'
            : 'INVALID';
        const message = outcome === 'CANCELLED' ? 'Billet annulé — accès refusé.'
            : outcome === 'REFUNDED' ? 'Billet remboursé — accès refusé.'
            : 'Billet non valide.';
        return { outcome, message };
    }

    // Best-effort: increment event denorm counter.
    Event.updateOne({ _id: ticket.eventId }, { $inc: { 'totals.checkedIn': 1 } }).catch(() => undefined);

    return {
        outcome: 'VALID',
        message: 'Entrée validée.',
        ticket: { serial: ticket.serial, holderName: ticket.holderName, ticketTypeId: String(ticket.ticketTypeId) },
        checkedInAt,
    };
};
