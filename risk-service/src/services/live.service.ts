import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import { IdentifierModel, LinkKind, RiskCursorModel, RiskEventModel, RiskEventType, RiskMemberModel, RiskRunModel } from '../database/models';
import { childLogger } from '../lib/logger';
import { sourceCollection } from '../lib/sources';
import { analyse } from './analysis';
import { datacenterAsns } from './datacenter-asns';
import { collectFacts } from './facts';
import { hashOf, phoneKey, tailOf } from './identity';
import { enqueue as kycEnqueue } from './kyc.service';
import { addLiveReason, clearedUpdate, dropCached, expireLiveReasons, sendCases, storeMembers } from './scoring';
import { timeJob } from '../utils/metrics';

const log = childLogger('Live');

/**
 * Security plan Phase 4, part 2: the engine fed by events (plan §1, "performance design").
 *
 * Where events come from:
 *   - user-service sends hints (fire-and-forget, 1 s): signup, contact_change,
 *     authenticator_change, dormant_reactivated, balance_mismatch;
 *   - the watcher reads the payment database itself (read-only): new withdrawals
 *     (by _id, every RISK_WATCH_EVERY_SEC) and payments paid in the last 24 h
 *     (every 5 min). No payment code path had to change, and a withdrawal made by
 *     any path (member, admin, script) is seen.
 * Every event is a `riskevents` row with a unique key, handled once, one batch a
 * second. The producer never waits: a slow risk-service only delays scoring.
 *
 * Per event:
 *   - its identifiers (payout number, paying number, profile MoMo, devices) join
 *     the identifier index; a new account on a known identifier rescoring the
 *     linked group with the same analysis as the look-back (facts re-read for
 *     that group only);
 *   - event rules add live reasons, each counted until it expires:
 *       contact_change_withdrawal   withdrawal ≤ 72 h after an email/phone/MoMo/
 *                                   crypto/authenticator change            30 (7 days)
 *       new_device_country_payout   same day: new device + new country + a
 *                                   withdrawal number new to the member     40 (7 days)
 *       datacenter_network          withdrawal on a day seen from a hosting/VPN
 *                                   network, or sign-up from one (the gateway's own
 *                                   network lookup, free IP files, 2026-11-22)   15 (7 days)
 *       signup_burst                ≥ RISK_SIGNUP_BURST sign-ups under one sponsor
 *                                   from one network or device in 24 h:
 *                                   sponsor 30, each recruit 20             (30 days)
 *       dormant_reactivated         a dormant account signs in again        15 (30 days)
 *       balance_mismatch            the ledger triple check disagrees       30 (30 days)
 *       tor_network                 sign-up or a protected action through Tor (Cloudflare T1)  20
 *       password_guessing           10 wrong passwords within an hour on the account (Phase 1):
 *                                   someone may be trying to take it over                 15 (7 days)
 *       automation                  the gateway saw this member's token used outside the
 *                                   web app: invalid signature, replayed request, body
 *                                   changed after signing, tool user-agent (Phase 9)  20 (7 days)
 *   - the decision cache of every member touched is dropped.
 * The weekly rebuild (Sunday 01:00 Douala) reruns the full look-back: it sees
 * what live scoring can't (hubs forming, links through devices, history).
 */

