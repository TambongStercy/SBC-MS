import mongoose from 'mongoose';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import { findPack } from '../config/relance-packs';
import logger from '../utils/logger';

const log = logger.getLogger('RelanceCreditService');

export type CreditPackResult =
    | { outcome: 'credited'; credits: number; packType: 'email' | 'sms'; balance: number }
    | { outcome: 'already_credited'; credits: number; packType: 'email' | 'sms' }
    | { outcome: 'rejected'; reason: string };

/**
 * Credits a paid relance pack to its buyer, exactly once per payment.
 *
 * The credit amount is taken from the pack table by packId, never from the
 * caller: the number of credits is ours to decide, not the request's.
 *
 * Mongo here is a standalone server, so there is no transaction. The credit row
 * is written first (its unique sessionId is the idempotency guard) and removed
 * again if the balance update then fails, so a retry can still succeed.
 */
export async function creditRelancePack(input: {
    sessionId?: string;
    userId?: string;
    packId?: string;
}): Promise<CreditPackResult> {
    const { sessionId, userId, packId } = input;

    if (!sessionId) return { outcome: 'rejected', reason: 'missing sessionId' };
    if (!userId || !mongoose.isValidObjectId(userId)) return { outcome: 'rejected', reason: 'missing or invalid userId' };
    const pack = packId ? findPack(packId) : undefined;
    if (!pack) return { outcome: 'rejected', reason: `unknown packId ${packId ?? '(none)'}` };

    try {
        await RelancePackCreditModel.create({
            sessionId,
            userId: new mongoose.Types.ObjectId(userId),
            packId: pack.id,
            packType: pack.type,
            credits: pack.credits,
        });
    } catch (err: any) {
        if (err?.code === 11000) {
            log.info(`Pack payment ${sessionId} already credited — ignoring repeat delivery`);
            return { outcome: 'already_credited', credits: pack.credits, packType: pack.type };
        }
        throw err;
    }

    const balanceField = pack.type === 'email' ? 'emailBalance' : 'smsBalance';
    try {
        const cfg = await RelanceConfigModel.findOneAndUpdate(
            { userId },
            // SMS packs are sold to Cameroonian parrains only; buying one is what
            // switches SMS relance on. It used to need an admin to flip smsEnabled,
            // so paid SMS credits sat unused.
            pack.type === 'sms'
                ? { $inc: { smsBalance: pack.credits }, $set: { smsEnabled: true } }
                : { $inc: { emailBalance: pack.credits } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        const balance = (cfg as any)?.[balanceField] ?? pack.credits;
        log.info(`Credited ${pack.credits} ${pack.type} credits to user ${userId} (pack ${pack.id}, session ${sessionId}); balance now ${balance}`);
        return { outcome: 'credited', credits: pack.credits, packType: pack.type, balance };
    } catch (err) {
        // Undo the guard so the payment is not marked as credited when it was not.
        await RelancePackCreditModel.deleteOne({ sessionId }).catch(() => undefined);
        throw err;
    }
}
