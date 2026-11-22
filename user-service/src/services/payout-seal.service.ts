/**
 * Payout seal checks (utils/payout-seal.ts holds the seal and the model hooks).
 *
 * Where a broken seal is caught:
 *   - before every withdrawal and every admin approval: payment-service asks GET
 *     /users/internal/:id/withdrawal-lock first, which checks the seal (checkPayoutSeal);
 *   - when any code path is about to change the fields of a doc whose seal is already broken;
 *   - the nightly sweep (03:50 Douala), so a tamper is found even if nobody tries to withdraw.
 *
 * What happens (PAYOUT_SEAL_MODE=enforce, the default; `log` = case only, no freeze):
 *   1. the account's money is frozen (users.frozen, the same freeze support uses: withdrawals and
 *      transfers refused, lifted only by support's approved unfreeze);
 *   2. a critical case goes to support's « Fraude » queue (alerting), with the evidence: the sealed
 *      number's last digits, the current ones, and the numbers this member really withdrew to
 *      (from payment-service) — "changed without going through the app".
 */
import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import { openSupportCase } from './clients/support.service.client';
import { PAYOUT_FIELDS, SealState, makeSeal, sealEnabled, sealSince, sealState, setTamperHandler } from '../utils/payout-seal';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('PayoutSeal');
const mode = () => (['off', 'log', 'enforce'].includes(process.env.PAYOUT_SEAL_MODE || '') ? process.env.PAYOUT_SEAL_MODE! : 'enforce');
const PROJ: Record<string, 1> = { ...Object.fromEntries([...PAYOUT_FIELDS].map((f) => [f, 1])), payoutSeal: 1, frozen: 1, country: 1, deleted: 1 };
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-9);
const tail = (v: unknown, n = 3) => (v ? `…${String(v).trim().slice(-n)}` : null);

export interface WithdrawalDestinations { momo: { n: string; at: string; count: number }[]; crypto: { a: string; at: string; count: number }[] }

