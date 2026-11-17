import { Types } from 'mongoose';
import SubscriptionActivationModel from '../database/models/subscription-activation.model';
import logger from '../utils/logger';

const log = logger.getLogger('SubscriptionActivation');

/**
 * A reservation still `applying` after this long is taken to be from a
 * process that died mid-activation, and the next delivery may take it over.
 * Activation takes well under a second; this is only crash recovery.
 */
export const STALE_RESERVATION_MS = 15 * 60 * 1000;

export type ReserveOutcome =
    | { outcome: 'reserved' }
    | { outcome: 'already_applied'; subscriptionId?: string }
    | { outcome: 'in_progress' };

/** Error thrown when the same payment is being activated right now by another delivery. */
export class ActivationInProgressError extends Error {
    code = 'ACTIVATION_IN_PROGRESS';
    statusCode = 409;
    constructor(sessionId: string) {
        super(`Activation for payment ${sessionId} is already in progress.`);
    }
}

/**
 * Claims the right to activate the subscription paid by `sessionId`.
 * Exactly one concurrent caller gets `reserved`; the others learn whether it
 * is done (`already_applied`) or still running (`in_progress`).
 */
export async function reserveActivation(args: {
    sessionId: string; userId: string; planId: string; isUpgrade?: boolean; now?: Date;
}): Promise<ReserveOutcome> {
    const now = args.now ?? new Date();
    try {
        await SubscriptionActivationModel.create({
            sessionId: args.sessionId,
            userId: new Types.ObjectId(args.userId),
            planId: args.planId,
            isUpgrade: !!args.isUpgrade,
            status: 'applying',
            reservedAt: now,
        });
        return { outcome: 'reserved' };
    } catch (err: any) {
        if (err?.code !== 11000) throw err;
    }

    const existing = await SubscriptionActivationModel.findOne({ sessionId: args.sessionId }).lean();
    if (!existing) {
        // Released between our insert attempt and this read: let the caller retry later.
        return { outcome: 'in_progress' };
    }
    if (existing.status === 'applied') {
        return { outcome: 'already_applied', subscriptionId: existing.subscriptionId ? String(existing.subscriptionId) : undefined };
    }
    if (String(existing.userId) !== String(args.userId) || existing.planId !== args.planId) {
        // Same payment, different metadata: never apply it a second way.
        log.error(`Payment ${args.sessionId} reserved for ${existing.userId}/${existing.planId}, now delivered for ${args.userId}/${args.planId}; refusing.`);
        return { outcome: 'in_progress' };
    }
    // Take over a reservation left by a crashed delivery (conditional: one winner).
    const takeover = await SubscriptionActivationModel.updateOne(
        { sessionId: args.sessionId, status: 'applying', reservedAt: { $lt: new Date(now.getTime() - STALE_RESERVATION_MS) } },
        { $set: { reservedAt: now }, $inc: { attempts: 1 } },
    );
    if (takeover.modifiedCount === 1) {
        log.warn(`Taking over stale activation reservation for payment ${args.sessionId}`);
        return { outcome: 'reserved' };
    }
    return { outcome: 'in_progress' };
}

/** The subscription is applied: later deliveries of this payment do nothing. */
export async function markActivationApplied(sessionId: string, result: { subscriptionId?: unknown; alreadyActive?: boolean }): Promise<void> {
    await SubscriptionActivationModel.updateOne(
        { sessionId, status: 'applying' },
        {
            $set: {
                status: 'applied',
                appliedAt: new Date(),
                ...(result.subscriptionId ? { subscriptionId: new Types.ObjectId(String(result.subscriptionId)) } : {}),
                alreadyActive: !!result.alreadyActive,
            },
        },
    );
}

/** Activation failed: free the payment so its next delivery can apply it. */
export async function releaseActivation(sessionId: string): Promise<void> {
    await SubscriptionActivationModel.deleteOne({ sessionId, status: 'applying' }).catch(err =>
        log.error(`Could not release activation reservation ${sessionId}: ${err?.message ?? err}`));
}
