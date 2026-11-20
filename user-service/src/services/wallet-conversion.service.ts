import { Types } from 'mongoose';
import WalletConversionModel, { IWalletConversion } from '../database/models/wallet-conversion.model';
import WalletMovementModel, { WalletMovementStatus } from '../database/models/wallet-movement.model';
import { userRepository, InsufficientAvailableBalanceError } from '../database/repositories/user.repository';
import { openSupportCase } from './clients/support.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('WalletConversion');

export type ConversionOutcome = 'converted' | 'insufficient' | 'busy' | 'credit_pending';

const move = (userId: Types.ObjectId | string, currency: 'XAF' | 'USD', delta: number, reference: string) =>
    currency === 'XAF'
        ? userRepository.updateBalance(userId, delta, { reference, source: 'conversion' })
        : userRepository.updateUsdBalance(userId, delta, { reference, source: 'conversion' });

/**
 * XAF ⇄ USD conversion: claim (one open per member) → guarded debit → credit,
 * each leg under a fixed ledger reference. A credit that does not land stays
 * `debited` and is finished by retryPendingConversions — never undone (an
 * unclear credit may have landed).
 */
export async function convertBalance(input: {
    userId: string | Types.ObjectId; from: 'XAF' | 'USD'; fromAmount: number; to: 'XAF' | 'USD'; toAmount: number;
}): Promise<{ outcome: ConversionOutcome; reference?: string }> {
    const reference = `conversion:${new Types.ObjectId().toHexString()}`;
    try {
        await WalletConversionModel.create({
            reference, userId: new Types.ObjectId(input.userId.toString()), fromCurrency: input.from, fromAmount: input.fromAmount,
            toCurrency: input.to, toAmount: input.toAmount, state: 'started', open: true,
        });
    } catch (err: any) {
        if (err?.code === 11000) return { outcome: 'busy' };
        throw err;
    }
    try {
        await move(input.userId, input.from, -input.fromAmount, `${reference}:out`);
    } catch (err: any) {
        if (err instanceof InsufficientAvailableBalanceError) {
            await WalletConversionModel.deleteOne({ reference, state: 'started' });
            return { outcome: 'insufficient' };
        }
        // Unclear: the retry job looks at the ledger to know whether the debit happened.
        await WalletConversionModel.updateOne({ reference }, { $set: { lastError: String(err.message).slice(0, 500) } });
        throw err;
    }
    await WalletConversionModel.updateOne({ reference, state: 'started' }, { $set: { state: 'debited' } });
    const credited = await creditLeg(reference);
    return { outcome: credited ? 'converted' : 'credit_pending', reference };
}

/** Credits `<reference>:in` (idempotent) and closes the conversion. */
async function creditLeg(reference: string): Promise<boolean> {
    const row = await WalletConversionModel.findOne({ reference, state: 'debited' }).lean<IWalletConversion>();
    if (!row) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await move(row.userId, row.toCurrency, row.toAmount, `${reference}:in`);
            await WalletConversionModel.updateOne({ reference, state: 'debited' }, { $set: { state: 'credited' }, $unset: { open: '' } });
            return true;
        } catch (err: any) {
            await WalletConversionModel.updateOne({ reference }, { $inc: { attempts: 1 }, $set: { lastError: String(err.message).slice(0, 500) } });
        }
    }
    log.error(`Conversion ${reference}: debit applied, credit of ${row.toAmount} ${row.toCurrency} still pending (retried by the job)`);
    return false;
}

/**
 * Finishes conversions left open for more than `minAgeMs`: `debited` → credit
 * again under the same reference; `started` → debited if its `:out` debit is in
 * the ledger, abandoned (closed) if not after 10 minutes. Runs every 10 min.
 */
export async function retryPendingConversions(now = new Date(), minAgeMs = 2 * 60 * 1000): Promise<{ credited: number; abandoned: number; stillPending: number }> {
    const rows = await WalletConversionModel.find({ open: true, updatedAt: { $lt: new Date(now.getTime() - minAgeMs) } }).limit(500).lean<IWalletConversion[]>();
    const out = { credited: 0, abandoned: 0, stillPending: 0 };
    for (const row of rows) {
        if (row.state === 'started') {
            const debit = await WalletMovementModel.findOne({ reference: `${row.reference}:out`, direction: 'DEBIT' }).lean();
            if (debit?.status === WalletMovementStatus.APPLIED) {
                await WalletConversionModel.updateOne({ reference: row.reference, state: 'started' }, { $set: { state: 'debited' } });
            } else if (!debit && now.getTime() - new Date(row.createdAt).getTime() > 10 * 60 * 1000) {
                await WalletConversionModel.updateOne({ reference: row.reference, state: 'started' }, { $set: { state: 'abandoned' }, $unset: { open: '' } });
                out.abandoned++;
                continue;
            } else {
                out.stillPending++; // PENDING debit: the nightly ledger check reports it
                continue;
            }
        }
        if (await creditLeg(row.reference)) out.credited++;
        else {
            out.stillPending++;
            if ((row.attempts ?? 0) >= 9) {
                void openSupportCase({
                    type: 'ledger_mismatch', dedupKey: `ledger:${row.reference}`, severity: 'critical', subject: { userId: row.userId.toString() },
                    summary: `Conversion de devise : débit appliqué, crédit de ${row.toAmount} ${row.toCurrency} toujours en attente.`,
                    details: { reference: row.reference, lastError: row.lastError ?? null },
                });
            }
        }
    }
    if (rows.length) log.info(`Conversion retry: ${JSON.stringify(out)}`);
    return out;
}
