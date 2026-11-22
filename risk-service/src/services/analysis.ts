import { Decision, IdentifierKind, LinkKind, Reason } from '../database/models';
import { hashOf, tailOf, UnionFind } from './identity';

/**
 * Security plan Phase 4: the fraud analysis as a pure function over facts (no
 * database), so the look-back scan and the tests run the same code.
 *
 * Links (plan §2): accounts are joined by STRONG identifiers only: withdrawal
 * number, profile MoMo, number that paid an activation (one phone identifier,
 * whatever the role), device ID. An
 * identifier shared by more than `hubThreshold` accounts (a shop number, a
 * carrier) is a hub and links nothing.
 *
 * Rules (plan §3), first set:
 *   shared_payout_number  a withdrawal number used by accounts in each other's
 *                         referral tree (levels 1–3)                       40
 *   self_referral         sponsor and recruit (levels 1–3) in the same group 50
 *   multi_account         a group of 3+ accounts (+5 per extra, max 40)      20
 *   quick_withdrawal      withdrawal within 30 min of commissions it empties 10
 *   inactive_recruits     a sponsor whose recruits (level 1) were activated and then never signed in
 *                         again: ≥ 5 such recruits, ≥ 70 % of those activated ≥ 30 days ago   25
 *                         Only activations since SIGNIN_TRACKING_SINCE (2026-11-21, the day member
 *                         sign-ins started being recorded) count: older ones have no sign-in data.
 * Score = sum of the rules a member hits; decision from the thresholds.
 */

export interface Facts {
    identifiers: { kind: IdentifierKind; value: string; userId: string }[];
    /** referrer → referred, levels 1–3 (the referrals collection stores all three). */
    referrals: { referrer: string; referred: string; level: number }[];
    withdrawals: { userId: string; amount: number; at: Date; completed: boolean }[];
    commissions: { userId: string; amount: number; at: Date }[];
    countries: Map<string, string>;
    /** first CLASSIQUE/CIBLE activation and last sign-in, per member (inactive_recruits); optional */
    activity?: Map<string, { activatedAt: Date | null; lastSignInAt: Date | null }>;
}

export interface AnalysisConfig {
    hubThreshold: number;
    thresholds: { requireCode: number; hold: number };
    disabledRules: Set<string>;
    quickWindowMs?: number;
    /** "now" for the time-based rules (tests); default the real time */
    now?: Date;
}

/** Member sign-ins are recorded since this day (user-service dormancy.lastSignInAt / lastLoginAt). */
export const SIGNIN_TRACKING_SINCE = new Date('2026-11-21T00:00:00Z');

export interface CaseOut {
    type: 'shared_payout_number' | 'self_referral' | 'multi_account' | 'abnormal_behavior';
    dedupKey: string; severity: 'info' | 'warning' | 'critical'; summary: string;
    subject: { userId: string }; amount: number; country?: string; details: Record<string, unknown>;
}

export interface MemberOut { userId: string; groupId: string; groupSize: number; score: number; decision: Decision; reasons: Reason[]; country: string | null }

/** Accounts listed in a case (the rest are on the member card's linked accounts). */
const MAX_LISTED = 50;

export const RULE_POINTS = { shared_payout_number: 40, self_referral: 50, multi_account: 20, quick_withdrawal: 10, inactive_recruits: 25 } as const;

export function decide(score: number, t: { requireCode: number; hold: number }): Decision {
    return score >= t.hold ? 'hold' : score >= t.requireCode ? 'require_code' : 'allow';
}

