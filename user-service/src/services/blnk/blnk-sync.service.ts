import { Types } from 'mongoose';
import UserModel from '../../database/models/user.model';
import WalletMovementModel, { IWalletMovement, WalletMovementStatus } from '../../database/models/wallet-movement.model';
import WalletOpeningBalanceModel from '../../database/models/wallet-opening-balance.model';
import { BlnkBalanceModel, BlnkStateModel, BlnkSyncModel, BlnkSyncStatus } from '../../database/models/blnk.model';
import { blnk, BlnkError, blnkConfig, blnkEnabled, PRECISION } from './blnk.client';
import { openSupportCase } from '../clients/support.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('BlnkSync');

/**
 * Security plan Phase 2: the wallet journal (walletmovements, written with every
 * change of users.balance / usdBalance) is posted to Blnk, a second ledger that
 * nothing else writes to. Three balances can then be compared:
 *   A = users.balance, B = opening snapshot + Σ movements, C = Blnk.
 *
 * Outbox rules:
 *   - movements are read in _id order from a cursor (blnk_state 'cursor');
 *   - each one is posted once: Blnk reference `mv:<reference>:<direction>` is
 *     unique, so a replay is refused (409) and recorded as synced;
 *   - a movement already inside the member's opening snapshot is skipped, so is a
 *     credit that only paid debt (amount 0);
 *   - a member's opening balance is posted from @OpeningBalances before their
 *     first movement;
 *   - Blnk down or a 5xx stops the batch (nothing is skipped, the cursor waits);
 *     a refusal (insufficient funds in Blnk, bad input) is recorded `rejected`
 *     and opens a ledger_mismatch case: C now differs from A.
 * Every call is immediate (skip_queue): with Blnk's queue a later debit could
 * be refused while an earlier credit is still waiting.
 */

const STUCK_PENDING_MS = 15 * 60 * 1000;
export const LAG_ALERT_MS = 5 * 60 * 1000;

