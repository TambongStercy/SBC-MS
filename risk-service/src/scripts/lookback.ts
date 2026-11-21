/**
 * Security plan Phase 4: the look-back scan. It reads the user and payment
 * databases (read-only, through their own URIs), links accounts by strong
 * identifiers, applies the rules, and prints what it found.
 *
 *   SOURCE_USERS_MONGODB_URI=… SOURCE_PAYMENT_MONGODB_URI=… node dist/scripts/lookback.js            # dry run: counts only
 *   … node dist/scripts/lookback.js --apply           # writes identifiers, riskmembers, riskruns, opens the cases
 *   … --apply --no-cases                              # writes scores, opens no case
 *   … --since 2025-01-01                              # only transactions after this date (default: all)
 *
 * The dry run writes nothing anywhere. --apply writes only to risk-service's
 * own database (MONGODB_URI) and sends cases to support (SUPPORT_SERVICE_URL),
 * filed without alerts (`alert: false`): past cases go to the fraud queue, they do
 * not ring the managers' phones once each.
 * Nothing in the source databases is ever written.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { IdentifierModel, RiskMemberModel, RiskRunModel } from '../database/models';
import { analyse, Facts } from '../services/analysis';
import { clearDecisionCache } from '../services/decision.service';
import { phoneKey } from '../services/identity';
import { openCase } from '../services/support.client';
import { closeRedis } from '../lib/redis';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NO_CASES = args.includes('--no-cases');
const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : '';
const SINCE = sinceArg ? new Date(sinceArg) : null;
if (sinceArg && isNaN(SINCE!.getTime())) { console.error('--since: bad date'); process.exit(2); }

const USD_TO_XAF = 500;

export async function collectFacts(users: mongoose.Connection, payment: mongoose.Connection, since: Date | null): Promise<Facts> {
    const facts: Facts = { identifiers: [], referrals: [], withdrawals: [], commissions: [], countries: new Map() };
    const known = new Set<string>();

    // users: profile MoMo, country
    const uc = users.collection('users').find({}, { projection: { momoNumber: 1, country: 1 } }).batchSize(5000);
    for await (const u of uc as any) {
        const id = String(u._id);
        known.add(id);
        if (u.country) facts.countries.set(id, String(u.country).toUpperCase());
        const k = phoneKey(u.momoNumber);
        if (k) facts.identifiers.push({ kind: 'profile_momo', value: k, userId: id });
    }

    // referrals, levels 1–3 (archived ones still count: the tree existed)
    const rc = users.collection('referrals').find({ referralLevel: { $gte: 1, $lte: 3 } }, { projection: { referrer: 1, referredUser: 1, referralLevel: 1 } }).batchSize(10000);
    for await (const r of rc as any) {
        if (r.referrer && r.referredUser) facts.referrals.push({ referrer: String(r.referrer), referred: String(r.referredUser), level: r.referralLevel });
    }

    // devices (only members who consented to the signals)
    const gc = users.collection('user_geo_days').find({ 'devices.0': { $exists: true } }, { projection: { userId: 1, devices: 1 } }).batchSize(5000);
    for await (const g of gc as any) {
        for (const d of g.devices ?? []) if (d) facts.identifiers.push({ kind: 'device', value: String(d), userId: String(g.userId) });
    }

    // withdrawals: the number paid to
    const date = since ? { createdAt: { $gte: since } } : {};
    const wc = payment.collection('transactions').find({ type: 'withdrawal', ...date }, { projection: { userId: 1, amount: 1, currency: 1, status: 1, createdAt: 1, 'metadata.accountInfo.fullMomoNumber': 1 } }).batchSize(5000);
    for await (const w of wc as any) {
        const userId = String(w.userId);
        const amount = Number(w.amount) * (w.currency === 'USD' ? USD_TO_XAF : 1);
        facts.withdrawals.push({ userId, amount: Number.isFinite(amount) ? amount : 0, at: new Date(w.createdAt), completed: w.status === 'completed' });
        const k = phoneKey(w.metadata?.accountInfo?.fullMomoNumber);
        if (k) facts.identifiers.push({ kind: 'payout_number', value: k, userId });
    }

    // commissions: deposits credited because of a filleul
    const cc = payment.collection('transactions').find({ type: 'deposit', status: 'completed', 'paymentProvider.metadata.sourceUserId': { $exists: true }, ...date }, { projection: { userId: 1, amount: 1, currency: 1, createdAt: 1 } }).batchSize(10000);
    for await (const c of cc as any) {
        const amount = Number(c.amount) * (c.currency === 'USD' ? USD_TO_XAF : 1);
        facts.commissions.push({ userId: String(c.userId), amount: Number.isFinite(amount) ? amount : 0, at: new Date(c.createdAt) });
    }

    // numbers that paid (activation, products…)
    const pc = payment.collection('paymentintents').find({ status: 'SUCCEEDED', phoneNumber: { $exists: true, $ne: null }, ...date }, { projection: { userId: 1, phoneNumber: 1 } }).batchSize(10000);
    for await (const p of pc as any) {
        const k = phoneKey(p.phoneNumber);
        if (k && p.userId) facts.identifiers.push({ kind: 'payin_number', value: k, userId: String(p.userId) });
    }

    // drop ids that are not members (deleted docs, malformed ids)
    facts.identifiers = facts.identifiers.filter(i => known.has(i.userId));
    return facts;
}

export async function runLookback(o: { usersUri: string; paymentUri: string; since: Date | null; apply: boolean; cases: boolean; log?: (...a: unknown[]) => void }) {
    const say = o.log ?? ((...a: unknown[]) => console.log(...a));
    const users = await mongoose.createConnection(o.usersUri, { readPreference: 'secondaryPreferred', maxPoolSize: 4 }).asPromise();
    const payment = await mongoose.createConnection(o.paymentUri, { readPreference: 'secondaryPreferred', maxPoolSize: 4 }).asPromise();
    say(`Reading ${users.name} and ${payment.name}${o.since ? ` since ${o.since.toISOString().slice(0, 10)}` : ''} (read-only)…`);
    const t0 = Date.now();
    const facts = await collectFacts(users, payment, o.since);
    await users.close(); await payment.close();
    say(`Facts: ${facts.countries.size} members with a country, ${facts.identifiers.length} identifier uses, ${facts.referrals.length} referral links, ${facts.withdrawals.length} withdrawals, ${facts.commissions.length} commissions (${Math.round((Date.now() - t0) / 1000)} s)`);

    const result = analyse(facts, { hubThreshold: config.hubThreshold, thresholds: config.thresholds, disabledRules: config.disabledRules });
    const s = result.stats;
    say('\n--- Look-back ---');
    say(`Shared identifiers: ${s.identifiersShared} (hubs, ignored: ${s.hubs})`);
    say(`Groups of linked accounts: ${s.groups} (largest: ${s.largestGroup})`);
    say(`Withdrawal numbers shared inside a referral tree: ${s.sharedPayoutNumbers} (${s.accountsOnSharedPayoutNumbers} accounts, ${s.withdrawnOnSharedPayoutNumbers.toLocaleString('fr-FR')} F withdrawn)`);
    say(`Members scored: ${result.members.length}  by decision: ${JSON.stringify(s.byDecision)}`);
    say(`Cases: ${JSON.stringify(s.casesByType)}`);
    const byCountry = new Map<string, number>();
    for (const c of result.cases) byCountry.set(c.country ?? '??', (byCountry.get(c.country ?? '??') ?? 0) + 1);
    say(`Cases by country: ${[...byCountry].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);

    if (!o.apply) { say('\nDry run: nothing written. Add --apply to store the scores and open the cases.'); return { result, runId: null }; }

    if (mongoose.connection.readyState !== 1) await mongoose.connect(config.mongoUri);
    await Promise.all([IdentifierModel.syncIndexes(), RiskMemberModel.syncIndexes()]);
    const runId = `lookback-${new Date().toISOString().slice(0, 19)}-${randomUUID().slice(0, 6)}`;
    const startedAt = new Date();
    const now = new Date();

    for (let i = 0; i < result.identifiers.length; i += 1000) {
        await IdentifierModel.bulkWrite(result.identifiers.slice(i, i + 1000).map(d => ({
            updateOne: { filter: { kind: d.kind, hash: d.hash }, update: { $set: { uses: d.uses, tail: d.tail, accounts: d.accounts, payoutAccounts: d.payoutAccounts, count: d.count, hub: d.hub, lastSeenAt: now }, $setOnInsert: { firstSeenAt: now } }, upsert: true },
        })), { ordered: false });
    }
    for (let i = 0; i < result.members.length; i += 1000) {
        await RiskMemberModel.bulkWrite(result.members.slice(i, i + 1000).map(m => ({
            updateOne: { filter: { userId: m.userId }, update: { $set: { ...m, scoredAt: now, runId } }, upsert: true },
        })) as any, { ordered: false });
    }
    // members flagged by an earlier run and not by this one go back to allow
    const cleared = await RiskMemberModel.updateMany({ runId: { $ne: runId } }, [{ $set: { score: 0, decision: 'allow', reasons: [], groupId: '$userId', groupSize: 1, scoredAt: now, runId } }]);
    const cacheCleared = await clearDecisionCache();

    const sent: Record<string, number> = {};
    if (o.cases) {
        for (const c of result.cases) {
            const r = await openCase({ ...c, alert: false, details: { ...c.details, runId } });
            sent[r] = (sent[r] ?? 0) + 1;
        }
    }
    await RiskRunModel.create({ _id: runId, kind: 'lookback', dryRun: false, startedAt, finishedAt: new Date(), stats: { ...s, since: o.since, cleared: cleared.modifiedCount, cases: sent } });
    say(`\nApplied (${runId}): ${result.identifiers.length} identifiers, ${result.members.length} members, ${cleared.modifiedCount} cleared, ${cacheCleared} cached decisions dropped. Cases: ${o.cases ? JSON.stringify(sent) : 'none (--no-cases)'}`);
    return { result, runId, sent };
}

async function main() {
    const usersUri = process.env.SOURCE_USERS_MONGODB_URI;
    const paymentUri = process.env.SOURCE_PAYMENT_MONGODB_URI;
    if (!usersUri || !paymentUri) { console.error('Set SOURCE_USERS_MONGODB_URI and SOURCE_PAYMENT_MONGODB_URI'); process.exit(2); }
    await runLookback({ usersUri, paymentUri, since: SINCE, apply: APPLY, cases: !NO_CASES });
}

if (require.main === module) {
    main()
        .then(async () => { await closeRedis(); await mongoose.disconnect().catch(() => undefined); process.exit(0); })
        .catch(async (e) => { console.error(e); await closeRedis(); process.exit(1); });
}
