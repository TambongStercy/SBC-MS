import { Response } from 'express';
import { advertisingBalanceService } from '../../services/advertising-balance.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('AdvertisingBalanceController');

const fail = (res: Response, error: unknown, context: string) => {
    const status = (error as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, error);
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (error as Error).message,
    });
};

class AdvertisingBalanceController {
    /** Diffuseur's advertising earnings and the minimum they can move out. */
    async getBalance(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) throw new AppError('User not authenticated', 401);

            const data = await advertisingBalanceService.getBalance(userId);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return fail(res, error, 'getBalance');
        }
    }

    /**
     * Moves advertising earnings into the main balance so they can be withdrawn.
     *
     * The advertising balance is never paid out directly — routing through the main
     * balance keeps the payout path, which is the most incident-prone code in the
     * system, completely untouched.
     */
    async transferToMain(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) throw new AppError('User not authenticated', 401);

            const amount = Number(req.body.amount);
            const result = await advertisingBalanceService.transferToMain(
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
     * Credits verified campaign earnings. Service-to-service only, called by
     * advertising-service once every campaign day is verified.
     *
     * Idempotency lives with the caller, which stamps creditedAt on the
     * participation and refuses to credit the same one twice.
     */
    async creditEarnings(req: AuthenticatedRequest, res: Response) {
        try {
            const { userId, amount, reference, description } = req.body;
            if (!userId || !reference) {
                throw new AppError('userId and reference are required', 400);
            }

            const result = await advertisingBalanceService.credit(
                userId,
                Number(amount),
                reference,
                description || `Gains publicitaires (${reference})`,
            );

            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            return fail(res, error, 'creditEarnings');
        }
    }
}

export const advertisingBalanceController = new AdvertisingBalanceController();