/** Internal Blnk balance on the other side of each movement (plan: @Commissions, @Fees, …). */
export function counterpartFor(m: Pick<IWalletMovement, 'source' | 'reference' | 'direction'>): string {
    const s = `${m.source || ''}`.toLowerCase();
    const ref = `${m.reference || ''}`.toLowerCase();
    if (s === 'commission') return '@Commissions';
    if (s === 'deposit') return '@Deposits';
    if (s.startsWith('withdrawal') || s.includes('payout') || s.startsWith('support-regularize') || s.startsWith('admin-manual-complete')
        || s.startsWith('admin-reconcile') || s === 'feexpay-status-check' || ref.startsWith('withdrawal:')) return '@Withdrawals';
    if (s.startsWith('balance-spend') || s === 'balance-refund' || ref.startsWith('spend:') || ref.startsWith('balance-refund:') || s.includes('relance')) return '@Purchases';
    if (s.startsWith('member-transfer')) return '@Transfers';
    if (s === 'conversion' || ref.startsWith('conversion:')) return '@Conversions';
    if (s.startsWith('admin-adjust')) return '@Adjustments';
    if (s.includes('leaderboard')) return '@LeaderboardBonus';
    if (s.includes('activation')) return '@Activation';
    return '@Unclassified';
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const memberRef = (m: Pick<IWalletMovement, 'reference' | 'direction'>) => `mv:${m.reference}:${m.direction}`;

async function state<T>(key: string): Promise<T | null> {
    const d = await BlnkStateModel.findById(key).lean();
    return (d?.value as T) ?? null;
}
const setState = (key: string, value: unknown) => BlnkStateModel.updateOne({ _id: key }, { $set: { value, at: new Date() } }, { upsert: true });

/** The members' ledger, created once. */
export async function ensureLedger(): Promise<string> {
    const known = await state<string>('ledgerId');
    if (known) return known;
    const l = await blnk.createLedger(blnkConfig().ledgerName, { app: 'sbc', purpose: 'member wallets (Security plan Phase 2)' });
    await setState('ledgerId', l.ledger_id);
    return l.ledger_id;
}

/**
 * The member's Blnk balance for a currency, created on first use, with the
 * opening balance posted from @OpeningBalances (reference
 * `opening:<userId>:<currency>`, so it is posted once).
 */
export async function ensureMemberBalance(userId: Types.ObjectId, currency: 'XAF' | 'USD'): Promise<{ balanceId: string }> {
    let row = await BlnkBalanceModel.findOne({ userId, currency }).lean();
    if (!row) {
        const ledgerId = await ensureLedger();
        const b = await blnk.createBalance(ledgerId, currency, { userId: String(userId) });
        try {
            row = (await BlnkBalanceModel.create({ userId, currency, balanceId: b.balance_id })).toObject();
        } catch (err: any) {
            if (err?.code !== 11000) throw err;
            row = await BlnkBalanceModel.findOne({ userId, currency }).lean(); // created meanwhile: the extra Blnk balance stays empty
        }
    }
    if (!row!.openingPosted) {
        const opening = await WalletOpeningBalanceModel.findOne({ userId, currency }).lean();
        const amount = round2(Number(opening?.amount ?? 0));
        if (amount !== 0) {
            const reference = `opening:${userId}:${currency}`;
            try {
                await blnk.post({
                    amount: Math.abs(amount), reference, currency, description: 'Solde d’ouverture (instantané)',
                    source: amount > 0 ? '@OpeningBalances' : row!.balanceId, destination: amount > 0 ? row!.balanceId : '@OpeningBalances',
                    allow_overdraft: true, skip_queue: true, meta_data: { userId: String(userId), kind: 'opening', snapshotAt: opening?.snapshotAt },
                });
            } catch (err) {
                if (!(err instanceof BlnkError && err.code === 'TXN_DUPLICATE_REFERENCE')) throw err;
            }
        }
        await BlnkBalanceModel.updateOne({ userId, currency }, { $set: { openingPosted: true } });
    }
    return { balanceId: row!.balanceId };
}

async function record(m: IWalletMovement, status: BlnkSyncStatus, extra: { txId?: string | null; error?: string | null; counterpart?: string | null } = {}) {
    await BlnkSyncModel.updateOne(
        { movementId: m._id },
        { $setOnInsert: {
            movementId: m._id, userId: m.userId, currency: m.currency, reference: m.reference, direction: m.direction,
            amount: m.amount, status, txId: extra.txId ?? null, error: extra.error ?? null, counterpart: extra.counterpart ?? null, at: new Date(),
        } },
        { upsert: true },
    );
}

/** Posts one movement. Returns 'stop' when Blnk is unreachable (retry later, nothing skipped). */
async function syncOne(m: IWalletMovement): Promise<BlnkSyncStatus | 'stop'> {
    if (await BlnkSyncModel.exists({ movementId: m._id })) return 'synced';
    const opening = await WalletOpeningBalanceModel.findOne({ userId: m.userId, currency: m.currency }, { snapshotAt: 1 }).lean();
    if (opening && m.appliedAt && new Date(m.appliedAt) <= new Date(opening.snapshotAt)) {
        await record(m, 'skipped_in_opening');
        return 'skipped_in_opening';
    }
    if (!(m.amount > 0)) {
        await record(m, 'skipped_zero');
        return 'skipped_zero';
    }
    const counterpart = counterpartFor(m);
    const reference = memberRef(m);
    try {
        const { balanceId } = await ensureMemberBalance(m.userId, m.currency);
        const credit = m.direction === 'CREDIT';
        const tx = await blnk.post({
            amount: round2(m.amount), reference, currency: m.currency, description: (m.description || m.source || '').slice(0, 200),
            source: credit ? counterpart : balanceId, destination: credit ? balanceId : counterpart,
            // The member's balance never goes below 0 in Blnk; the internal accounts may.
            allow_overdraft: credit, skip_queue: true,
            meta_data: { userId: String(m.userId), movementId: String(m._id), source: m.source, reference: m.reference },
        });
        await record(m, 'synced', { txId: tx.transaction_id, counterpart });
        return 'synced';
    } catch (err) {
        if (!(err instanceof BlnkError)) throw err;
        if (err.retryable) return 'stop';
        if (err.code === 'TXN_DUPLICATE_REFERENCE') {
            const t = await blnk.byReference(reference).catch(() => null);
            await record(m, 'synced', { txId: t?.transaction_id ?? null, counterpart });
            return 'synced';
        }
        await record(m, 'rejected', { error: `${err.code}: ${err.message}`, counterpart });
        void openSupportCase({
            type: 'ledger_mismatch', dedupKey: `blnk:rejected:${m._id}`, severity: 'critical',
            subject: { userId: String(m.userId) },
            summary: `Le second registre (Blnk) a refusé un mouvement que MongoDB a appliqué (${m.direction} ${m.amount} ${m.currency}, ${m.reference}) : ${err.code}.`,
            details: { movementId: String(m._id), reference: m.reference, direction: m.direction, amount: m.amount, code: err.code },
        });
        return 'rejected';
    }
}

/** One pass: up to `limit` movements after the cursor, in order. */
export async function syncBatch(limit = 200, now: Date = new Date()) {
    const out = { processed: 0, synced: 0, skipped: 0, rejected: 0, stopped: null as string | null };
    if (!blnkEnabled()) return { ...out, stopped: 'disabled' };
    const cursor = await state<string>('cursor');
    const filter: Record<string, unknown> = cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {};
    const rows = await WalletMovementModel.find(filter).sort({ _id: 1 }).limit(limit).lean<IWalletMovement[]>();
    for (const m of rows) {
        if (m.status === WalletMovementStatus.PENDING) {
            // A claim normally resolves in milliseconds: wait for it, unless it is a crash leftover.
            if (now.getTime() - new Date(m.createdAt).getTime() < STUCK_PENDING_MS) { out.stopped = 'pending'; break; }
            await record(m, 'skipped_stuck_pending');
            out.skipped++;
        } else {
            const r = await syncOne(m);
            if (r === 'stop') { out.stopped = 'blnk_unavailable'; break; }
            if (r === 'synced') out.synced++;
            else if (r === 'rejected') out.rejected++;
            else out.skipped++;
        }
        out.processed++;
        await setState('cursor', String(m._id));
    }
    return out;
}

/** Age (ms) of the oldest APPLIED movement not yet posted, 0 when caught up. */
export async function syncLagMs(now: Date = new Date()): Promise<number> {
    const cursor = await state<string>('cursor');
    const first = await WalletMovementModel.findOne({ ...(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}), status: WalletMovementStatus.APPLIED })
        .sort({ _id: 1 }).select('appliedAt createdAt').lean();
    if (!first) return 0;
    return Math.max(0, now.getTime() - new Date(first.appliedAt ?? first.createdAt).getTime());
}