export const LIVE_POINTS = {
    contact_change_withdrawal: 30,
    new_device_country_payout: 40,
    datacenter_network: 15,
    signup_burst_sponsor: 30,
    signup_burst_recruit: 20,
    dormant_reactivated: 15,
    balance_mismatch: 30,
    automation: 20,
    password_guessing: 15,
    tor_network: 20,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ID = /^[a-f0-9]{24}$/i;
const doualaDay = (d: Date) => new Date(d.getTime() + HOUR).toISOString().slice(0, 10);
const doualaWeekday = (d: Date) => new Date(d.getTime() + HOUR).getUTCDay();
const doualaHourOf = (d: Date) => new Date(d.getTime() + HOUR).getUTCHours();
const oid = (id: string) => new Types.ObjectId(id);

export const liveReady = () => !config.live.disabled && !!config.sources.usersUri && !!config.sources.paymentUri;

// ---------------------------------------------------------------- intake

export interface EventIn { type: RiskEventType; userId: string; at?: Date; data?: Record<string, unknown>; key?: string; source?: string }

/** Stores an event (idempotent on `key`). true = new. */
export async function recordEvent(e: EventIn, now: Date = new Date()): Promise<boolean> {
    const at = e.at && !isNaN(e.at.getTime()) && e.at.getTime() <= now.getTime() + 60_000 ? e.at : now;
    try {
        await RiskEventModel.create({
            key: e.key ?? `${e.type}:${e.userId}:${randomUUID()}`, type: e.type, userId: e.userId, at, data: e.data ?? {},
            source: e.source ?? null, status: 'pending', nextAt: now,
            expiresAt: new Date(now.getTime() + config.live.eventRetentionDays * DAY),
        });
        return true;
    } catch (err: any) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

/**
 * Turns a hint from user-service into an event. Network and device arrive in
 * clear (a /24 range, the app's device id) and are stored only as HMACs.
 */
export function hintToEvent(body: any, source: string): EventIn | { error: string } {
    const type = body?.type;
    const userId = body?.userId;
    if (typeof userId !== 'string' || !ID.test(userId)) return { error: 'userId required' };
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const at = body?.at ? new Date(body.at) : undefined;
    switch (type) {
        case 'signup': {
            const range = str(body.ipRange, 45);
            const ua = str(body.userAgent, 300);
            const device = str(body.device, 64);
            const asn = Number(body.asn);
            const tor = body.tor === true;
            return {
                type, userId, at, source,
                data: {
                    ...(range ? { net: hashOf('signup_net', `${range}|${ua ?? ''}`) } : {}),
                    ...(device ? { device: hashOf('device', device) } : {}),
                    // a network number, not personal: kept as is for the hosting/VPN rule
                    ...(Number.isInteger(asn) && asn > 0 && asn < 2 ** 32 ? { asn } : {}),
                    ...(tor ? { tor: true } : {}),
                },
            };
        }
        case 'contact_change': {
            const kind = ['email', 'phone', 'momo', 'crypto'].includes(body.kind) ? body.kind : null;
            if (!kind) return { error: 'kind: email | phone | momo | crypto' };
            return { type, userId, at, source, data: { kind } };
        }
        case 'authenticator_change': {
            const kind = ['setup', 'reset'].includes(body.kind) ? body.kind : null;
            if (!kind) return { error: 'kind: setup | reset' };
            return { type, userId, at, source, data: { kind } };
        }
        case 'dormant_reactivated':
            return { type, userId, at, source, data: { from: body.from === 'long_dormant' ? 'long_dormant' : 'dormant' } };
        case 'balance_mismatch':
            return { type, userId, at, source, data: { currency: body.currency === 'USD' ? 'USD' : 'XAF' }, key: str(body.key, 200) ? `balance_mismatch:${str(body.key, 200)}` : undefined };
        case 'signin_failures': {
            const count = Math.min(Math.max(Math.floor(Number(body.count) || 0), 1), 100_000);
            return { type, userId, at, source, data: { count } };
        }
        case 'automation_seen': {
            // Phase 9: counts for one member over the gateway's last minute (robot = forged or
            // replayed anti-robot answers, ALTCHA, 2026-11-22)
            const n = (v: unknown) => Math.min(Math.max(Math.floor(Number(v) || 0), 0), 100_000);
            const counts = { badSig: n(body.badSig), replay: n(body.replay), bodyMismatch: n(body.bodyMismatch), tool: n(body.tool), robot: n(body.robot), tor: n(body.tor) };
            if (!Object.values(counts).some(Boolean)) return { error: 'automation_seen: no count' };
            return { type, userId, at, source, data: counts };
        }
        default:
            return { error: 'type: signup | contact_change | authenticator_change | dormant_reactivated | balance_mismatch | automation_seen | signin_failures' };
    }
}

// ---------------------------------------------------------------- watcher (payment database, read-only)

const USD_TO_XAF = 500;
/** Inserts lag behind their ObjectId by a moment; the cursor stays this far behind now. */
const SETTLE_MS = 5_000;

/** New withdrawal requests since the cursor (first run: from now; history is the rebuild's). */
export async function watchWithdrawals(now: Date = new Date()): Promise<number> {
    const tx = await sourceCollection('payment', 'transactions');
    if (!tx) return 0;
    const upTo = Types.ObjectId.createFromTime(Math.floor((now.getTime() - SETTLE_MS) / 1000));
    const cur = await RiskCursorModel.findById('withdrawals').lean() as any;
    if (!cur?.lastId) {
        await RiskCursorModel.updateOne({ _id: 'withdrawals' }, { $set: { lastId: String(upTo), at: now } }, { upsert: true });
        return 0;
    }
    const docs = await tx.find(
        { _id: { $gt: oid(cur.lastId), $lt: upTo }, type: 'withdrawal' },
        { projection: { userId: 1, amount: 1, currency: 1, status: 1, createdAt: 1, 'metadata.accountInfo.fullMomoNumber': 1, 'metadata.cryptoAddress': 1 } },
    ).sort({ _id: 1 }).limit(2000).toArray();
    let n = 0;
    for (const w of docs as any[]) {
        const k = phoneKey(w.metadata?.accountInfo?.fullMomoNumber);
        const amount = Number(w.amount) * (w.currency === 'USD' ? USD_TO_XAF : 1);
        if (await recordEvent({
            type: 'withdrawal_requested', userId: String(w.userId), at: new Date(w.createdAt ?? w._id.getTimestamp()), key: `wd:${w._id}`, source: 'watcher',
            data: { transactionId: String(w._id), amountXaf: Number.isFinite(amount) ? Math.round(amount) : 0, ...(k ? { payout: hashOf('phone', k), payoutTail: tailOf(k) } : {}), crypto: !!w.metadata?.cryptoAddress },
        }, now)) n++;
    }
    // the cursor moves to the last row read, or to upTo when the window was read in full
    const lastId = docs.length === 2000 ? String((docs[docs.length - 1] as any)._id) : String(upTo);
    await RiskCursorModel.updateOne({ _id: 'withdrawals' }, { $set: { lastId, at: now } });
    return n;
}

/** Payments paid in the last 24 h whose paying number is not yet known for that member. */
export async function watchPayins(now: Date = new Date()): Promise<number> {
    const pi = await sourceCollection('payment', 'paymentintents');
    if (!pi) return 0;
    const docs = await pi.find(
        { createdAt: { $gte: new Date(now.getTime() - DAY) }, status: 'SUCCEEDED', phoneNumber: { $exists: true, $ne: null } },
        { projection: { userId: 1, phoneNumber: 1, updatedAt: 1, createdAt: 1 } },
    ).limit(50_000).toArray();
    if (!docs.length) return 0;
    const keys = docs.map((p: any) => `pi:${p._id}`);
    const seen = new Set<string>();
    for (let i = 0; i < keys.length; i += 5000) {
        for (const r of await RiskEventModel.find({ key: { $in: keys.slice(i, i + 5000) } }, { key: 1 }).lean() as any[]) seen.add(r.key);
    }
    let n = 0;
    for (const p of docs as any[]) {
        if (seen.has(`pi:${p._id}`) || !p.userId || !ID.test(String(p.userId))) continue;
        const k = phoneKey(p.phoneNumber);
        if (!k) continue;
        if (await recordEvent({ type: 'payin_succeeded', userId: String(p.userId), at: new Date(p.updatedAt ?? p.createdAt), key: `pi:${p._id}`, source: 'watcher', data: { payer: hashOf('phone', k), payerTail: tailOf(k) } }, now)) n++;
    }
    return n;
}

// ---------------------------------------------------------------- identifiers and groups

/**
 * Adds an account to an identifier (created if new). A hub takes no new
 * account. `linked` = the account joined an identifier other accounts already
 * had: its group may have changed.
 */
export async function linkIdentifier(kind: LinkKind, hash: string, tail: string | null, userId: string, use: string, now: Date = new Date()): Promise<{ added: boolean; linked: boolean; hub: boolean }> {
    const hubNow = { $eq: [{ $ifNull: ['$hub', false] }, true] };
    const before = await IdentifierModel.findOneAndUpdate(
        { kind, hash },
        [
            {
                $set: {
                    accounts: { $cond: [hubNow, '$accounts', { $setUnion: [{ $ifNull: ['$accounts', []] }, [userId]] }] },
                    payoutAccounts: use === 'payout_number'
                        ? { $cond: [hubNow, { $ifNull: ['$payoutAccounts', []] }, { $setUnion: [{ $ifNull: ['$payoutAccounts', []] }, [userId]] }] }
                        : { $ifNull: ['$payoutAccounts', []] },
                    uses: { $setUnion: [{ $ifNull: ['$uses', []] }, [use]] },
                    tail: { $ifNull: ['$tail', tail] },
                    firstSeenAt: { $ifNull: ['$firstSeenAt', now] },
                    lastSeenAt: now,
                },
            },
            { $set: { count: { $cond: [hubNow, '$count', { $size: '$accounts' }] } } },
            { $set: { hub: { $or: [hubNow, { $gt: ['$count', config.hubThreshold] }] } } },
        ] as any,
        { upsert: true, new: false },
    ).lean() as any;
    if (!before) return { added: true, linked: false, hub: false };
    if (before.hub) return { added: false, linked: false, hub: true };
    const had = (before.accounts ?? []).includes(userId);
    return { added: !had, linked: !had && (before.accounts ?? []).length > 0, hub: false };
}

/** The accounts linked to `userId` through non-hub identifiers (breadth-first, at most `max`). */
export async function groupOf(userId: string, max = config.live.maxGroup): Promise<string[]> {
    const seen = new Set<string>([userId]);
    let frontier = [userId];
    while (frontier.length && seen.size < max) {
        const rows = await IdentifierModel.find({ accounts: { $in: frontier }, hub: { $ne: true }, count: { $gte: 2 } }, { accounts: 1 }).limit(1000).lean() as any[];
        const next: string[] = [];
        for (const r of rows) for (const a of r.accounts ?? []) if (!seen.has(a) && seen.size < max) { seen.add(a); next.push(a); }
        frontier = next;
    }
    return [...seen];
}

const sourceOf = async (db: 'users' | 'payment', name: string) => {
    const c = await sourceCollection(db, name);
    if (!c) throw new Error(`${db} database unavailable`);
    return c;
};

/**
 * Rescores the linked group of `userId` with the look-back's analysis, on the
 * facts of that group only (re-read from the source databases), and sends the
 * new or worsened cases to support (alerting: they are new).
 */
export async function rescoreGroup(userId: string, now: Date = new Date()): Promise<{ members: number; cases: Record<string, number> }> {
    const ids = await groupOf(userId);
    const colls = new Map<string, any>();
    for (const [db, name] of [['users', 'users'], ['users', 'referrals'], ['users', 'user_geo_days'], ['payment', 'transactions'], ['payment', 'paymentintents']] as const) {
        colls.set(`${db}.${name}`, await sourceOf(db, name));
    }
    const facts = await collectFacts((db, name) => colls.get(`${db}.${name}`), { scope: ids });
    // identifiers that are hubs in the index link nothing, as in the full look-back
    const hashes = [...new Set(facts.identifiers.map(i => hashOf(i.kind === 'device' ? 'device' : 'phone', i.value)))];
    const hubs = new Set((await IdentifierModel.find({ hash: { $in: hashes }, hub: true }, { hash: 1 }).lean() as any[]).map(h => h.hash));
    if (hubs.size) facts.identifiers = facts.identifiers.filter(i => !hubs.has(hashOf(i.kind === 'device' ? 'device' : 'phone', i.value)));

    const result = analyse(facts, { hubThreshold: config.hubThreshold, thresholds: config.thresholds, disabledRules: config.disabledRules });
    await storeMembers(result.members, 'live', now);
    const scored = new Set(result.members.map(m => m.userId));
    const rest = ids.filter(id => !scored.has(id));
    if (rest.length) await RiskMemberModel.updateMany({ userId: { $in: rest } }, clearedUpdate('live', now) as any);
    await dropCached(ids);
    const cases = await sendCases(result.cases, true, { source: 'live' });
    return { members: ids.length, cases };
}

// ---------------------------------------------------------------- event handlers

async function sponsorOf(userId: string): Promise<string | null> {
    const refs = await sourceOf('users', 'referrals');
    const r = await refs.findOne({ referredUser: { $in: [oid(userId), userId] }, referralLevel: 1 }, { projection: { referrer: 1 } }) as any;
    return r?.referrer ? String(r.referrer) : null;
}

/** The member's profile MoMo and recent devices (consenting members only) into the index. */
async function refreshOwnIdentifiers(userId: string, now: Date): Promise<boolean> {
    let linked = false;
    const users = await sourceOf('users', 'users');
    const u = await users.findOne({ _id: oid(userId) }, { projection: { momoNumber: 1 } }) as any;
    const k = phoneKey(u?.momoNumber);
    if (k) linked = (await linkIdentifier('phone', hashOf('phone', k), tailOf(k), userId, 'profile_momo', now)).linked || linked;
    const geo = await sourceOf('users', 'user_geo_days');
    const since = doualaDay(new Date(now.getTime() - 30 * DAY));
    const devices = new Set<string>();
    for (const g of await geo.find({ userId: oid(userId), day: { $gte: since }, 'devices.0': { $exists: true } }, { projection: { devices: 1 } }).limit(200).toArray() as any[]) {
        for (const d of g.devices ?? []) if (d) devices.add(String(d));
    }
    for (const d of devices) linked = (await linkIdentifier('device', hashOf('device', d), tailOf(d), userId, 'device', now)).linked || linked;
    return linked;
}

/** Today vs the 30 days before (Douala days), from the consented signals. */
async function dayNetworkFacts(userId: string, at: Date) {
    const geo = await sourceOf('users', 'user_geo_days');
    const today = doualaDay(at);
    const from = doualaDay(new Date(at.getTime() - 30 * DAY));
    const rows = await geo.find({ userId: oid(userId), day: { $gte: from, $lte: today } }, { projection: { day: 1, country: 1, devices: 1, asns: 1 } }).limit(500).toArray() as any[];
    const before = rows.filter(r => r.day < today);
    const now = rows.filter(r => r.day === today);
    const oldDevices = new Set(before.flatMap(r => r.devices ?? []));
    const oldCountries = new Set(before.map(r => r.country).filter((c: string) => c && c !== 'XX'));
    return {
        hasHistory: before.length > 0,
        newDevice: now.some(r => (r.devices ?? []).some((d: string) => !oldDevices.has(d))),
        newCountry: now.some(r => r.country && r.country !== 'XX' && !oldCountries.has(r.country)),
        countryToday: now.find(r => r.country && r.country !== 'XX')?.country ?? null,
        datacenter: now.some(r => (r.asns ?? []).some((a: number) => datacenterAsns().has(Number(a)))),
    };
}

const KIND_FR: Record<string, string> = { email: 'd’adresse e-mail', phone: 'de numéro de téléphone', momo: 'de numéro Mobile Money', crypto: 'de portefeuille crypto', setup: 'd’application d’authentification', reset: 'd’application d’authentification (réinitialisée)' };

async function onWithdrawal(e: any, now: Date): Promise<string[]> {
    const userId: string = e.userId;
    const at = new Date(e.at);
    await refreshOwnIdentifiers(userId, now);
    let newPayoutNumber = false;
    if (e.data?.payout) newPayoutNumber = (await linkIdentifier('phone', e.data.payout, e.data.payoutTail ?? null, userId, 'payout_number', now)).added;

    // contact change (or authenticator) then withdrawal within 72 h
    const change = await RiskEventModel.findOne({ userId, type: { $in: ['contact_change', 'authenticator_change'] }, at: { $gte: new Date(at.getTime() - 72 * HOUR), $lte: at } }).sort({ at: -1 }).lean() as any;
    if (change) {
        const hours = Math.max(1, Math.round((at.getTime() - new Date(change.at).getTime()) / HOUR));
        await addLiveReason(userId, { rule: 'contact_change_withdrawal', points: LIVE_POINTS.contact_change_withdrawal, detail: `Retrait demandé ${hours} h après un changement ${KIND_FR[change.data?.kind] ?? 'de coordonnées'}`, caseType: 'abnormal_behavior' }, 7, now);
    }

    const net = await dayNetworkFacts(userId, at);
    if (newPayoutNumber && net.hasHistory && net.newDevice && net.newCountry) {
        const tail = e.data?.payoutTail ? ` •••${e.data.payoutTail}` : '';
        await addLiveReason(userId, { rule: 'new_device_country_payout', points: LIVE_POINTS.new_device_country_payout, detail: `Le même jour : nouvel appareil, nouveau pays (${net.countryToday}) et nouveau numéro de retrait${tail}`, caseType: 'abnormal_behavior' }, 7, now);
        await sendCases([{
            type: 'abnormal_behavior', dedupKey: `risk:new_device_country_payout:${userId}:${doualaDay(at)}`, severity: 'warning',
            summary: `Retrait vers un nouveau numéro${tail}, le jour d’un nouvel appareil et d’un nouveau pays (${net.countryToday}) : possible prise de compte.`,
            subject: { userId }, amount: e.data?.amountXaf ?? 0, country: net.countryToday ?? undefined,
            details: { rule: 'new_device_country_payout', transactionId: e.data?.transactionId ?? null },
        }], true, { source: 'live' });
    }
    if (net.datacenter) {
        await addLiveReason(userId, { rule: 'datacenter_network', points: LIVE_POINTS.datacenter_network, detail: 'Connecté le jour du retrait depuis un réseau d’hébergement ou un VPN' }, 7, now);
    }
    // always rescored: the quick-withdrawal and group rules must see the new withdrawal
    return [userId];
}

async function onSignup(e: any, now: Date): Promise<string[]> {
    const userId: string = e.userId;
    await kycEnqueue([userId], 'signup', now);
    const sponsor = await sponsorOf(userId);
    const touched: string[] = [];
    if (sponsor) await RiskEventModel.updateOne({ _id: e._id }, { $set: { 'data.sponsorId': sponsor } });
    if (sponsor && (e.data?.net || e.data?.device)) {
        const at = new Date(e.at);
        const same = [...(e.data.net ? [{ 'data.net': e.data.net }] : []), ...(e.data.device ? [{ 'data.device': e.data.device }] : [])];
        const burst = await RiskEventModel.find({ type: 'signup', 'data.sponsorId': sponsor, at: { $gte: new Date(at.getTime() - DAY), $lte: new Date(at.getTime() + 60_000) }, $or: same }, { userId: 1 }).limit(500).lean() as any[];
        const recruits = [...new Set([...burst.map(b => b.userId), userId])];
        if (recruits.length >= config.live.signupBurst) {
            const detail = `${recruits.length} inscriptions sous le même parrain depuis un même réseau ou appareil en 24 h`;
            for (const r of recruits) await addLiveReason(r, { rule: 'signup_burst', points: LIVE_POINTS.signup_burst_recruit, detail, caseType: 'multi_account' }, 30, now);
            await addLiveReason(sponsor, { rule: 'signup_burst', points: LIVE_POINTS.signup_burst_sponsor, detail: `${detail} (parrain)`, caseType: 'multi_account' }, 30, now);
            await sendCases([{
                type: 'multi_account', dedupKey: `risk:signup_burst:${sponsor}:${doualaDay(at)}`,
                severity: recruits.length >= 2 * config.live.signupBurst ? 'critical' : 'warning',
                summary: `${detail} : possibles faux comptes pour toucher des commissions.`,
                subject: { userId: sponsor }, amount: 0,
                details: { rule: 'signup_burst', sponsor, accounts: recruits.slice(0, 50), accountCount: recruits.length },
            }], true, { source: 'live' });
            touched.push(sponsor, ...recruits);
        }
    }
    if (e.data?.asn && datacenterAsns().has(Number(e.data.asn))) {
        await addLiveReason(userId, { rule: 'datacenter_network', points: LIVE_POINTS.datacenter_network, detail: 'Inscription depuis un réseau d’hébergement ou un VPN' }, 7, now);
        touched.push(userId);
    }
    if (e.data?.tor) {
        await addLiveReason(userId, { rule: 'tor_network', points: LIVE_POINTS.tor_network, detail: 'Inscription depuis le réseau Tor (adresse masquée)' }, 7, now);
        touched.push(userId);
    }
    if (await refreshOwnIdentifiers(userId, now)) touched.push(userId);
    return touched;
}

async function handle(e: any, now: Date): Promise<{ rescore: string[]; touched: string[] }> {
    const userId: string = e.userId;
    switch (e.type as RiskEventType) {
        case 'withdrawal_requested':
            return { rescore: await onWithdrawal(e, now), touched: [] };
        case 'payin_succeeded': {
            const r = e.data?.payer ? await linkIdentifier('phone', e.data.payer, e.data.payerTail ?? null, userId, 'payin_number', now) : null;
            return { rescore: r?.linked ? [userId] : [], touched: [] };
        }
        case 'signup': {
            const touched = await onSignup(e, now);
            return { rescore: touched.includes(userId) ? [userId] : [], touched };
        }
        case 'contact_change': {
            if (e.data?.kind !== 'crypto') await kycEnqueue([userId], 'contact_change', now);
            const linked = e.data?.kind === 'momo' ? await refreshOwnIdentifiers(userId, now) : false;
            return { rescore: linked ? [userId] : [], touched: [] };
        }
        case 'authenticator_change':
            return { rescore: [], touched: [] }; // kept for the withdrawal rule
        case 'dormant_reactivated':
            await addLiveReason(userId, { rule: 'dormant_reactivated', points: LIVE_POINTS.dormant_reactivated, detail: e.data?.from === 'long_dormant' ? 'Compte inactif depuis plus d’un an revenu' : 'Compte dormant revenu' }, 30, now);
            return { rescore: [], touched: [userId] };
        case 'balance_mismatch':
            await addLiveReason(userId, { rule: 'balance_mismatch', points: LIVE_POINTS.balance_mismatch, detail: `Les registres du solde ne concordent pas (${e.data?.currency ?? 'XAF'})`, caseType: 'abnormal_behavior' }, 30, now);
            return { rescore: [], touched: [userId] };
        case 'signin_failures':
            await addLiveReason(userId, { rule: 'password_guessing', points: LIVE_POINTS.password_guessing, detail: `${e.data?.count ?? 10} mots de passe erronés en moins d’une heure : quelqu’un essaie peut-être d’entrer dans le compte` }, 7, now);
            return { rescore: [], touched: [userId] };
        case 'automation_seen': {
            // the member's counts over the last 24 h, so the reason says how often
            const since = new Date(new Date(e.at).getTime() - DAY);
            const all = await RiskEventModel.find({ userId, type: 'automation_seen', at: { $gte: since } }, { data: 1 }).limit(2000).lean() as any[];
            const sum = (k: string) => all.reduce((s, x) => s + (Number(x.data?.[k]) || 0), 0);
            const parts = [
                sum('badSig') && `${sum('badSig')} signature(s) invalide(s)`,
                sum('replay') && `${sum('replay')} requête(s) rejouée(s)`,
                sum('bodyMismatch') && `${sum('bodyMismatch')} contenu(s) modifié(s) après signature`,
                sum('tool') && `${sum('tool')} requête(s) depuis un outil (Postman, curl, script…)`,
                sum('robot') && `${sum('robot')} vérification(s) anti-robot falsifiée(s) ou rejouée(s)`,
            ].filter(Boolean);
            // Tor is its own rule (2026-11-22): hiding where you connect from is not automation.
            if (parts.length) await addLiveReason(userId, { rule: 'automation', points: LIVE_POINTS.automation, detail: `Compte utilisé hors de l’application web en 24 h : ${parts.join(', ')}` }, 7, now);
            if (sum('tor')) await addLiveReason(userId, { rule: 'tor_network', points: LIVE_POINTS.tor_network, detail: `${sum('tor')} action(s) sensible(s) (retrait, changement de numéro, connexion…) depuis le réseau Tor en 24 h` }, 7, now);
            return { rescore: [], touched: [userId] };
        }
        default:
            return { rescore: [], touched: [] };
    }
}

// ---------------------------------------------------------------- the loop

export interface LiveBatch { claimed: number; done: number; failed: number; rescored: number; ms: number }

export async function processEvents(limit = config.live.perSecond, now: Date = new Date()): Promise<LiveBatch> {
    const t0 = Date.now();
    const token = randomUUID();
    const due = await RiskEventModel.find({ status: 'pending', nextAt: { $lte: now } }, { _id: 1 }).sort({ nextAt: 1 }).limit(limit).lean();
    if (!due.length) return { claimed: 0, done: 0, failed: 0, rescored: 0, ms: Date.now() - t0 };
    await RiskEventModel.updateMany({ _id: { $in: due.map(d => d._id) }, status: 'pending', nextAt: { $lte: now } }, { $set: { claimToken: token, nextAt: new Date(now.getTime() + 5 * 60_000) } });
    const events = await RiskEventModel.find({ claimToken: token }).sort({ at: 1 }).lean() as any[];
    const toRescore = new Set<string>();
    let done = 0, failed = 0;
    for (const e of events) {
        try {
            const r = await handle(e, now);
            r.rescore.forEach(id => toRescore.add(id));
            await RiskEventModel.updateOne({ _id: e._id, claimToken: token }, { $set: { status: 'done', processedAt: new Date(), claimToken: null, lastError: null } });
            done++;
        } catch (err: any) {
            const attempts = (e.attempts ?? 0) + 1;
            await RiskEventModel.updateOne({ _id: e._id, claimToken: token }, {
                $set: { status: attempts >= 10 ? 'failed' : 'pending', attempts, lastError: String(err?.message ?? err).slice(0, 300), claimToken: null, nextAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1))) },
            });
            failed++;
            log.warn({ message: err?.message, type: e.type }, 'risk event failed');
        }
    }
    // one rescoring per group, even when several of its members had events in the batch
    const groupsDone = new Set<string>();
    let rescored = 0;
    for (const id of toRescore) {
        if (groupsDone.has(id)) continue;
        try {
            const r = await rescoreGroup(id, now);
            (await groupOf(id)).forEach(x => groupsDone.add(x));
            rescored += r.members;
        } catch (err: any) {
            log.warn({ message: err?.message }, 'group rescoring failed (the weekly rebuild will catch up)');
        }
    }
    return { claimed: events.length, done, failed, rescored, ms: Date.now() - t0 };
}

