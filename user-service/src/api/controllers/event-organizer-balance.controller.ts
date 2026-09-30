import { Response } from 'express';
import { eventOrganizerBalanceService } from '../../services/event-organizer-balance.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('EventOrganizerBalanceController');

const fail = (res: Response, error: unknown, context: string) => {
    const status = (error as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, error);
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (error as Error).message,
    });
};

class EventOrganizerBalanceController {
    /** Organizer's event earnings and the minimum they can move out. */
    async getBalance(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) throw new AppError('User not authenticated', 401);

            const data = await eventOrganizerBalanceService.getBalance(userId);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return fail(res, error, 'getBalance');
        }
    }

    /**
     * Moves organizer earnings into the main balance so they can be withdrawn.
     * The event balance is never paid out directly — routing through the main
     * balance keeps the payout path untouched.
     */
    async transferToMain(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) throw new AppError('User not authenticated', 401);

            const amount = Number(req.body.amount);
            const result = await eventOrganizerBalanceService.transferToMain(
                userId,
                amount,
                req.ip,
            );

            return res.status(200).json({
                success: true,
                message: `${amount} XAF transférés vers votre solde principal.`,
                data: result,
            });
        } catch (error) {
            return fail(res, error, 'transferToMain');
        }
    }

    /**
     * Credits verified organizer earnings. Service-to-service only, called by
     * event-service once an order or resale settlement lands.
     *
     * Idempotency lives with the caller — event-service stamps creditedAt on the
     * order and refuses to credit the same one twice.
     */
    async creditEarnings(req: AuthenticatedRequest, res: Response) {
        try {
            const { userId, amount, reference, description } = req.body;
            if (!userId || !reference) {
                throw new AppError('userId and reference are required', 400);
            }

            const result = await eventOrganizerBalanceService.credit(
                userId,
                Number(amount),
                reference,
                description || `Gains organisateur (${reference})`,
            );

            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            return fail(res, error, 'creditEarnings');
        }
    }

    /**
     * Debit seller earnings for a resale refund. Service-to-service only.
     * May take the balance negative — see debit() docstring.
     */
    async debitEarnings(req: AuthenticatedRequest, res: Response) {
        try {
            const { userId, amount, reference, description } = req.body;
            if (!userId || !reference) throw new AppError('userId and reference are required', 400);
            const result = await eventOrganizerBalanceService.debit(
                userId,
                Number(amount),
                reference,
                description || `Débit remboursement revente (${reference})`,
            );
            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            return fail(res, error, 'debitEarnings');
        }
    }
}

export const eventOrganizerBalanceController = new EventOrganizerBalanceController();
