import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import config from '../config';
import { RelancePack } from '../config/relance-packs';
import RelanceBalancePurchaseModel, { RelanceBalancePurchaseStatus } from '../database/models/relance-balance-purchase.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import { creditRelancePack } from './relance-credit.service';
import logger from '../utils/logger';

const log = logger.getLogger('RelanceBalancePurchase');

/**
 * Buying a relance pack with the SBC balance (Rufus, 2026-10-20: « ça marche
 * seulement avec les campagnes, pas encore avec la relance »).
 *
 * Full payment only: packs cost 2,500 to 125,000 F, so the balance pays all of
 * it or the member uses Mobile Money as before. The money moves through the
 * same payment-service calls as Ads Network campaigns: one conditional debit in
 * user-service (balance net of debt must cover it), a PAYMENT line in the
 * wallet history, and a refund that never pays twice for one reference.
 *
 * Order: claim (unique row) → debit → credit. Any failure after the debit is
 * refunded on the spot; one that cannot be (a restart, payment-service down) is
 * left `pending` and settled by `sweepInterruptedBalancePurchases`.
 */

/** A purchase still pending after this long was interrupted between debit and credit. */
const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;

export type BalancePurchaseResult =
    | { outcome: 'credited'; credits: number; packType: 'email' | 'sms'; amount: number; balance?: number }
    | { outcome: 'insufficient' }
    | { outcome: 'in_progress' }
    | { outcome: 'failed'; refunded: boolean };

const paymentHeaders = () => ({
    Authorization: `Bearer ${config.services.serviceSecret}`,
    'X-Service-Name': 'notification-service',
});

const packLabel = (pack: RelancePack) =>
    `${pack.credits.toLocaleString('fr-FR')} crédits ${pack.type === 'email' ? 'email' : 'SMS'}`;

/** A request id the app may send so a repeated tap is the same purchase. */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const mark = (reference: string, status: RelanceBalancePurchaseStatus) =>
    RelanceBalancePurchaseModel.updateOne({ reference, status: 'pending' }, { $set: { status } });

async function spend(userId: string, pack: RelancePack, reference: string): Promise<'taken' | 'insufficient'> {
    try {
        await axios.post(
            `${config.services.paymentService}/internal/balance-spend`,
            {
                userId,
                amount: pack.priceXAF,
                reference,
                description: `Pack relance : ${packLabel(pack)}`,
                metadata: { packId: pack.id, packType: pack.type, credits: pack.credits, originatingService: 'notification-service' },
            },
            { headers: paymentHeaders(), timeout: 15000 },
        );
        return 'taken';
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) return 'insufficient';
        throw err;
    }
}

async function refund(userId: string, reference: string): Promise<void> {
    // payment-service refunds at most what this reference took, at most once,
    // and does nothing for a reference that took nothing.
    await axios.post(
        `${config.services.paymentService}/internal/balance-refund`,
        { userId, reference, description: 'Remboursement : pack relance non crédité' },
        { headers: paymentHeaders(), timeout: 15000 },
    );
}

/**
 * Ends a purchase that could not be credited. If the pack turns out to be
 * credited after all, it stays bought; otherwise the payment is refunded. When
 * the refund itself fails the row stays pending and the sweep tries again.
 */
async function settleUncredited(userId: string, reference: string, pack?: RelancePack): Promise<BalancePurchaseResult> {
    if (await RelancePackCreditModel.exists({ sessionId: reference })) {
        await mark(reference, 'credited');
        return pack
            ? { outcome: 'credited', credits: pack.credits, packType: pack.type, amount: pack.priceXAF }
            : { outcome: 'in_progress' };
    }
    try {
        await refund(userId, reference);
        await mark(reference, 'refunded');
        log.warn(`Balance purchase ${reference} not credited; refunded`);
        return { outcome: 'failed', refunded: true };
    } catch (err: any) {
        log.error(`Balance purchase ${reference} not credited and its refund failed; the sweep retries: ${err.message}`);
        return { outcome: 'failed', refunded: false };
    }
}

