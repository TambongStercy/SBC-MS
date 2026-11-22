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
import { hashOf, tailOf } from '../services/identity';
import { collectFacts } from '../services/facts';
import { clearedUpdate, sendCases, storeMembers } from '../services/scoring';
import { closeRedis } from '../lib/redis';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NO_CASES = args.includes('--no-cases');
const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : '';
const SINCE = sinceArg ? new Date(sinceArg) : null;
if (sinceArg && isNaN(SINCE!.getTime())) { console.error('--since: bad date'); process.exit(2); }

/** Every identifier a member used (shared or not), so a live event can find who else used it. */
function allIdentifiers(facts: Facts, hubThreshold: number) {
    const by = new Map<string, { kind: 'phone' | 'device'; value: string; accounts: Set<string>; payout: Set<string>; uses: Set<string> }>();
    for (const i of facts.identifiers) {
        const kind = i.kind === 'device' ? 'device' : 'phone';
        const k = `${kind}|${i.value}`;
        const e = by.get(k) ?? { kind, value: i.value, accounts: new Set<string>(), payout: new Set<string>(), uses: new Set<string>() };
        e.accounts.add(i.userId); e.uses.add(i.kind);
        if (i.kind === 'payout_number') e.payout.add(i.userId);
        by.set(k, e);
    }
    return [...by.values()].map(e => {
        const accounts = [...e.accounts];
        const hub = accounts.length > hubThreshold;
        return {
            kind: e.kind, hash: hashOf(e.kind, e.value), tail: tailOf(e.value), uses: [...e.uses],
            accounts: hub ? accounts.slice(0, hubThreshold + 1) : accounts,
            payoutAccounts: hub || e.payout.size > hubThreshold ? [] : [...e.payout],
            count: accounts.length, hub,
        };
    });
}

export async function runLookback(o: { usersUri: string; paymentUri: string; since: Date | null; apply: boolean; cases: boolean; kind?: 'lookback' | 'rebuild'; log?: (...a: unknown[]) => void }) {
    const say = o.log ?? ((...a: unknown[]) => console.log(...a));
    const users = await mongoose.createConnection(o.usersUri, { readPreference: 'secondaryPreferred', maxPoolSize: 4 }).asPromise();
    const payment = await mongoose.createConnection(o.paymentUri, { readPreference: 'secondaryPreferred', maxPoolSize: 4 }).asPromise();
    say(`Reading ${users.name} and ${payment.name}${o.since ? ` since ${o.since.toISOString().slice(0, 10)}` : ''} (read-only)…`);
    const t0 = Date.now();
    const facts = await collectFacts((db, name) => (db === 'users' ? users : payment).collection(name) as any, { since: o.since });
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
    const kind = o.kind ?? 'lookback';
    const runId = `${kind}-${new Date().toISOString().slice(0, 19)}-${randomUUID().slice(0, 6)}`;
    const startedAt = new Date();
    const now = new Date();

    // every identifier, shared or not (part 2: a live event links a new account to it)
    const idents = allIdentifiers(facts, config.hubThreshold);
    for (let i = 0; i < idents.length; i += 1000) {
        await IdentifierModel.bulkWrite(idents.slice(i, i + 1000).map(d => ({
            updateOne: { filter: { kind: d.kind, hash: d.hash }, update: { $set: { uses: d.uses, tail: d.tail, accounts: d.accounts, payoutAccounts: d.payoutAccounts, count: d.count, hub: d.hub, lastSeenAt: now }, $setOnInsert: { firstSeenAt: now } }, upsert: true },
        })), { ordered: false });
    }
    await storeMembers(result.members, runId, now);
    // members flagged by an earlier run (or live) and not by this one lose their structural reasons; live ones stay
    const cleared = await RiskMemberModel.updateMany({ runId: { $ne: runId } }, clearedUpdate(runId, now) as any);
    const cacheCleared = await clearDecisionCache();

    // past cases are filed without alerting anyone (alert: false)
    const sent = o.cases ? await sendCases(result.cases, false, { runId }) : {};
    await RiskRunModel.create({ _id: runId, kind, dryRun: false, startedAt, finishedAt: new Date(), stats: { ...s, since: o.since, identifiersStored: idents.length, cleared: cleared.modifiedCount, cases: sent } });
    say(`\nApplied (${runId}): ${idents.length} identifiers, ${result.members.length} members, ${cleared.modifiedCount} cleared, ${cacheCleared} cached decisions dropped. Cases: ${o.cases ? JSON.stringify(sent) : 'none (--no-cases)'}`);
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
