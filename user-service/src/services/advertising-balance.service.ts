import { Types } from 'mongoose';
import { UserRepository } from '../database/repositories/user.repository';
import { paymentService } from './clients/payment.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('AdvertisingBalanceService');

/**
 * Diffuseur earnings from the WhatsApp status advertising marketplace.
 *
 * Held separately from the main balance per product decision, and deliberately NOT
 * directly withdrawable. The only exit is a transfer into the main balance, after
 * which the existing payout path handles it unchanged — see
 * transferFromAdvertisingToMain for why.
 */

/** Rufus's rule: minimum 2 000 FCFA out of the advertising balance. */
const MIN_TRANSFER_AMOUNT = Number(process.env.ADVERTISING_MIN_TRANSFER || 2000);

export class AdvertisingBalanceService {
    private userRepository = new UserRepository();

    async getBalance(userId: string): Promise<{ advertisingBalance: number; minTransferAmount: number }> {
        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) throw new AppError('User not found', 404);

        return {
            advertisingBalance: user.advertisingBalance || 0,
            minTransferAmount: MIN_TRANSFER_AMOUNT,
        };
    }

    /**
     * Credits verified campaign earnings. Service-to-service only.
     *
     * Idempotency is the caller's job: advertising-service stamps creditedAt on the
     * participation and refuses to credit twice. Enforcing it here would need a
     * ledger this service has no reason to own.
     */
    async credit(
        userId: string,
        amount: number,
        reference: string,
        description: string,
    ): Promise<{ newAdvertisingBalance: number; transactionId: string }> {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('Credit amount must be a positive number', 400);
        }

        const updated = await this.userRepository.creditAdvertisingBalance(userId, amount);
        if (!updated) throw new AppError('User not found', 404);

        let transactionId = '';
        try {
            const tx = await paymentService.recordActivationTransaction({
                userId,
                type: 'advertising_earnings',
                amount,
                description,
                metadata: {
                    reference,
                    newAdvertisingBalance: updated.advertisingBalance,
                },
            });
            transactionId = tx.transactionId;
        } catch (error: any) {
            // The credit already landed. Losing the audit row is bad but reversing a
            // diffuseur's earnings because logging failed would be worse.
            log.error(`Failed to record advertising credit transaction for ${userId}: ${error.message}`);
        }

        log.info(`Credited ${amount} XAF advertising earnings to ${userId} (ref: ${reference})`);

        return { newAdvertisingBalance: updated.advertisingBalance, transactionId };
    }

    /**
     * Moves advertising earnings into the main balance, where they can be withdrawn.
     */
    async transferToMain(
        userId: string,
        amount: number,
        ipAddress?: string,
    ): Promise<{ newBalance: number; newAdvertisingBalance: number; transactionId: string }> {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('Transfer amount must be a positive number', 400);
        }
        if (amount < MIN_TRANSFER_AMOUNT) {
            throw new AppError(
                `Le montant minimum de transfert est de ${MIN_TRANSFER_AMOUNT} XAF.`,
                400,
            );
        }

        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) throw new AppError('User not found', 404);

        if ((user.advertisingBalance || 0) < amount) {
            throw new AppError(
                `Solde publicitaire insuffisant. Disponible: ${user.advertisingBalance || 0} XAF, Requis: ${amount} XAF`,
                400,
            );
        }

        // Same guard as the activation transfer. SBC debits on success, so a pending
        // withdrawal means the main balance already includes funds on their way out.
        // Adding to it under that figure produces the mrdigit237@gmail.com cascade:
        // when the withdrawal reconciles, the wallet goes negative.
        const hasPendingWithdrawal = await paymentService.hasUserPendingWithdrawal(userId);
        if (hasPendingWithdrawal) {
            throw new AppError(
                "Un retrait est en cours de traitement sur votre compte. Veuillez attendre qu'il soit complété avant de transférer vos gains publicitaires.",
                409,
            );
        }

        const updated = await this.userRepository.transferFromAdvertisingToMain(userId, amount);
        // null means the atomic precondition failed, i.e. a concurrent transfer won.
        if (!updated) {
            throw new AppError('Solde publicitaire insuffisant. Veuillez réessayer.', 400);
        }

        let transactionId = '';
        try {
            const tx = await paymentService.recordActivationTransaction({
                userId,
                type: 'advertising_transfer_out',
                amount,
                description: `Transfert de ${amount} XAF des gains publicitaires vers le solde principal`,
                metadata: {
                    previousBalance: user.balance,
                    newBalance: updated.balance,
                    previousAdvertisingBalance: user.advertisingBalance || 0,
                    newAdvertisingBalance: updated.advertisingBalance,
                },
                ipAddress,
            });
            transactionId = tx.transactionId;
        } catch (error: any) {
            log.error(`Failed to record advertising transfer transaction for ${userId}: ${error.message}`);
        }

        log.info(
            `Transferred ${amount} XAF from advertising to main for ${userId}. ` +
            `Advertising: ${updated.advertisingBalance}, Main: ${updated.balance}`,
        );

        return {
            newBalance: updated.balance,
            newAdvertisingBalance: updated.advertisingBalance,
            transactionId,
        };
    }
}

export const advertisingBalanceService = new AdvertisingBalanceService();
