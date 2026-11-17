import { FilterQuery, Types, UpdateQuery } from 'mongoose';
import UserModel, { IUser } from '../database/models/user.model';
import WalletMovementModel, {
    WalletCurrency,
    WalletMovementDirection,
    WalletMovementStatus,
} from '../database/models/wallet-movement.model';
import logger from '../utils/logger';

const log = logger.getLogger('WalletLedger');

/**
 * Every change of users.balance / users.usdBalance goes through here, so that
 * each one leaves exactly one walletmovements row.
 *
 * Order (prod Mongo is standalone, no multi-document transactions):
 *   1. insert the movement PENDING — the unique {reference, direction} is the
 *      idempotency claim: a replay finds it and moves nothing;
 *   2. apply the guarded balance update (a single conditional write);
 *   3. mark the movement APPLIED with the before/after balance.
 * Guard refused / user unknown → the PENDING claim is removed (nothing moved).
 * A crash between 2 and 3 leaves PENDING: reported by the nightly check,
 * refused (pendingConflict) on replay rather than applied twice.
 */

export type MovementOutcome = {
    applied: boolean;
    alreadyApplied?: boolean;
    pendingConflict?: boolean;
    guardFailed?: boolean;
    userNotFound?: boolean;
    reference: string;
    /** User after the update (or current user on a replay). */
    user: IUser | null;
    balanceAfter?: number;
};

interface BaseRequest {
    userId: string | Types.ObjectId;
    currency: WalletCurrency;
    /** Stable id of the business event. Generated when absent (no idempotency then). */
    reference?: string;
    source: string;
    description?: string;
}

/** A single atomic update whose effect on the balance field is known in advance. */
export interface IncRequest extends BaseRequest {
    /** Signed change of the balance field. */
    delta: number;
    guard?: FilterQuery<IUser>;
    /** Extra $inc fields applied in the same write (reservedBalance, activationBalance...). */
    extraInc?: Record<string, number>;
}

/**
 * A change computed from the current document (debt settlement): applied by
 * compare-and-set on balance+debt, retried on a concurrent change.
 */
export interface ComputedRequest extends BaseRequest {
    requestedAmount: number;
    compute: (user: IUser) => { set: Record<string, number>; balanceDelta: number; debtDelta: number } | null;
}

const balanceField = (currency: WalletCurrency) => (currency === 'USD' ? 'usdBalance' : 'balance');
const round2 = (n: number) => Math.round(n * 100) / 100;
const isDuplicate = (err: any) => err?.code === 11000;

class WalletLedgerService {
    private makeReference(source: string): string {
        return `auto:${source}:${new Types.ObjectId().toHexString()}`;
    }

