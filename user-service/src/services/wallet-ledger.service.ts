import { FilterQuery, Types, UpdateQuery } from 'mongoose';
import UserModel, { IUser } from '../database/models/user.model';
import WalletMovementModel, {
    WALLET_FIELDS,
    WALLET_REF_PREFIX,
    WalletCurrency,
    WalletMovementDirection,
    WalletMovementStatus,
} from '../database/models/wallet-movement.model';
import logger from '../utils/logger';

const log = logger.getLogger('WalletLedger');

/**
 * Every change of a journalled balance (users.balance, usdBalance, and since
 * 2026-11-23 activation, advertising, event organiser and SBC Live) goes through
 * here, so that each one leaves exactly one walletmovements row per balance.
 * A write that moves two balances at once (main → activation) passes the second
 * one as a `leg`: same atomic update, one row each.
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
    /** Replay of a movement that was later undone (same reference, opposite direction): nothing moved. */
    reversed?: boolean;
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
    /** Extra $inc fields applied in the same write (reservedBalance...). Never a journalled balance: use `legs`. */
    extraInc?: Record<string, number>;
    /**
     * Other journalled balances moved by the same write (transfer main ↔ activation /
     * advertising / event organiser). Each leg gets its own movement row under
     * `<its prefix><base reference>`.
     */
    legs?: Array<{ currency: WalletCurrency; delta: number; source?: string; description?: string }>;
}

/**
 * A change computed from the current document (debt settlement): applied by
 * compare-and-set on balance+debt, retried on a concurrent change.
 */
export interface ComputedRequest extends BaseRequest {
    requestedAmount: number;
    compute: (user: IUser) => { set: Record<string, number>; balanceDelta: number; debtDelta: number } | null;
}

