import mongoose, { Types } from 'mongoose';
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

    // Atomically mark checked-in AND create the CheckIn row. Both live in one txn
    // so the unique{ticketId} index on CheckIn is the last line of defence against
    // a duplicate scan slipping through.
    const session = await mongoose.startSession();
    try {
        let committedCheckIn: Date | null = null;
        await session.withTransaction(async () => {
            const updated = await Ticket.findOneAndUpdate(
                { _id: ticket._id, status: TicketStatus.ISSUED },
                { $set: { status: TicketStatus.CHECKED_IN, checkedInAt: new Date() } },
                { new: true, session },
            );
            if (!updated) {
                // Someone scanned it between our read and the update.
                throw new AppError('__ALREADY_USED__', 409);
            }
            await CheckIn.create([{
                ticketId: ticket._id,
                eventId: ticket.eventId,
                scannedByUserId: new Types.ObjectId(args.scannedByUserId),
                deviceInfo: args.deviceInfo,
                scannedAt: updated.checkedInAt!,
            }], { session });
            committedCheckIn = updated.checkedInAt!;
        });

        // Best-effort: increment event denorm counter outside the txn
        Event.updateOne({ _id: ticket.eventId }, { $inc: { 'totals.checkedIn': 1 } }).catch(() => undefined);

        return {
            outcome: 'VALID',
            message: 'Entrée validée.',
            ticket: { serial: ticket.serial, holderName: ticket.holderName, ticketTypeId: String(ticket.ticketTypeId) },
            checkedInAt: committedCheckIn ?? new Date(),
        };
    } catch (err: any) {
        if (err?.message === '__ALREADY_USED__') {
            const fresh = await Ticket.findById(ticket._id).lean();
            return {
                outcome: 'ALREADY_USED',
                message: 'Ce billet a déjà été utilisé.',
                ticket: fresh ? { serial: fresh.serial, holderName: fresh.holderName, ticketTypeId: String(fresh.ticketTypeId) } : undefined,
                checkedInAt: fresh?.checkedInAt,
            };
        }
        throw err;
    } finally {
        await session.endSession();
    }
};