/** A second tap with the same request id: wait for the first one's outcome. */
async function outcomeOf(reference: string, pack: RelancePack): Promise<BalancePurchaseResult> {
    for (let i = 0; i < 40; i++) {
        const row = await RelanceBalancePurchaseModel.findOne({ reference }).select('status').lean();
        if (row?.status === 'credited') return { outcome: 'credited', credits: pack.credits, packType: pack.type, amount: pack.priceXAF };
        if (row?.status === 'insufficient') return { outcome: 'insufficient' };
        if (row?.status === 'refunded') return { outcome: 'failed', refunded: true };
        await new Promise(r => setTimeout(r, 250));
    }
    return { outcome: 'in_progress' };
}

export async function buyPackWithBalance(input: {
    userId: string;
    pack: RelancePack;
    requestId?: unknown;
}): Promise<BalancePurchaseResult> {
    const { userId, pack } = input;
    const requestId = typeof input.requestId === 'string' && REQUEST_ID.test(input.requestId)
        ? input.requestId
        : crypto.randomUUID();
    const reference = `relance-pack:${userId}:${requestId}`;

    try {
        await RelanceBalancePurchaseModel.create({
            reference,
            userId: new mongoose.Types.ObjectId(userId),
            packId: pack.id,
            amount: pack.priceXAF,
        });
    } catch (err: any) {
        if (err?.code === 11000) return outcomeOf(reference, pack);
        throw err;
    }

    let spent: 'taken' | 'insufficient';
    try {
        spent = await spend(userId, pack, reference);
    } catch (err: any) {
        // The debit may or may not have happened; refunding the reference is safe either way.
        log.error(`Balance payment for ${reference} failed: ${err.message}`);
        return settleUncredited(userId, reference, pack);
    }
    if (spent === 'insufficient') {
        await mark(reference, 'insufficient');
        return { outcome: 'insufficient' };
    }

    let credited;
    try {
        credited = await creditRelancePack({ sessionId: reference, userId, packId: pack.id });
    } catch (err: any) {
        log.error(`Pack ${pack.id} paid from the balance (${reference}) but crediting failed: ${err.message}`);
        return settleUncredited(userId, reference, pack);
    }
    if (credited.outcome === 'rejected') {
        log.error(`Pack ${pack.id} paid from the balance (${reference}) but crediting was refused: ${credited.reason}`);
        return settleUncredited(userId, reference, pack);
    }

    // The credit is what matters; if this status write fails, the sweep finds
    // the credit row and marks it then.
    await mark(reference, 'credited').catch(err => log.warn(`Could not mark ${reference} credited: ${err.message}`));
    log.info(`User ${userId} bought pack ${pack.id} with the SBC balance (${pack.priceXAF} XAF, ${reference})`);
    return {
        outcome: 'credited',
        credits: pack.credits,
        packType: pack.type,
        amount: pack.priceXAF,
        balance: credited.outcome === 'credited' ? credited.balance : undefined,
    };
}

/**
 * Settles purchases interrupted between the debit and the crediting: keeps the
 * ones whose pack was credited, refunds the others. Runs on a schedule.
 */
export async function sweepInterruptedBalancePurchases(now: Date = new Date()): Promise<number> {
    const stale = await RelanceBalancePurchaseModel.find({
        status: 'pending',
        createdAt: { $lt: new Date(now.getTime() - INTERRUPTED_AFTER_MS) },
    }).limit(100);

    let settled = 0;
    for (const purchase of stale) {
        const result = await settleUncredited(String(purchase.userId), purchase.reference);
        if (!(result.outcome === 'failed' && !result.refunded)) settled++;
    }
    if (settled) log.info(`Settled ${settled} interrupted relance balance purchase(s)`);
    return settled;
}