const balanceField = (currency: WalletCurrency) => {
    const f = WALLET_FIELDS[currency];
    if (!f) throw new Error(`Unknown wallet balance ${currency}`);
    return f;
};
/** The stored reference: the balance's namespace + the business reference. */
export const ledgerReference = (currency: WalletCurrency, reference: string) => {
    const prefix = WALLET_REF_PREFIX[currency] ?? '';
    return prefix && !reference.startsWith(prefix) ? `${prefix}${reference}` : reference;
};
const JOURNALLED_FIELDS = new Set(Object.values(WALLET_FIELDS));
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
            // Undone since (same reference, opposite direction): a replay must not pass for the original.
            const opposite = direction === WalletMovementDirection.DEBIT ? WalletMovementDirection.CREDIT : WalletMovementDirection.DEBIT;
            const undone = await WalletMovementModel.exists({ reference, direction: opposite, status: WalletMovementStatus.APPLIED });
            if (undone) {
                log.warn(`Wallet movement ${direction} ${reference} was undone: replay refused`);
                return { claimed: false, outcome: { applied: false, alreadyApplied: true, reversed: true, reference, user } };
            }
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
        const legs = req.legs || [];
        for (const leg of legs) {
            if (!Number.isFinite(leg.delta) || leg.delta === 0) throw new Error('Wallet movement leg delta must be a non-zero finite number');
            if (leg.currency === req.currency || legs.filter((l) => l.currency === leg.currency).length > 1) {
                throw new Error(`Wallet movement leg ${leg.currency} repeats a balance of the same write`);
            }
        }
        for (const f of Object.keys(req.extraInc || {})) {
            if (JOURNALLED_FIELDS.has(f)) throw new Error(`Wallet movement: ${f} is a journalled balance, pass it as a leg`);
        }
        const base = req.reference || this.makeReference(req.source);
        const reference = ledgerReference(req.currency, base);
        const direction = req.delta < 0 ? WalletMovementDirection.DEBIT : WalletMovementDirection.CREDIT;
        const claim = await this.claim({ ...req, reference }, direction, req.delta, reference);
        if (!claim.claimed) return claim.outcome;

        // Each leg is claimed under its own namespace. The base claim above is the
        // idempotency key; a leg already present means a crash left half a write.
        const claimedLegs: Array<{ currency: WalletCurrency; delta: number; reference: string; direction: WalletMovementDirection }> = [];
        for (const leg of legs) {
            const legRef = ledgerReference(leg.currency, base);
            const legDir = leg.delta < 0 ? WalletMovementDirection.DEBIT : WalletMovementDirection.CREDIT;
            try {
                await WalletMovementModel.create({
                    reference: legRef, direction: legDir, userId: new Types.ObjectId(req.userId.toString()), currency: leg.currency,
                    amount: 0, requestedAmount: leg.delta, source: leg.source || req.source, description: leg.description || req.description,
                    status: WalletMovementStatus.PENDING,
                });
            } catch (err) {
                for (const c of claimedLegs) await this.unclaim(c.reference, c.direction);
                await this.unclaim(reference, direction);
                if (isDuplicate(err)) {
                    log.error(`Wallet movement leg ${legDir} ${legRef} already exists while its base ${reference} was free: refused`);
                    return { applied: false, pendingConflict: true, reference, user: await UserModel.findById(req.userId).exec() };
                }
                throw err;
            }
            claimedLegs.push({ currency: leg.currency, delta: leg.delta, reference: legRef, direction: legDir });
        }

        const field = balanceField(req.currency);
        const inc: Record<string, number> = { [field]: req.delta, ...(req.extraInc || {}) };
        for (const leg of claimedLegs) inc[balanceField(leg.currency)] = leg.delta;
        let before: IUser | null;
        try {
            before = await UserModel.findOneAndUpdate(
                { _id: req.userId, ...(req.guard || {}) },
                { $inc: inc } as UpdateQuery<IUser>,
                { new: false },
            ).exec();
        } catch (err) {
            // The write may or may not have reached the server: keep the PENDING
            // claims so a replay refuses instead of moving the balance twice.
            log.error(`Wallet movement ${direction} ${reference}: update failed (${(err as Error).message}); PENDING row kept for review`);
            throw err;
        }
        if (!before) {
            for (const c of claimedLegs) await this.unclaim(c.reference, c.direction);
            await this.unclaim(reference, direction);
            const exists = await UserModel.exists({ _id: req.userId });
            return { applied: false, guardFailed: !!exists, userNotFound: !exists, reference, user: null };
        }
        const balanceBefore = Number((before as any)[field] ?? 0);
        const balanceAfter = round2(balanceBefore + req.delta);
        await this.markApplied(reference, direction, { amount: Math.abs(req.delta), balanceBefore, balanceAfter });
        for (const c of claimedLegs) {
            const legBefore = Number((before as any)[balanceField(c.currency)] ?? 0);
            await this.markApplied(c.reference, c.direction, { amount: Math.abs(c.delta), balanceBefore: legBefore, balanceAfter: round2(legBefore + c.delta) });
        }
        const user = await UserModel.findById(req.userId).exec();
        return { applied: true, reference, user, balanceAfter };
    }

    /** Debt-aware change: compare-and-set on the fields the computation read. */
    async applyComputed(req: ComputedRequest): Promise<MovementOutcome> {
        if (req.currency !== 'XAF' && req.currency !== 'USD') throw new Error('Debt-aware movements exist for XAF and USD only');
        const reference = req.reference || this.makeReference(req.source);
        const direction = req.requestedAmount < 0 ? WalletMovementDirection.DEBIT : WalletMovementDirection.CREDIT;
        const claim = await this.claim(req, direction, req.requestedAmount, reference);
        if (!claim.claimed) return claim.outcome;

        const field = balanceField(req.currency);
        try {
            for (let attempt = 0; attempt < 60; attempt++) {
                // Raw document (no schema defaults): a missing field must be compared as missing.
                const raw = await UserModel.findById(req.userId).lean() as any;
                if (!raw) {
                    await this.unclaim(reference, direction);
                    return { applied: false, userNotFound: true, reference, user: null };
                }
                const plan = req.compute(raw as IUser);
                if (!plan) {
                    await this.unclaim(reference, direction);
                    return { applied: false, guardFailed: true, reference, user: await UserModel.findById(req.userId).exec() };
                }
                const filter: Record<string, any> = { _id: raw._id };
                // Every field the computation read must be unchanged (null also matches a missing field).
                filter[field] = raw[field] ?? null;
                filter.debt = raw.debt ?? null;
                filter[req.currency === 'USD' ? 'reservedUsdBalance' : 'reservedBalance'] =
                    raw[req.currency === 'USD' ? 'reservedUsdBalance' : 'reservedBalance'] ?? null;
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