/** Movements of this member not posted to Blnk yet (after the cursor). */
async function pendingFor(userId: Types.ObjectId, currency: 'XAF' | 'USD'): Promise<number> {
    const cursor = await state<string>('cursor');
    return WalletMovementModel.countDocuments({ userId, currency, ...(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}) });
}

export interface TripleCheck {
    userId: string; currency: 'XAF' | 'USD';
    a: number; b: number | null; c: number | null; cInflight: number | null;
    pendingSync: number; agree: boolean; reason: string | null;
}

/** Tolerance of the plan: 1 XAF (0.01 for USD). */
const tolerance = (currency: string) => (currency === 'USD' ? 0.01 : 1);

/**
 * A, B and C for one member and currency (withdrawal pre-check and nightly
 * shadow comparison). Read-only: never creates a Blnk balance.
 */
export async function tripleCheck(userIdIn: string, currency: 'XAF' | 'USD' = 'XAF'): Promise<TripleCheck> {
    const userId = new Types.ObjectId(userIdIn);
    const [user, opening, net, row, pending] = await Promise.all([
        UserModel.findById(userId).select('balance usdBalance').lean(),
        WalletOpeningBalanceModel.findOne({ userId, currency }).lean(),
        WalletMovementModel.aggregate([
            { $match: { userId, currency, status: WalletMovementStatus.APPLIED } },
            { $lookup: { from: WalletOpeningBalanceModel.collection.name, let: { u: '$userId', c: '$currency' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$userId', '$$u'] }, { $eq: ['$currency', '$$c'] }] } } }], as: 'o' } },
            { $match: { $expr: { $or: [{ $eq: [{ $size: '$o' }, 0] }, { $gt: ['$appliedAt', { $first: '$o.snapshotAt' }] }] } } },
            { $group: { _id: null, net: { $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
        ]),
        BlnkBalanceModel.findOne({ userId, currency }).lean(),
        pendingFor(userId, currency),
    ]);
    const a = round2(Number((currency === 'USD' ? (user as any)?.usdBalance : (user as any)?.balance) ?? 0));
    const b = round2(Number(opening?.amount ?? 0) + Number(net[0]?.net ?? 0));
    let c: number | null = null;
    let cInflight: number | null = null;
    if (row) {
        const bal = await blnk.getBalance(row.balanceId);
        c = round2(bal.balance / PRECISION);
        cInflight = round2(bal.inflight_balance / PRECISION);
    }
    const t = tolerance(currency);
    let reason: string | null = null;
    if (pending > 0) reason = 'sync_pending';
    else if (c === null) reason = a === 0 && b === 0 ? null : 'not_in_ledger';
    else if (Math.abs(a - b) > t) reason = 'a_differs_from_b';
    else if (Math.abs(a - (c - (cInflight ?? 0))) > t && Math.abs(a - c) > t) reason = 'a_differs_from_c';
    return { userId: userIdIn, currency, a, b, c, cInflight, pendingSync: pending, agree: reason === null, reason };
}

/**
 * Nightly shadow comparison (plan: 14 consecutive clean nights before
 * enforcement): every member with a Blnk balance, by _id, in batches with a
 * pause. Each disagreement (pending syncs aside) opens a ledger_mismatch case
 * with A, B and C. Returns the differences.
 */
export async function shadowCompare(opts: { batch?: number; pauseMs?: number; deadline?: Date } = {}) {
    const batch = opts.batch ?? 1000;
    const found: TripleCheck[] = [];
    let checked = 0;
    let last: Types.ObjectId | null = null;
    for (;;) {
        if (opts.deadline && new Date() > opts.deadline) { log.warn(`Shadow comparison stopped at its deadline after ${checked} balance(s)`); break; }
        const rows: any[] = await BlnkBalanceModel.find(last ? { _id: { $gt: last } } : {}).sort({ _id: 1 }).limit(batch).lean();
        if (!rows.length) break;
        for (const r of rows) {
            const t = await tripleCheck(String(r.userId), r.currency);
            checked++;
            if (!t.agree && t.reason !== 'sync_pending') {
                found.push(t);
                void openSupportCase({
                    type: 'ledger_mismatch', dedupKey: `blnk:shadow:${t.userId}:${t.currency}:${t.a}:${t.b}:${t.c}`, severity: 'critical',
                    subject: { userId: t.userId },
                    summary: `Les trois soldes ne concordent pas (${t.currency}) : A ${t.a}, B ${t.b}, C ${t.c ?? '—'} (${t.reason}).`,
                    details: { ...t },
                });
            }
        }
        last = rows[rows.length - 1]._id;
        if (opts.pauseMs) await new Promise(res => setTimeout(res, opts.pauseMs));
    }
    log.info(`Shadow comparison: ${checked} balance(s) checked, ${found.length} difference(s)`);
    await setState('lastShadow', { at: new Date(), checked, differences: found.length });
    return { checked, differences: found };
}