/** The weekly full rebuild: the look-back with --apply, cases filed without alerts. */
export async function weeklyRebuild(now: Date = new Date()): Promise<string | null> {
    const { runLookback } = await import('../scripts/lookback');
    const r = await runLookback({ usersUri: config.sources.usersUri, paymentUri: config.sources.paymentUri, since: null, apply: true, cases: true, kind: 'rebuild', log: (...a) => log.info(a.join(' ')) });
    log.info({ runId: r.runId, ms: Date.now() - now.getTime() }, 'weekly rebuild done');
    return r.runId;
}

/** Due when it is the rebuild hour on the rebuild day and no rebuild started in the last 6 days. */
export async function rebuildDue(now: Date = new Date()): Promise<boolean> {
    if (config.live.rebuildDisabled) return false;
    if (doualaWeekday(now) !== config.live.rebuildDay || doualaHourOf(now) !== config.live.rebuildHour) return false;
    return !(await RiskRunModel.exists({ kind: 'rebuild', startedAt: { $gte: new Date(now.getTime() - 6 * DAY) } }));
}

let timers: NodeJS.Timeout[] = [];
let busy = { events: false, withdrawals: false, payins: false, hourly: false };

export function startLiveLoop(): void {
    if (!liveReady()) {
        log.info('live events off (needs USERS_MONGODB_URI and PAYMENT_MONGODB_URI; RISK_LIVE_DISABLED)');
        return;
    }
    const guard = (k: keyof typeof busy, fn: () => Promise<unknown>) => async () => {
        if (busy[k]) return;
        busy[k] = true;
        try { await timeJob(`risk_live_${String(k)}`, fn); } catch (e: any) { log.warn({ message: e?.message, task: k }, 'live task failed'); } finally { busy[k] = false; }
    };
    timers = [
        setInterval(guard('events', async () => {
            const r = await processEvents();
            if (r.claimed) log.info(r, 'risk events');
        }), 1000),
        setInterval(guard('withdrawals', () => watchWithdrawals()), config.live.watchEverySec * 1000),
        setInterval(guard('payins', () => watchPayins()), 5 * 60_000),
        setInterval(guard('hourly', async () => {
            await expireLiveReasons();
            if (await rebuildDue()) await weeklyRebuild();
        }), 60_000),
    ];
    log.info('live events started');
}

export function stopLiveLoop(): void {
    timers.forEach(t => clearInterval(t));
    timers = [];
}

/** Counts for the status route (no member data). */
export async function liveStatus() {
    const [pending, failed, byType, cursor, lastRebuild] = await Promise.all([
        RiskEventModel.countDocuments({ status: 'pending' }),
        RiskEventModel.countDocuments({ status: 'failed' }),
        RiskEventModel.aggregate([{ $match: { at: { $gte: new Date(Date.now() - DAY) } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
        RiskCursorModel.findById('withdrawals').lean(),
        RiskRunModel.findOne({ kind: 'rebuild' }).sort({ startedAt: -1 }).lean(),
    ]);
    return {
        on: liveReady(), pending, failed,
        last24h: Object.fromEntries(byType.map((x: any) => [x._id, x.n])),
        watcherAt: (cursor as any)?.at ?? null,
        lastRebuild: lastRebuild ? { runId: (lastRebuild as any)._id, startedAt: (lastRebuild as any).startedAt, finishedAt: (lastRebuild as any).finishedAt } : null,
    };
}
