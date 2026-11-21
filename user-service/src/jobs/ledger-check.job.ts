import cron, { type ScheduledTask } from 'node-cron';
import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import WalletMovementModel, { WalletMovementStatus } from '../database/models/wallet-movement.model';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';
import BalanceReservationModel, { ReservationState } from '../database/models/balance-reservation.model';
import { openSupportCase } from '../services/clients/support.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('LedgerCheck');

const TOLERANCE = 0.01;
const BATCH = 300;
const STALE_PENDING_MS = 15 * 60 * 1000;

export interface LedgerFinding {
    kind: 'balance' | 'pending_movement' | 'reserved';
    userId: string;
    currency: 'XAF' | 'USD';
    expected?: number;
    actual?: number;
    reference?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Σ signed APPLIED movements after each user's snapshot, per {userId, currency}. */
async function netSinceSnapshot(userIds: Types.ObjectId[]): Promise<Map<string, number>> {
    const rows = await WalletMovementModel.aggregate([
        { $match: { userId: { $in: userIds }, status: WalletMovementStatus.APPLIED } },
        {
            $lookup: {
                from: WalletOpeningBalanceModel.collection.name,
                let: { u: '$userId', c: '$currency' },
                pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$userId', '$$u'] }, { $eq: ['$currency', '$$c'] }] } } }],
                as: 'o',
            },
        },
        { $unwind: '$o' },
        { $match: { $expr: { $gt: ['$appliedAt', '$o.snapshotAt'] } } },
        {
            $group: {
                _id: { u: '$userId', c: '$currency' },
                net: { $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', { $multiply: ['$amount', -1] }] } },
            },
        },
    ]);
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r._id.u}:${r._id.c}`, r.net);
    return map;
}

async function balanceFindings(): Promise<LedgerFinding[]> {
    const found: LedgerFinding[] = [];
    const cursor = WalletOpeningBalanceModel.find({}).sort({ userId: 1 }).lean().cursor();
    let batch: any[] = [];
    const flush = async () => {
        if (!batch.length) return;
        const ids = [...new Set(batch.map((o) => o.userId.toString()))].map((id) => new Types.ObjectId(id));
        const check = async () => {
            const net = await netSinceSnapshot(ids);
            const users = await UserModel.find({ _id: { $in: ids } }).select('balance usdBalance').lean();
            const byId = new Map(users.map((u: any) => [u._id.toString(), u]));
            const out: LedgerFinding[] = [];
            for (const o of batch) {
                const u: any = byId.get(o.userId.toString());
                if (!u) continue;
                const actual = Number((o.currency === 'USD' ? u.usdBalance : u.balance) ?? 0);
                const expected = round2(o.amount + (net.get(`${o.userId}:${o.currency}`) ?? 0));
                if (Math.abs(actual - expected) > TOLERANCE) {
                    out.push({ kind: 'balance', userId: o.userId.toString(), currency: o.currency, expected, actual: round2(actual) });
                }
            }
            return out;
        };
        const first = await check();
        if (first.length) {
            // A movement may have landed between the sum and the balance read: look again once.
            await new Promise((r) => setTimeout(r, 2000));
            const again = await check();
            const keys = new Set(first.map((f) => `${f.userId}:${f.currency}`));
            found.push(...again.filter((f) => keys.has(`${f.userId}:${f.currency}`)));
        }
        batch = [];
    };
    for await (const o of cursor) {
        batch.push(o);
        if (batch.length >= BATCH) await flush();
    }
    await flush();
    return found;
}

async function pendingFindings(now: Date): Promise<LedgerFinding[]> {
    const rows = await WalletMovementModel.find({
        status: WalletMovementStatus.PENDING, createdAt: { $lt: new Date(now.getTime() - STALE_PENDING_MS) },
    }).select('userId currency reference').limit(500).lean();
    return rows.map((r: any) => ({ kind: 'pending_movement' as const, userId: r.userId.toString(), currency: r.currency, reference: r.reference }));
}

/** users.reservedBalance must equal Σ reservations still holding money (reserving/held/converting). */
async function reservedFindings(): Promise<LedgerFinding[]> {
    const holding = [ReservationState.RESERVING, ReservationState.HELD, ReservationState.CONVERTING];
    const sums = await BalanceReservationModel.aggregate([
        { $match: { state: { $in: holding } } },
        { $group: { _id: { u: '$userId', c: '$currency' }, total: { $sum: '$amount' } } },
    ]);
    const expected = new Map<string, number>(sums.map((s: any) => [`${s._id.u}:${s._id.c}`, s.total]));
    const users = await UserModel.find({
        $or: [{ reservedBalance: { $nin: [0, null] } }, { reservedUsdBalance: { $nin: [0, null] } },
            { _id: { $in: sums.map((s: any) => s._id.u) } }],
    }).select('reservedBalance reservedUsdBalance').lean();
    const found: LedgerFinding[] = [];
    for (const u of users as any[]) {
        for (const currency of ['XAF', 'USD'] as const) {
            const actual = Number((currency === 'USD' ? u.reservedUsdBalance : u.reservedBalance) ?? 0);
            const exp = round2(expected.get(`${u._id}:${currency}`) ?? 0);
            if (Math.abs(actual - exp) > TOLERANCE) found.push({ kind: 'reserved', userId: u._id.toString(), currency, expected: exp, actual: round2(actual) });
        }
    }
    return found;
}

/**
 * Nightly: opening balance + movements = balance; no movement stuck PENDING;
 * reservedBalance = Σ held reservations. Each finding becomes a
 * `ledger_mismatch` case (dedupKey carries the numbers, so a changed gap is a
 * new case and an unchanged one is not reported twice). Read-only.
 */
export async function runLedgerCheck(now: Date = new Date()): Promise<LedgerFinding[]> {
    const findings = [...await balanceFindings(), ...await pendingFindings(now), ...await reservedFindings()];
    for (const f of findings) {
        const dedupKey = f.kind === 'pending_movement'
            ? `ledger:pending:${f.reference}`
            : `ledger:${f.kind}:${f.userId}:${f.currency}:${f.expected}:${f.actual}`;
        const summary = f.kind === 'pending_movement'
            ? `Mouvement de solde resté en attente (${f.reference}) : vérifier si le solde a bougé.`
            : f.kind === 'reserved'
                ? `Montant réservé incohérent (${f.currency}) : attendu ${f.expected}, trouvé ${f.actual}.`
                : `Écart de solde (${f.currency}) : registre ${f.expected}, solde ${f.actual}.`;
        await openSupportCase({
            type: 'ledger_mismatch',
            dedupKey,
            severity: f.kind === 'balance' ? 'critical' : 'warning',
            subject: { userId: f.userId },
            summary,
            details: { ...f },
        });
    }
    log.info(`Ledger check: ${findings.length} finding(s)`);
    return findings;
}

class LedgerCheckJob {
    private task: ScheduledTask | null = null;
    private running = false;

    start(): void {
        if (process.env.LEDGER_CHECK_DISABLED === 'true') {
            log.warn('Ledger check disabled (LEDGER_CHECK_DISABLED=true)');
            return;
        }
        this.task = cron.schedule('30 3 * * *', async () => {
            if (this.running) return;
            this.running = true;
            try {
                await runLedgerCheck();
            } catch (err: any) {
                log.error(`Ledger check failed: ${err?.message ?? err}`);
            } finally {
                this.running = false;
            }
        }, { timezone: 'Africa/Douala' });
        log.info('Ledger check scheduled (03:30 Africa/Douala)');
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const ledgerCheckJob = new LedgerCheckJob();

/**
 * Security plan Phase 5 (support member card): balance A (users.balance /
 * usdBalance) against balance B (opening snapshot + APPLIED movements since),
 * per currency. A member without an opening snapshot gets no entry.
 */
export async function ledgerBalances(userIdsIn: string[]): Promise<Map<string, { currency: 'XAF' | 'USD'; actual: number; expected: number; matches: boolean }[]>> {
    const ids = userIdsIn.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const out = new Map<string, { currency: 'XAF' | 'USD'; actual: number; expected: number; matches: boolean }[]>();
    if (!ids.length) return out;
    const [openings, net, users] = await Promise.all([
        WalletOpeningBalanceModel.find({ userId: { $in: ids } }).lean(),
        netSinceSnapshot(ids),
        UserModel.find({ _id: { $in: ids } }).select('balance usdBalance').lean(),
    ]);
    const byId = new Map(users.map((u: any) => [u._id.toString(), u]));
    for (const o of openings as any[]) {
        const u: any = byId.get(o.userId.toString());
        if (!u) continue;
        const actual = round2(Number((o.currency === 'USD' ? u.usdBalance : u.balance) ?? 0));
        const expected = round2(o.amount + (net.get(`${o.userId}:${o.currency}`) ?? 0));
        const list = out.get(o.userId.toString()) ?? [];
        list.push({ currency: o.currency, actual, expected, matches: Math.abs(actual - expected) <= TOLERANCE });
        out.set(o.userId.toString(), list);
    }
    return out;
}