    private async claim(req: BaseRequest, direction: WalletMovementDirection, requestedAmount: number, reference: string)
        : Promise<{ claimed: true } | { claimed: false; outcome: MovementOutcome }> {
        // A concurrent caller may be applying the same reference right now: wait
        // for it (a few seconds) instead of reporting a crash.
        const deadline = Date.now() + 5000;
        for (;;) {
            const res = await this.tryClaim(req, direction, requestedAmount, reference);
            if (res !== 'retry') return res;
            if (Date.now() > deadline) {
                const user = await UserModel.findById(req.userId).exec();
                log.error(`Wallet movement ${direction} ${reference} is still PENDING: refusing to guess whether the balance moved`);
                return { claimed: false, outcome: { applied: false, pendingConflict: true, reference, user } };
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    private async tryClaim(req: BaseRequest, direction: WalletMovementDirection, requestedAmount: number, reference: string)
        : Promise<{ claimed: true } | { claimed: false; outcome: MovementOutcome } | 'retry'> {
        try {
            await WalletMovementModel.create({
                reference,
                direction,
                userId: new Types.ObjectId(req.userId.toString()),
                currency: req.currency,
                amount: 0,
                requestedAmount,
                source: req.source,
                description: req.description,
                status: WalletMovementStatus.PENDING,
            });
            return { claimed: true };
        } catch (err: any) {
            if (!isDuplicate(err)) throw err;
            const existing = await WalletMovementModel.findOne({ reference, direction }).lean();
            if (!existing) return 'retry'; // the other claim was withdrawn (guard refused): try again
            if (existing.status === WalletMovementStatus.PENDING) {
                const ageMs = Date.now() - new Date(existing.createdAt).getTime();
                if (ageMs < 60_000) return 'retry'; // in flight elsewhere
                const user = await UserModel.findById(req.userId).exec();
                log.error(`Wallet movement ${direction} ${reference} is PENDING from an earlier attempt: refusing to guess whether the balance moved`);
                return { claimed: false, outcome: { applied: false, pendingConflict: true, reference, user } };
            }
            const user = await UserModel.findById(req.userId).exec();
            log.info(`Wallet movement ${direction} ${reference} already applied: no-op`);
            return { claimed: false, outcome: { applied: false, alreadyApplied: true, reference, user, balanceAfter: existing?.balanceAfter } };
        }
    }

    private async unclaim(reference: string, direction: WalletMovementDirection): Promise<void> {
        await WalletMovementModel.deleteOne({ reference, direction, status: WalletMovementStatus.PENDING });
    }

    private async markApplied(reference: string, direction: WalletMovementDirection, fields: {
        amount: number; balanceBefore: number; balanceAfter: number; debtDelta?: number;
    }): Promise<void> {
        await WalletMovementModel.updateOne(
            { reference, direction, status: WalletMovementStatus.PENDING },
            { $set: { ...fields, status: WalletMovementStatus.APPLIED, appliedAt: new Date() } },
        );
    }

    /** Guarded atomic update with a known effect (spend, convert, transfers, plain $inc). */
    async applyInc(req: IncRequest): Promise<MovementOutcome> {
        if (!Number.isFinite(req.delta)) throw new Error('Wallet movement delta must be a finite number');
        const reference = req.reference || this.makeReference(req.source);
        const direction = req.delta < 0 ? WalletMovementDirection.DEBIT : WalletMovementDirection.CREDIT;
        const claim = await this.claim(req, direction, req.delta, reference);
        if (!claim.claimed) return claim.outcome;

        const field = balanceField(req.currency);
        let before: IUser | null;
        try {
            before = await UserModel.findOneAndUpdate(
                { _id: req.userId, ...(req.guard || {}) },
                { $inc: { [field]: req.delta, ...(req.extraInc || {}) } } as UpdateQuery<IUser>,
                { new: false },
            ).exec();
        } catch (err) {
            // The write may or may not have reached the server: keep the PENDING
            // claim so a replay refuses instead of moving the balance twice.
            log.error(`Wallet movement ${direction} ${reference}: update failed (${(err as Error).message}); PENDING row kept for review`);
            throw err;
        }
        if (!before) {
            await this.unclaim(reference, direction);
            const exists = await UserModel.exists({ _id: req.userId });
            return { applied: false, guardFailed: !!exists, userNotFound: !exists, reference, user: null };
        }
        const balanceBefore = Number((before as any)[field] ?? 0);
        const balanceAfter = round2(balanceBefore + req.delta);
        await this.markApplied(reference, direction, { amount: Math.abs(req.delta), balanceBefore, balanceAfter });
        const user = await UserModel.findById(req.userId).exec();
        return { applied: true, reference, user, balanceAfter };
    }

    /** Debt-aware change: compare-and-set on the fields the computation read. */
    async applyComputed(req: ComputedRequest): Promise<MovementOutcome> {
        const reference = req.reference || this.makeReference(req.source);
        const direction = req.requestedAmount < 0 ? WalletMovementDirection.DEBIT : WalletMovementDirection.CREDIT;
        const claim = await this.claim(req, direction, req.requestedAmount, reference);
        if (!claim.claimed) return claim.outcome;

        const field = balanceField(req.currency);
        try {
            for (let attempt = 0; attempt < 60; attempt++) {
                const current = await UserModel.findById(req.userId).exec();
                if (!current) {
                    await this.unclaim(reference, direction);
                    return { applied: false, userNotFound: true, reference, user: null };
                }
                const plan = req.compute(current);
                if (!plan) {
                    await this.unclaim(reference, direction);
                    return { applied: false, guardFailed: true, reference, user: current };
                }
                const raw = current.toObject() as any;
                const filter: Record<string, any> = { _id: current._id };
                // Every field the computation read must be unchanged (null also matches a missing field).
                filter[field] = raw[field] ?? null;
                filter.debt = raw.debt ?? null;
                const updated = await UserModel.findOneAndUpdate(filter, { $set: plan.set }, { new: true }).exec();
                if (!updated) {
                    await new Promise((r) => setTimeout(r, 2 + Math.floor(Math.random() * 15)));
                    continue;
                }
                const balanceBefore = Number(raw[field] ?? 0);
                const balanceAfter = Number((updated as any)[field] ?? 0);
                await this.markApplied(reference, direction, {
                    amount: Math.abs(round2(balanceAfter - balanceBefore)),
                    balanceBefore,
                    balanceAfter,
                    debtDelta: plan.debtDelta,
                });
                return { applied: true, reference, user: updated, balanceAfter };
            }
        } catch (err) {
            // Unknown whether the last write landed: keep the PENDING claim for review.
            log.error(`Wallet movement ${direction} ${reference}: error while applying (${(err as Error).message}); PENDING row kept for review`);
            throw err;
        }
        await this.unclaim(reference, direction);
        throw new Error(`Wallet movement ${reference}: balance kept changing, gave up after 60 attempts`);
    }

    /** Which of these references (any direction) have an APPLIED movement. */
    async findApplied(references: string[]): Promise<Array<{ reference: string; direction: string; amount: number; currency: string; appliedAt?: Date }>> {
        if (!references.length) return [];
        return WalletMovementModel.find({ reference: { $in: references }, status: WalletMovementStatus.APPLIED })
            .select('reference direction amount currency appliedAt -_id')
            .lean() as any;
    }
}

export const walletLedger = new WalletLedgerService();
export default walletLedger;
