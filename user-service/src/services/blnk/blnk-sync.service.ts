import { Types } from 'mongoose';
import UserModel from '../../database/models/user.model';
import WalletMovementModel, {
    IWalletMovement, WALLET_FIELDS, WalletCurrency, WalletMovementStatus, moneyCurrencyOf,
} from '../../database/models/wallet-movement.model';
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
export function counterpartFor(m: Pick<IWalletMovement, 'source' | 'reference' | 'direction'> & { currency?: string }): string {
    const s = `${m.source || ''}`.toLowerCase();
    const ref = `${m.reference || ''}`.toLowerCase();
    // The four extra balances (2026-11-23).
    if (m.currency === 'ACTIVATION') {
        return s.includes('leaderboard') ? '@LeaderboardBonus' : s.startsWith('admin-adjust') ? '@Adjustments' : '@Activation';
    }
    if (m.currency === 'ADVERTISING') return '@Advertising';
    if (m.currency === 'EVENT_ORGANIZER') return '@EventOrganizer';
    if (m.currency === 'SBC_LIVE') return '@SbcLive';
    if (s.startsWith('commission-reversal') || ref.startsWith('commission-reversal:')) return '@Commissions';
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
    // Main-balance side of the transfers out of the extra balances.
    if (s.startsWith('advertising')) return '@Advertising';
    if (s.startsWith('event-organizer')) return '@EventOrganizer';
    if (s.startsWith('sbc-live')) return '@SbcLive';
    return '@Unclassified';
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const memberRef = (m: Pick<IWalletMovement, 'reference' | 'direction'>) => `mv:${m.reference}:${m.direction}`;

async function state<T>(key: string): Promise<T | null> {
    const d = await BlnkStateModel.findById(key).lean();
    return (d?.value as T) ?? null;
}
const setState = (key: string, value: unknown) => BlnkStateModel.updateOne({ _id: key }, { $set: { value, at: new Date() } }, { upsert: true });

let ledgerInFlight: Promise<string> | null = null;
const LEDGER_CLAIM_WAIT_MS = 15_000;

/**
 * The members' ledger, created exactly once. Several callers can arrive
 * together (the openings script runs 10 at a time, the worker runs beside it):
 * one in-process promise per process, and across processes a claim document
 * (unique _id) that only one process wins; the others wait for its ledgerId.
 * The first version had neither and created 9 ledgers on preprod.
 */
export async function ensureLedger(): Promise<string> {
    const known = await state<string>('ledgerId');
    if (known) return known;
    if (!ledgerInFlight) {
        ledgerInFlight = createLedgerOnce().finally(() => { ledgerInFlight = null; });
    }
    return ledgerInFlight;
}

async function createLedgerOnce(): Promise<string> {
    let won = false;
    try {
        await BlnkStateModel.create({ _id: 'ledgerClaim', value: { pid: process.pid }, at: new Date() });
        won = true;
    } catch (err: any) {
        if (err?.code !== 11000) throw err;
    }
    if (won) {
        try {
            const l = await blnk.createLedger(blnkConfig().ledgerName, { app: 'sbc', purpose: 'member wallets (Security plan Phase 2)' });
            await setState('ledgerId', l.ledger_id);
            return l.ledger_id;
        } catch (err) {
            // Let another attempt claim it again.
            await BlnkStateModel.deleteOne({ _id: 'ledgerClaim' });
            throw err;
        }
    }
    const until = Date.now() + LEDGER_CLAIM_WAIT_MS;
    while (Date.now() < until) {
        const id = await state<string>('ledgerId');
        if (id) return id;
        await new Promise(res => setTimeout(res, 200));
    }
    throw new BlnkError(null, 'LEDGER_PENDING', 'The ledger is being created by another process; try again.');
}

/**
 * The member's Blnk balance for a currency, created on first use, with the
 * opening balance posted from @OpeningBalances (reference
 * `opening:<userId>:<currency>`, so it is posted once).
 */
export async function ensureMemberBalance(userId: Types.ObjectId, currency: WalletCurrency): Promise<{ balanceId: string }> {
    let row = await BlnkBalanceModel.findOne({ userId, currency }).lean();
    if (!row) {
        const ledgerId = await ensureLedger();
        // One Blnk balance per journalled balance; the four extra ones hold XAF.
        const b = await blnk.createBalance(ledgerId, moneyCurrencyOf(currency), { userId: String(userId), wallet: currency });
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
                    amount: Math.abs(amount), reference, currency: moneyCurrencyOf(currency), description: 'Solde d’ouverture (instantané)',
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

/**
 * Where the opening snapshot of a balance stands (scripts/snapshot-opening-balances.ts --apply
 * writes `openingSnapshot:<balance>` = {startedAt, doneAt}). XAF and USD were snapshotted before
 * this state existed (2026-11-21): done.
 */
export async function openingSnapshotState(currency: WalletCurrency): Promise<'none' | 'running' | 'done'> {
    if (currency === 'XAF' || currency === 'USD') return 'done';
    const v = await state<{ startedAt?: string; doneAt?: string }>(`openingSnapshot:${currency}`);
    return !v?.startedAt ? 'none' : v.doneAt ? 'done' : 'running';
}
export const markOpeningSnapshot = (currency: WalletCurrency, field: 'startedAt' | 'doneAt') =>
    BlnkStateModel.updateOne(
        { _id: `openingSnapshot:${currency}` },
        field === 'startedAt'
            ? { $set: { 'value.startedAt': new Date().toISOString(), at: new Date() }, $unset: { 'value.doneAt': '' } }
            : { $set: { 'value.doneAt': new Date().toISOString(), at: new Date() } },
        { upsert: true },
    );

/** Posts one movement. Returns 'stop' when Blnk is unreachable or an opening snapshot is running (retry later, nothing skipped). */
async function syncOne(m: IWalletMovement): Promise<BlnkSyncStatus | 'stop' | 'wait_opening'> {
    if (await BlnkSyncModel.exists({ movementId: m._id })) return 'synced';
    const opening = await WalletOpeningBalanceModel.findOne({ userId: m.userId, currency: m.currency }, { snapshotAt: 1 }).lean();
    if (opening && m.appliedAt && new Date(m.appliedAt) <= new Date(opening.snapshotAt)) {
        await record(m, 'skipped_in_opening');
        return 'skipped_in_opening';
    }
    if (!opening) {
        // A balance journalled before its first opening snapshot (the four extra balances were
        // added 2026-11-23 while the worker was running): until the snapshot starts, every movement
        // will be inside the member's opening; while it runs, we cannot tell yet, so wait.
        const snap = await openingSnapshotState(m.currency);
        if (snap === 'none') { await record(m, 'skipped_in_opening'); return 'skipped_in_opening'; }
        if (snap === 'running') return 'wait_opening';
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
            amount: round2(m.amount), reference, currency: moneyCurrencyOf(m.currency), description: (m.description || m.source || '').slice(0, 200),
            source: credit ? counterpart : balanceId, destination: credit ? balanceId : counterpart,
            // The member's balance never goes below 0 in Blnk; the internal accounts may. Exception:
            // the event-organiser balance, which a resale refund may take below zero on purpose
            // (user.repository applyEventOrganizerMovement), so Blnk must follow it there.
            allow_overdraft: credit || m.currency === 'EVENT_ORGANIZER', skip_queue: true,
            meta_data: { userId: String(m.userId), movementId: String(m._id), source: m.source, reference: m.reference },
        });
        await record(m, 'synced', { txId: tx.transaction_id, counterpart });
        return 'synced';
    } catch (caught) {
        if (!(caught instanceof BlnkError)) throw caught;
        let err: BlnkError = caught;
        if (err.retryable) return 'stop';
        if (err.code === 'TXN_DUPLICATE_REFERENCE') {
            // Our own earlier post (a replay): synced. A transaction under this reference that
            // does not touch this member's balance is a collision, never counted as synced.
            const t = await blnk.byReference(reference).catch(() => null);
            const { balanceId } = await ensureMemberBalance(m.userId, m.currency);
            if (t && (t.source === balanceId || t.destination === balanceId)) {
                await record(m, 'synced', { txId: t.transaction_id, counterpart });
                return 'synced';
            }
            err = new BlnkError(409, 'REFERENCE_COLLISION', `reference ${reference} already used by another balance`);
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
            if (r === 'wait_opening') { out.stopped = 'opening_snapshot_running'; break; }
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
async function pendingFor(userId: Types.ObjectId, currency: WalletCurrency): Promise<number> {
    const cursor = await state<string>('cursor');
    return WalletMovementModel.countDocuments({ userId, currency, ...(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}) });
}

export interface TripleCheck {
    userId: string; currency: WalletCurrency;
    a: number; b: number | null; c: number | null; cInflight: number | null;
    pendingSync: number; agree: boolean; reason: string | null;
}

/** Tolerance of the plan: 1 XAF (0.01 for USD). */
const tolerance = (currency: string) => (currency === 'USD' ? 0.01 : 1);

/**
 * A, B and C for one member and currency (withdrawal pre-check and nightly
 * shadow comparison). Read-only: never creates a Blnk balance.
 */
export async function tripleCheck(userIdIn: string, currency: WalletCurrency = 'XAF'): Promise<TripleCheck> {
    const userId = new Types.ObjectId(userIdIn);
    const [user, opening, net, row, pending] = await Promise.all([
        UserModel.findById(userId).select(WALLET_FIELDS[currency]).lean(),
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
    const a = round2(Number((user as any)?.[WALLET_FIELDS[currency]] ?? 0));
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