/** Numbers and wallets this member actually withdrew to (payment-service; last 9 digits only). */
export async function withdrawalDestinations(userIds: string[]): Promise<Record<string, WithdrawalDestinations> | null> {
    try {
        const r = await fetch(`${config.services.paymentService}/internal/withdrawal-destinations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'user-service' },
            body: JSON.stringify({ userIds }),
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return null;
        return ((await r.json()) as any)?.data ?? null;
    } catch {
        return null;
    }
}

const handled = new Map<string, number>();

/** A broken seal: freeze (enforce) and tell support, once per member and state of the fields. */
export async function handleTamper(userId: string, state: SealState, where: string): Promise<void> {
    if (mode() === 'off' || !Types.ObjectId.isValid(userId)) return;
    const d: any = await UserModel.collection.findOne({ _id: new Types.ObjectId(userId) }, { projection: PROJ });
    if (!d || d.deleted) return;
    const fingerprint = makeSeal(userId, d).h.slice(0, 12);
    const key = `${userId}:${fingerprint}`;
    if ((handled.get(key) ?? 0) > Date.now() - 3600_000) return;
    handled.set(key, Date.now());
    if (handled.size > 5000) handled.clear();

    let froze = false;
    if (mode() === 'enforce' && !d.frozen?.at) {
        const r = await UserModel.updateOne({ _id: d._id, 'frozen.at': { $exists: false } }, {
            $set: { frozen: { at: new Date(), reason: 'Destination de paiement modifiée hors de l’application (sceau invalide)', approvalId: null, by: 'payout_seal' } },
        });
        froze = r.modifiedCount === 1;
    }
    const dest = (await withdrawalDestinations([userId]))?.[userId] ?? null;
    const now9 = digits(d.momoNumber);
    const usedBefore = dest ? dest.momo.some((m) => m.n === now9) : null;
    const sealed = d.payoutSeal?.tails ?? null;
    const summary = state === 'missing'
        ? 'Sceau de paiement absent : la destination des retraits a pu être modifiée directement en base.'
        : `Destination des retraits modifiée hors de l’application : Mobile Money scellé ${sealed?.momo ?? '—'}, actuel ${tail(d.momoNumber) ?? '—'}`
          + (usedBefore === false ? ' (jamais utilisé pour un retrait)' : '');
    await openSupportCase({
        type: 'abnormal_behavior',
        dedupKey: `payout_tampered:${userId}:${fingerprint}`,
        severity: 'critical',
        subject: { userId },
        summary: `${summary}${froze ? ' Argent gelé automatiquement.' : mode() === 'log' ? ' (mode journal : rien n’est gelé)' : ''}`,
        details: {
            rule: 'payout_seal', state, where, frozenNow: froze, mode: mode(),
            sealed: sealed, sealedAt: d.payoutSeal?.at ?? null,
            current: { momo: tail(d.momoNumber), momoOperator: d.momoOperator ?? null, crypto: tail(d.cryptoWalletAddress, 4), cryptoNetwork: d.cryptoWalletCurrency ?? null },
            currentMomoUsedForAWithdrawal: usedBefore,
            withdrewTo: dest ? { momo: dest.momo.slice(0, 5).map((m) => ({ number: `…${m.n.slice(-3)}`, last: m.at, count: m.count })), crypto: dest.crypto.slice(0, 3).map((c) => ({ wallet: `…${c.a.slice(-4)}`, last: c.at, count: c.count })) } : 'payment-service unavailable',
        },
        country: typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country) ? d.country : undefined,
    });
    log.warn(`PAYOUT SEAL ${state} for user ${userId} (${where}): ${froze ? 'money frozen, ' : ''}case filed`);
}

/** Checks one member's seal; a broken one is handled before answering. */
export async function checkPayoutSeal(userId: string | Types.ObjectId, where: string): Promise<SealState> {
    if (!sealEnabled() || mode() === 'off') return 'off';
    const d: any = await UserModel.collection.findOne({ _id: new Types.ObjectId(String(userId)) }, { projection: PROJ });
    if (!d) return 'off';
    const st = sealState(d);
    if (st === 'mismatch' || st === 'missing') await handleTamper(String(userId), st, where);
    return st;
}

/** Nightly: every member with a payout destination or a seal. */
export async function sweepPayoutSeals(): Promise<{ checked: number; broken: number }> {
    if (!sealEnabled() || mode() === 'off') return { checked: 0, broken: 0 };
    const filter = sealSince() ? {} : { payoutSeal: { $exists: true } };
    let checked = 0, broken = 0;
    for await (const d of UserModel.collection.find({ ...filter, deleted: { $ne: true } }, { projection: PROJ })) {
        checked++;
        const st = sealState(d as any);
        if (st === 'mismatch' || st === 'missing') { broken++; await handleTamper(String(d._id), st, 'nightly sweep'); }
    }
    log.info(`Payout seal sweep: ${checked} checked, ${broken} broken`);
    return { checked, broken };
}

/**
 * One-time: seals every member who has no seal yet (trusting today's values), and lists the ones
 * whose current MoMo number was never used for any of their past withdrawals while other numbers
 * were: those are filed as warning cases for support to look at (nothing frozen). After it, set
 * PAYOUT_SEAL_SINCE so that a missing seal also counts as a tamper.
 */
export async function bootstrapPayoutSeals(apply: boolean, fileCases: boolean) {
    const out = { unsealed: 0, sealed: 0, mismatches: [] as { userId: string; current: string | null; withdrewTo: string[] }[] };
    const batch: any[] = [];
    const flush = async () => {
        if (!batch.length) return;
        const dest = await withdrawalDestinations(batch.map((d) => String(d._id)));
        if (!dest) throw new Error('payment-service unavailable: no withdrawal history to compare with');
        for (const d of batch) {
            const used = dest[String(d._id)]?.momo ?? [];
            const now9 = digits(d.momoNumber);
            if (now9 && used.length && !used.some((m) => m.n === now9)) {
                out.mismatches.push({ userId: String(d._id), current: tail(d.momoNumber), withdrewTo: used.slice(0, 3).map((m) => `…${m.n.slice(-3)}`) });
                if (apply && fileCases) {
                    await openSupportCase({
                        type: 'abnormal_behavior', dedupKey: `payout_seal_bootstrap:${d._id}`, severity: 'warning', subject: { userId: String(d._id) },
                        summary: `À vérifier : le numéro Mobile Money actuel (${tail(d.momoNumber)}) n’a jamais servi aux retraits de ce membre (${used.slice(0, 3).map((m) => `…${m.n.slice(-3)}`).join(', ')}).`,
                        details: { rule: 'payout_seal_bootstrap' }, alert: false,
                    });
                }
            }
            if (apply) {
                const cond: any = { _id: d._id, payoutSeal: { $exists: false } };
                for (const f of PAYOUT_FIELDS) cond[f] = d[f] ?? null;
                const r = await UserModel.collection.updateOne(cond, { $set: { payoutSeal: makeSeal(d._id, d) } });
                out.sealed += r.modifiedCount;
            }
        }
        batch.length = 0;
    };
    for await (const d of UserModel.collection.find({ payoutSeal: { $exists: false } }, { projection: PROJ })) {
        out.unsealed++;
        batch.push(d);
        if (batch.length >= 200) await flush();
    }
    await flush();
    return out;
}

/** At start: hooks report broken seals here; nightly sweep at 03:50 Douala. */
export function startPayoutSeal(scheduler: { schedule: (expr: string, fn: () => void, opts?: object) => unknown }, timeJob: <T>(n: string, f: () => Promise<T>) => Promise<T>) {
    if (!sealEnabled()) { log.info('Payout seal off (PAYOUT_SEAL_KEY unset)'); return; }
    setTamperHandler((id, st, where) => { void handleTamper(id, st, where).catch((e) => log.error(`payout seal handler: ${e?.message}`)); });
    if (process.env.PAYOUT_SEAL_SWEEP_DISABLED !== 'true') {
        scheduler.schedule('50 3 * * *', () => { void timeJob('payout_seal_sweep', () => sweepPayoutSeals()).catch((e) => log.error(`sweep: ${e?.message}`)); }, { timezone: 'Africa/Douala' });
    }
    log.info(`Payout seal on (mode ${mode()}, ${sealSince() ? `missing seal = tamper since ${sealSince()!.toISOString()}` : 'bootstrap not done yet'})`);
}
