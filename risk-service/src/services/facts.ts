import { Types } from 'mongoose';
import { Facts } from './analysis';
import { phoneKey } from './identity';

/**
 * Security plan Phase 4: the facts the analysis runs on, read from the user and
 * payment databases (read-only). The look-back and the weekly rebuild read
 * everything; a live event reads only the accounts of one linked group
 * (`scope`), with the same queries, so live scoring and the rebuild agree.
 */
type Collection = { find: (q: any, o?: any) => any };
export type CollectionOf = (db: 'users' | 'payment', name: string) => Collection;

const USD_TO_XAF = 500;
const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

export async function collectFacts(coll: CollectionOf, opts: { since?: Date | null; scope?: string[] } = {}): Promise<Facts> {
    const facts: Facts = { identifiers: [], referrals: [], withdrawals: [], commissions: [], countries: new Map(), activity: new Map() };
    const known = new Set<string>();
    const scope = opts.scope ? [...new Set(opts.scope)] : null;
    const oids = scope ? scope.map(oid).filter((x): x is Types.ObjectId => !!x) : [];
    // ids are ObjectIds in users / transactions, strings in paymentintents; match both forms
    const anyId = scope ? { $in: [...oids, ...scope] } : null;
    const date = opts.since ? { createdAt: { $gte: opts.since } } : {};

    // users: profile MoMo, country
    const uq = scope ? { _id: { $in: oids } } : {};
    for await (const u of coll('users', 'users').find(uq, { projection: { momoNumber: 1, country: 1, lastLoginAt: 1, 'dormancy.lastSignInAt': 1 } }).batchSize(5000) as any) {
        const id = String(u._id);
        known.add(id);
        const seen = [u.lastLoginAt, u.dormancy?.lastSignInAt].map(d => (d ? new Date(d).getTime() : 0)).reduce((a, b) => Math.max(a, b), 0);
        facts.activity!.set(id, { activatedAt: null, lastSignInAt: seen ? new Date(seen) : null });
        if (u.country) facts.countries.set(id, String(u.country).toUpperCase());
        const k = phoneKey(u.momoNumber);
        if (k) facts.identifiers.push({ kind: 'profile_momo', value: k, userId: id });
    }

    // referrals, levels 1–3 (archived ones still count: the tree existed); in scope, only inside the group
    const rq: any = { referralLevel: { $gte: 1, $lte: 3 }, ...(scope ? { referrer: anyId, referredUser: anyId } : {}) };
    for await (const r of coll('users', 'referrals').find(rq, { projection: { referrer: 1, referredUser: 1, referralLevel: 1 } }).batchSize(10000) as any) {
        if (r.referrer && r.referredUser) facts.referrals.push({ referrer: String(r.referrer), referred: String(r.referredUser), level: r.referralLevel });
    }

    // first CLASSIQUE/CIBLE activation since member sign-ins are recorded (inactive_recruits)
    const aq: any = { subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }, startDate: { $gte: new Date('2026-11-21T00:00:00Z') }, ...(scope ? { user: anyId } : {}) };
    for await (const sub of coll('users', 'subscriptions').find(aq, { projection: { user: 1, startDate: 1 } }).batchSize(10000) as any) {
        const id = String(sub.user);
        const a = facts.activity!.get(id);
        const at = new Date(sub.startDate);
        if (a && (!a.activatedAt || at < a.activatedAt)) a.activatedAt = at;
    }

    // devices (only members who consented to the signals)
    const gq: any = { 'devices.0': { $exists: true }, ...(scope ? { userId: anyId } : {}) };
    for await (const g of coll('users', 'user_geo_days').find(gq, { projection: { userId: 1, devices: 1 } }).batchSize(5000) as any) {
        for (const d of g.devices ?? []) if (d) facts.identifiers.push({ kind: 'device', value: String(d), userId: String(g.userId) });
    }

    // withdrawals: the number paid to
    const wq: any = { type: 'withdrawal', ...date, ...(scope ? { userId: anyId } : {}) };
    for await (const w of coll('payment', 'transactions').find(wq, { projection: { userId: 1, amount: 1, currency: 1, status: 1, createdAt: 1, 'metadata.accountInfo.fullMomoNumber': 1 } }).batchSize(5000) as any) {
        const userId = String(w.userId);
        const amount = Number(w.amount) * (w.currency === 'USD' ? USD_TO_XAF : 1);
        facts.withdrawals.push({ userId, amount: Number.isFinite(amount) ? amount : 0, at: new Date(w.createdAt), completed: w.status === 'completed' });
        const k = phoneKey(w.metadata?.accountInfo?.fullMomoNumber);
        if (k) facts.identifiers.push({ kind: 'payout_number', value: k, userId });
    }

    // commissions: deposits credited because of a filleul
    const cq: any = { type: 'deposit', status: 'completed', 'paymentProvider.metadata.sourceUserId': { $exists: true }, ...date, ...(scope ? { userId: anyId } : {}) };
    for await (const c of coll('payment', 'transactions').find(cq, { projection: { userId: 1, amount: 1, currency: 1, createdAt: 1 } }).batchSize(10000) as any) {
        const amount = Number(c.amount) * (c.currency === 'USD' ? USD_TO_XAF : 1);
        facts.commissions.push({ userId: String(c.userId), amount: Number.isFinite(amount) ? amount : 0, at: new Date(c.createdAt) });
    }

    // numbers that paid (activation, products…)
    const pq: any = { status: 'SUCCEEDED', phoneNumber: { $exists: true, $ne: null }, ...date, ...(scope ? { userId: anyId } : {}) };
    for await (const p of coll('payment', 'paymentintents').find(pq, { projection: { userId: 1, phoneNumber: 1 } }).batchSize(10000) as any) {
        const k = phoneKey(p.phoneNumber);
        if (k && p.userId) facts.identifiers.push({ kind: 'payin_number', value: k, userId: String(p.userId) });
    }

    // drop ids that are not members (deleted docs, malformed ids)
    facts.identifiers = facts.identifiers.filter(i => known.has(i.userId));
    return facts;
}