export function analyse(f: Facts, cfg: AnalysisConfig) {
    const on = (rule: string) => !cfg.disabledRules.has(rule);

    // ---- identifiers → links ----
    // A phone number is one identifier whatever its role: the payout number of
    // one account and the profile MoMo of another link them. `payoutAccounts`
    // keeps who withdrew to it, for the shared-number rule.
    const byIdent = new Map<string, { kind: LinkKind; value: string; accounts: Set<string>; payoutAccounts: Set<string>; uses: Set<IdentifierKind> }>();
    for (const i of f.identifiers) {
        if (!i.value || !i.userId) continue;
        const kind: LinkKind = i.kind === 'device' ? 'device' : 'phone';
        const key = `${kind}|${i.value}`;
        const e = byIdent.get(key) ?? { kind, value: i.value, accounts: new Set<string>(), payoutAccounts: new Set<string>(), uses: new Set<IdentifierKind>() };
        e.accounts.add(i.userId);
        e.uses.add(i.kind);
        if (i.kind === 'payout_number') e.payoutAccounts.add(i.userId);
        byIdent.set(key, e);
    }
    const uf = new UnionFind();
    const shared: { kind: LinkKind; value: string; accounts: string[]; payoutAccounts: string[]; uses: IdentifierKind[]; hub: boolean }[] = [];
    for (const e of byIdent.values()) {
        if (e.accounts.size < 2) continue;
        const accounts = [...e.accounts];
        const hub = accounts.length > cfg.hubThreshold;
        shared.push({ kind: e.kind, value: e.value, accounts, payoutAccounts: [...e.payoutAccounts], uses: [...e.uses], hub });
        if (hub) continue;
        for (let k = 1; k < accounts.length; k++) uf.union(accounts[0], accounts[k]);
    }
    const groups = [...uf.groups().values()].filter(g => g.length >= 2);
    const groupOf = new Map<string, { id: string; members: string[] }>();
    for (const g of groups) {
        const id = [...g].sort()[0];
        for (const m of g) groupOf.set(m, { id, members: g });
    }

    // ---- referral relations (either direction, levels 1–3) ----
    const related = new Set<string>();
    for (const r of f.referrals) if (r.level >= 1 && r.level <= 3) related.add(`${r.referrer}|${r.referred}`);
    const isRelated = (a: string, b: string) => related.has(`${a}|${b}`) || related.has(`${b}|${a}`);

    const withdrawnBy = new Map<string, number>();
    for (const w of f.withdrawals) if (w.completed) withdrawnBy.set(w.userId, (withdrawnBy.get(w.userId) ?? 0) + w.amount);
    const sumWithdrawn = (ids: string[]) => Math.round(ids.reduce((s, id) => s + (withdrawnBy.get(id) ?? 0), 0));

    const reasons = new Map<string, Reason[]>();
    const add = (userId: string, r: Reason) => {
        const list = reasons.get(userId) ?? [];
        if (!list.some(x => x.rule === r.rule)) list.push(r);
        reasons.set(userId, list);
    };
    const cases: CaseOut[] = [];
    const pickSubject = (ids: string[]) => [...ids].sort((a, b) => (withdrawnBy.get(b) ?? 0) - (withdrawnBy.get(a) ?? 0) || a.localeCompare(b))[0];

    // ---- shared_payout_number ----
    if (on('shared_payout_number')) {
        for (const s of shared) {
            if (s.hub || s.payoutAccounts.length < 2) continue;
            const pa = s.payoutAccounts;
            const involved = new Set<string>();
            for (let i = 0; i < pa.length; i++) {
                for (let j = i + 1; j < pa.length; j++) {
                    if (isRelated(pa[i], pa[j])) { involved.add(pa[i]); involved.add(pa[j]); }
                }
            }
            if (involved.size < 2) continue;
            const ids = [...involved];
            const tail = tailOf(s.value);
            for (const id of ids) add(id, { rule: 'shared_payout_number', points: RULE_POINTS.shared_payout_number, detail: `Numéro de retrait •••${tail} partagé avec ${ids.length - 1} compte(s) de son parrainage`, caseType: 'shared_payout_number' });
            const amount = sumWithdrawn(ids);
            const subject = pickSubject(ids);
            cases.push({
                type: 'shared_payout_number', dedupKey: `risk:shared_payout:${hashOf('payout_number', s.value)}`,
                severity: ids.length >= 3 || amount >= 100_000 ? 'critical' : 'warning',
                summary: `Numéro de retrait •••${tail} utilisé par ${ids.length} comptes liés par le parrainage (${amount.toLocaleString('fr-FR')} F retirés).`,
                subject: { userId: subject }, amount, country: f.countries.get(subject),
                details: { numberTail: tail, accounts: ids.slice(0, MAX_LISTED), accountCount: ids.length, withdrawn: amount },
            });
        }
    }

    // ---- per group: self_referral, multi_account ----
    for (const g of groups) {
        const id = groupOf.get(g[0])!.id;
        const amount = sumWithdrawn(g);
        const subject = pickSubject(g);
        if (on('self_referral')) {
            const pairs: [string, string][] = [];
            for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (isRelated(g[i], g[j])) pairs.push([g[i], g[j]]);
            if (pairs.length) {
                const ids = [...new Set(pairs.flat())];
                for (const m of ids) add(m, { rule: 'self_referral', points: RULE_POINTS.self_referral, detail: `Parrain et filleul dans le même groupe de comptes liés (${g.length} comptes)`, caseType: 'self_referral' });
                cases.push({
                    type: 'self_referral', dedupKey: `risk:self_referral:${id}`,
                    severity: pairs.length >= 2 || amount >= 100_000 ? 'critical' : 'warning',
                    summary: `${pairs.length} lien(s) parrain–filleul entre des comptes qui partagent un numéro ou un appareil (${g.length} comptes, ${amount.toLocaleString('fr-FR')} F retirés).`,
                    subject: { userId: subject }, amount, country: f.countries.get(subject),
                    details: { groupId: id, accounts: g.slice(0, MAX_LISTED), accountCount: g.length, pairs: pairs.slice(0, MAX_LISTED), pairCount: pairs.length },
                });
            }
        }
        if (on('multi_account') && g.length >= 3) {
            const points = Math.min(RULE_POINTS.multi_account + 5 * (g.length - 3), 40);
            for (const m of g) add(m, { rule: 'multi_account', points, detail: `${g.length} comptes liés par un numéro ou un appareil`, caseType: 'multi_account' });
            cases.push({
                type: 'multi_account', dedupKey: `risk:multi_account:${id}`,
                severity: g.length >= 10 ? 'critical' : 'warning',
                summary: `${g.length} comptes liés par un même numéro ou appareil (${amount.toLocaleString('fr-FR')} F retirés).`,
                subject: { userId: subject }, amount, country: f.countries.get(subject),
                details: { groupId: id, accounts: g.slice(0, MAX_LISTED), accountCount: g.length },
            });
        }
    }

    // ---- quick_withdrawal ----
    if (on('quick_withdrawal')) {
        const windowMs = cfg.quickWindowMs ?? 30 * 60_000;
        const credits = new Map<string, { amount: number; at: number }[]>();
        for (const c of f.commissions) {
            const l = credits.get(c.userId) ?? [];
            l.push({ amount: c.amount, at: c.at.getTime() });
            credits.set(c.userId, l);
        }
        const hits = new Map<string, number>();
        for (const w of f.withdrawals) {
            const l = credits.get(w.userId);
            if (!l || w.amount < 2000) continue;
            const t = w.at.getTime();
            const recent = l.filter(c => c.at <= t && t - c.at <= windowMs).reduce((s, c) => s + c.amount, 0);
            // the withdrawal empties the fresh commissions AND is mostly made of them
            if (recent > 0 && w.amount >= 0.8 * recent && recent >= 0.5 * w.amount) hits.set(w.userId, (hits.get(w.userId) ?? 0) + 1);
        }
        for (const [userId, n] of hits) {
            add(userId, { rule: 'quick_withdrawal', points: RULE_POINTS.quick_withdrawal, detail: `${n} retrait(s) dans les 30 min suivant des commissions` });
            if (n >= 3) {
                cases.push({
                    type: 'abnormal_behavior', dedupKey: `risk:quick_withdrawal:${userId}`, severity: 'info',
                    summary: `${n} retraits faits dans les 30 minutes qui suivent des commissions.`,
                    subject: { userId }, amount: Math.round(withdrawnBy.get(userId) ?? 0), country: f.countries.get(userId),
                    details: { withdrawals: n },
                });
            }
        }
    }

    // ---- inactive_recruits ----
    if (on('inactive_recruits') && f.activity?.size) {
        const now = (cfg.now ?? new Date()).getTime();
        const DAY = 86_400_000;
        const bySponsor = new Map<string, { eligible: number; silent: string[] }>();
        for (const r of f.referrals) {
            if (r.level !== 1) continue;
            const a = f.activity.get(r.referred);
            const act = a?.activatedAt?.getTime();
            if (!act || act < SIGNIN_TRACKING_SINCE.getTime() || now - act < 30 * DAY) continue;
            const e = bySponsor.get(r.referrer) ?? { eligible: 0, silent: [] };
            e.eligible++;
            // never seen again after the day of the activation
            const seen = a?.lastSignInAt?.getTime();
            if (!seen || seen < act + DAY) e.silent.push(r.referred);
            bySponsor.set(r.referrer, e);
        }
        for (const [sponsor, e] of bySponsor) {
            if (e.silent.length < 5 || e.silent.length < 0.7 * e.eligible) continue;
            add(sponsor, { rule: 'inactive_recruits', points: RULE_POINTS.inactive_recruits, detail: `${e.silent.length} filleul(s) activé(s) sur ${e.eligible} ne se sont jamais reconnectés ensuite` });
            cases.push({
                type: 'multi_account', dedupKey: `risk:inactive_recruits:${sponsor}`, severity: e.silent.length >= 15 ? 'critical' : 'warning',
                summary: `${e.silent.length} filleuls activés puis jamais revenus : possibles comptes créés pour toucher les commissions.`,
                subject: { userId: sponsor }, amount: Math.round(withdrawnBy.get(sponsor) ?? 0), country: f.countries.get(sponsor),
                details: { rule: 'inactive_recruits', recruits: e.silent.slice(0, MAX_LISTED), silent: e.silent.length, eligible: e.eligible },
            });
        }
    }

    // ---- members ----
    const members: MemberOut[] = [];
    const everyone = new Set<string>([...groupOf.keys(), ...reasons.keys()]);
    for (const userId of everyone) {
        const rs = reasons.get(userId) ?? [];
        const score = rs.reduce((s, r) => s + r.points, 0);
        const g = groupOf.get(userId);
        members.push({ userId, groupId: g?.id ?? userId, groupSize: g?.members.length ?? 1, score, decision: decide(score, cfg.thresholds), reasons: rs, country: f.countries.get(userId) ?? null });
    }

    const identifiers = shared.map(s => ({ kind: s.kind, uses: s.uses, hash: hashOf(s.kind, s.value), tail: tailOf(s.value), accounts: s.hub ? s.accounts.slice(0, cfg.hubThreshold + 1) : s.accounts, payoutAccounts: s.payoutAccounts.length > cfg.hubThreshold ? [] : s.payoutAccounts, count: s.accounts.length, hub: s.hub }));
    const sharedPayoutNumbers = cases.filter(c => c.type === 'shared_payout_number').length;
    return {
        identifiers, members, cases,
        stats: {
            identifiersShared: shared.length, hubs: shared.filter(s => s.hub).length, groups: groups.length,
            largestGroup: groups.reduce((m, g) => Math.max(m, g.length), 0),
            sharedPayoutNumbers,
            accountsOnSharedPayoutNumbers: [...reasons.values()].filter(l => l.some(r => r.rule === 'shared_payout_number')).length,
            withdrawnOnSharedPayoutNumbers: cases.filter(c => c.type === 'shared_payout_number').reduce((s, c) => s + c.amount, 0),
            byDecision: members.reduce((o, m) => ({ ...o, [m.decision]: (o[m.decision] ?? 0) + 1 }), {} as Record<string, number>),
            casesByType: cases.reduce((o, c) => ({ ...o, [c.type]: (o[c.type] ?? 0) + 1 }), {} as Record<string, number>),
        },
    };
}
