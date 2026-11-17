import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    CHALLENGE_STATUS_LABELS, CHANGE_REQUEST_STATUS_LABELS, FRAUD_FLAG_STATUS_LABELS, FRAUD_REVIEW_LABELS,
    RESULT_STATUS_LABELS, VOTE_TX_STATUS_LABELS, VOTING_MODE_LABELS, listAnimationChallenges, listChangeRequests, listFraudFlags,
    num, xaf, fmtDate, type AnimChallenge, type AnimFraudFlag,
} from '../../api/animation';

/**
 * Shared vocabulary of the SBC Event « Animation & Engagement » admin page
 * (src/pages/EventAnimationPage.tsx): labels in words, badge colours, value
 * formatting for change-request diffs and audit snapshots, page context.
 */

export type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';

/** Badge colours, matching the other SBC Event pages. */
export const TONE_CLASSES: Record<Tone, string> = {
    neutral: 'bg-gray-100 text-gray-700',
    primary: 'bg-blue-100 text-blue-700',
    accent: 'bg-purple-100 text-purple-700',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
};

export type StatusTable = Record<string, [string, Tone]>;

/** [label, tone] from a label table and a tone table. */
const withTones = (labels: Record<string, string>, tones: Record<string, Tone>): StatusTable =>
    Object.fromEntries(Object.entries(labels).map(([k, l]) => [k, [l, tones[k] ?? 'neutral']]));

export const CHALLENGE_STATUS = withTones(CHALLENGE_STATUS_LABELS, {
    DRAFT: 'neutral', PROGRAMMED: 'neutral', REGISTRATION_OPEN: 'primary', REGISTRATION_CLOSED: 'primary', ACTIVE: 'accent',
    VOTING_OPEN: 'success', VOTING_CLOSED: 'primary', RESULTS_PENDING: 'warning', COMPLETED: 'success', CANCELLED: 'danger',
});
export const TX_STATUS = withTones(VOTE_TX_STATUS_LABELS, { PENDING: 'warning', SUCCESS: 'success', FAILED: 'danger', CANCELLED: 'neutral', REFUNDED: 'accent' });
export const FRAUD_REVIEW = withTones(FRAUD_REVIEW_LABELS, { NONE: 'neutral', PENDING: 'warning', CLEARED: 'neutral', CONFIRMED: 'danger' });
export const FLAG_STATUS = withTones(FRAUD_FLAG_STATUS_LABELS, { OPEN: 'warning', CLEARED: 'neutral', CONFIRMED: 'danger' });
export const CHANGE_STATUS = withTones(CHANGE_REQUEST_STATUS_LABELS, { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral' });
export const RESULT_STATUS = withTones(RESULT_STATUS_LABELS, { COMPUTED: 'primary', AWAITING_TIE_DECISION: 'warning', AWAITING_SECOND_ROUND: 'warning', FROZEN: 'success' });
export const REFUND_STATUS: StatusTable = { PENDING: ['En cours', 'warning'], FAILED: ['En échec', 'danger'], COMPLETED: ['Terminé', 'success'] };

/** Score at or above which an open flag blocks freezing the challenge's result (fraud.service THRESHOLDS.freezeBlockScore). */
export const FREEZE_BLOCK_SCORE = 50;

export const TIE_RULE_LABELS: Record<string, string> = {
    EARLIEST_TO_REACH: 'Premier à atteindre le score',
    SPLIT_PRIZE: 'Partage du lot',
    JURY_DECIDES: 'Décision du jury',
    ORGANIZER_DECIDES: 'Décision de l’organisateur',
    SECOND_ROUND: 'Second tour',
};
export const SCORING_LABELS: Record<string, string> = { VOTES: 'Votes', JURY: 'Jury', HYBRID: 'Hybride' };
export const SCOPE_LABELS: Record<string, string> = {
    ANY_SBC_USER: 'Tout compte SBC', TICKET_HOLDERS: 'Détenteurs de billet', TICKET_TYPES: 'Types de billet précis',
    OPEN: 'Ouvert à tous',
};
export const PERIOD_LABELS: Record<string, string> = { DAY: 'par jour', CHALLENGE: 'sur tout le défi' };

/** What a refused freeze means (result.service freezeResult codes). */
export const FREEZE_ERRORS: Record<string, string> = {
    FRAUD_REVIEW_PENDING: 'Des signalements de fraude à score élevé sont encore ouverts sur ce défi. Traite-les dans « À vérifier » avant de figer le résultat.',
    TIES_PENDING: 'Des égalités doivent être départagées (par l’organisateur ou le jury) avant de figer le résultat.',
    NOT_RESULTS_PENDING: 'Le résultat ne peut être figé qu’une fois les votes clos (statut « Résultats en attente »).',
    CONCURRENT_CHANGE: 'Le résultat a changé entre-temps. Recharge le défi puis réessaie.',
};

/** Event status (billetterie vocabulary) as shown next to a challenge's event. */
export const EVENT_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'brouillon', PENDING_REVIEW: 'à valider', REJECTED: 'refusé', PUBLISHED: 'en vente', SUSPENDED: 'suspendu',
    CANCELLED: 'annulé', COMPLETED: 'passé',
};

/** Payment method codes in words; unknown codes are shown as they come. */
const OPERATORS: Record<string, string> = {
    MTN: 'MTN Mobile Money', MTN_MOMO: 'MTN Mobile Money', ORANGE: 'Orange Money', ORANGE_MONEY: 'Orange Money',
    MOOV: 'Moov Money', WAVE: 'Wave', CARD: 'Carte bancaire', BALANCE: 'Solde SBC', WALLET: 'Solde SBC',
};
export const operatorLabel = (code?: string) => (code ? OPERATORS[code.toUpperCase()] ?? code : '—');

export const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

// ---------- errors ----------

/** The server's message (`{ message }`), else the Error's, else the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
    const server = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    if (typeof server === 'string' && server) return server;
    if (err instanceof Error && err.message) return err.message;
    return fallback;
}

// ---------- fraud ----------

/** Who or what a flag is about, in words. IP subjects prefixed `ua:` are device fingerprints. */
export function flagSubjectKind(f: Pick<AnimFraudFlag, 'subjectType' | 'subjectId'>): string {
    if (f.subjectType === 'IP') return f.subjectId?.startsWith('ua:') ? 'Appareil' : 'Adresse réseau';
    return ({ USER: 'Compte', TRANSACTION: 'Achat de votes', CANDIDATE: 'Candidat' } as Record<string, string>)[f.subjectType] ?? 'Sujet';
}

/** A short reference for network/device subjects, which have no name. */
export const shortRef = (id?: string | null) => (id ? `réf. …${String(id).replace(/^ua:/, '').slice(-6)}` : '');

// ---------- change requests ----------

export const TARGET_LABELS: Record<string, string> = { CHALLENGE: 'Défi', REWARD: 'Récompense', PACKAGE: 'Pack de votes' };

/** Field paths as the organizer sees them in the challenge / reward editors. */
export const FIELD_LABELS: Record<string, string> = {
    name: 'Nom', description: 'Description', imageFileId: 'Image', rulesText: 'Règlement',
    'schedule.registrationOpensAt': 'Ouverture des inscriptions', 'schedule.registrationClosesAt': 'Clôture des inscriptions',
    'schedule.startsAt': 'Début du défi', 'schedule.votingOpensAt': 'Ouverture des votes', 'schedule.votingClosesAt': 'Clôture des votes',
    'schedule.endsAt': 'Fin du défi', 'schedule.settlementGraceMin': 'Délai de grâce des paiements (min)',
    'participation.mode': 'Qui peut participer', 'participation.ticketTypeIds': 'Billets autorisés à participer',
    'participation.requiresApproval': 'Validation des candidatures', 'participation.maxCandidates': 'Nombre maximum de candidats',
    'participation.categories': 'Catégories', 'participation.photoRequired': 'Photo obligatoire', 'participation.videoAllowed': 'Vidéo autorisée',
    'voting.mode': 'Mode de vote', 'voting.voterScope': 'Qui peut voter', 'voting.voterTicketTypeIds': 'Billets autorisés à voter',
    'voting.free.perPeriod': 'Votes gratuits par période', 'voting.free.period': 'Période des votes gratuits',
    'voting.free.perCandidatePerPeriod': 'Votes par candidat et par période', 'voting.free.totalPerChallenge': 'Votes gratuits au total',
    'voting.selfVoteAllowed': 'Vote pour soi-même', 'voting.showVoteCounts': 'Affichage des votes',
    'scoring.method': 'Méthode de classement', 'scoring.publicWeight': 'Poids du public (%)', 'scoring.juryWeight': 'Poids du jury (%)',
    'scoring.criteria': 'Critères du jury', tieRule: 'Règle d’égalité', rankRewards: 'Récompenses de classement',
    packages: 'Packs de votes', activeRule: 'Règle d’attribution (version)',
};

/** Enum values in words, per field. */
export const VALUE_LABELS: Record<string, Record<string, string>> = {
    'participation.mode': { OPEN: 'Tout membre SBC', TICKET_HOLDERS: 'Détenteurs d’un billet', TICKET_TYPES: 'Certains billets', APPLICATION: 'Sur candidature' },
    'voting.mode': VOTING_MODE_LABELS,
    'voting.voterScope': { ANY_SBC_USER: 'Tout membre SBC', TICKET_HOLDERS: 'Détenteurs d’un billet', TICKET_TYPES: 'Certains billets' },
    'voting.free.period': { DAY: 'Par jour', CHALLENGE: 'Pour tout le défi' },
    'scoring.method': { VOTES: 'Votes', JURY: 'Jury', HYBRID: 'Public + jury' },
    tieRule: {
        EARLIEST_TO_REACH: 'Le premier à atteindre le score', SPLIT_PRIZE: 'Prix partagé', JURY_DECIDES: 'Le jury départage',
        ORGANIZER_DECIDES: 'L’organisateur départage', SECOND_ROUND: 'Second tour',
    },
};

/** A field path in words; unknown paths keep their last segment rather than the raw dotted path. */
export const fieldLabel = (path: string) => FIELD_LABELS[path] ?? path.split('.').pop() ?? path;

/** Diff values are arbitrary JSON: render them in words, with names for ids. */
export function showValue(v: unknown, path: string, names: Record<string, string> = {}): string {
    if (v === undefined || v === null || v === '') return '∅';
    if (Array.isArray(v)) return v.length ? v.map((x) => showValue(x, path, names)).join(', ') : '∅';
    if (typeof v === 'string') {
        if (names[v]) return names[v];
        if (VALUE_LABELS[path]?.[v]) return VALUE_LABELS[path][v];
        // ISO dates are the most common locked value (schedule).
        if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDate(v);
        // An id we have no name for: never show the raw 24-hex string.
        if (/^[a-f0-9]{24}$/i.test(v)) return 'élément sans nom';
        return v;
    }
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    if (typeof v === 'number') return num(v);
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if ('rank' in o && 'rewardId' in o) return `${o.rank === 1 ? '1er' : `${o.rank}e`} : ${showValue(o.rewardId, path, names)}`;
        if ('label' in o && 'weight' in o) return `${o.label} (${o.weight} %)`;
        if ('label' in o && 'votes' in o && 'price' in o) return `${o.label} — ${o.votes} votes à ${xaf(Number(o.price))}`;
    }
    return JSON.stringify(v);
}

export const personLabel = (p?: { name?: string; contact?: string }) => (p?.name ? [p.name, p.contact].filter(Boolean).join(' · ') : null);

// ---------- audit ----------

export const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Organisateur', MANAGER: 'Gestionnaire', MODERATOR: 'Modérateur', STAFF: 'Staff', JURY: 'Jury',
    SBC_ADMIN: 'Admin SBC', SYSTEM: 'Système', PARTICIPANT: 'Participant', VOTER: 'Votant',
};

/** Every action event-service writes to the animation audit log (services/*.ts `audit({ action })`). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
    'challenge.create': 'Défi créé',
    'challenge.update': 'Défi modifié',
    'challenge.deadline_extended': 'Échéance prolongée',
    'challenge.transition': 'Changement de phase',
    'challenge.suspend': 'Défi suspendu',
    'challenge.resume': 'Défi repris',
    'challenge.cancel': 'Défi annulé',
    'change_request.create': 'Demande de modification',
    'change_request.reject': 'Demande refusée',
    'lock.override': 'Dérogation appliquée',
    'candidate.register': 'Inscription d’un candidat',
    'candidate.add': 'Candidat ajouté',
    'candidate.approved': 'Candidat approuvé',
    'candidate.rejected': 'Candidat refusé',
    'candidate.disqualified': 'Candidat disqualifié',
    'candidate.withdrawn': 'Candidat retiré',
    'candidate.pending': 'Candidat remis en attente',
    'package.create': 'Pack de votes créé',
    'package.update': 'Pack de votes modifié',
    'package.archive': 'Pack de votes archivé',
    'vote.refund': 'Achat de votes remboursé',
    'fraud.clear': 'Signalement classé',
    'fraud.confirm': 'Fraude confirmée',
    'result.compute': 'Résultat calculé',
    'result.freeze': 'Résultat figé',
    'result.publish': 'Résultat publié',
    'result.tie_resolved': 'Égalité départagée',
    'result.second_round': 'Second tour lancé',
    'reward.create': 'Récompense créée',
    'reward.update': 'Récompense modifiée',
    'reward.cancel': 'Récompense annulée',
    'reward.award': 'Récompense attribuée',
    'reward.draw': 'Tirage au sort',
    'reward.deliver': 'Récompense remise',
    'reward.forfeit': 'Récompense perdue',
    'reward.revoke': 'Récompense révoquée',
    'rule.create': 'Règle d’attribution créée',
    'rule.activate': 'Règle d’attribution activée',
    'team.add': 'Membre d’équipe ajouté',
    'team.revoke': 'Membre d’équipe retiré',
    'team.invite': 'Invitation équipe envoyée',
    'team.invite_revoked': 'Invitation équipe annulée',
    'team.invite_accepted': 'Invitation acceptée',
    'jury.invite': 'Invitation jury envoyée',
    'jury.invite_revoked': 'Invitation jury annulée',
    'jury.add': 'Juré ajouté',
    'jury.remove': 'Juré retiré',
    'jury.score': 'Note du jury',
};
export const auditActionLabel = (a: string) => AUDIT_ACTION_LABELS[a] ?? 'Autre action';

export const AUDIT_TARGET_LABELS: Record<string, string> = {
    candidate: 'Candidat', challenge: 'Défi', change_request: 'Demande de modification', fraud_flag: 'Signalement',
    invite: 'Invitation', jury_assignment: 'Jury', jury_score: 'Note du jury', result: 'Résultat', reward: 'Récompense',
    reward_draw: 'Tirage', reward_rule: 'Règle d’attribution', reward_winner: 'Gagnant', team_member: 'Membre d’équipe',
    vote_package: 'Pack de votes', vote_transaction: 'Achat de votes',
};

/** Flattens a before/after snapshot into [path, value] lines, for a readable view. */
export function flatten(v: unknown, prefix = '', depth = 0): Array<[string, unknown]> {
    if (v === undefined) return [];
    if (v === null || typeof v !== 'object' || Array.isArray(v) || depth >= 3) return [[prefix || 'valeur', v]];
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return [[prefix || 'valeur', '∅']];
    return entries.flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k, depth + 1));
}

// ---------- counts (tab badges, SBC Event dashboard « À traiter ») ----------

/** Open fraud flags ("À vérifier"): one row asked for, the total read. */
export const countOpenFraudFlags = async (): Promise<number> =>
    (await listFraudFlags({ status: 'OPEN', page: 1, limit: 1 })).total;

/** Change requests waiting for SBC. The route is unpaginated and capped at 200. */
export const countPendingChangeRequests = async (): Promise<number> =>
    (await listChangeRequests({ status: 'PENDING' })).length;

// ---------- page context ----------

export interface AnimPageContext {
    /** Bumped after every change: tabs reload when it moves. */
    version: number;
    refresh: () => void;
    notifySuccess: (msg: string) => void;
    notifyError: (msg: string) => void;
    /** Query-string state of the page (`tab`, `defi`, `statut`). */
    param: (key: string) => string;
    setParams: (next: Record<string, string>) => void;
}

export const AnimContext = createContext<AnimPageContext | null>(null);

export function useAnim(): AnimPageContext {
    const ctx = useContext(AnimContext);
    if (!ctx) throw new Error('useAnim must be used inside EventAnimationPage');
    return ctx;
}

/** Challenges by id (the 100 most recently updated), for names instead of ids and the pickers. */
export function useChallengeIndex() {
    const { version } = useAnim();
    const [items, setItems] = useState<AnimChallenge[]>([]);
    useEffect(() => {
        let alive = true;
        listAnimationChallenges({ limit: 100 }).then(r => { if (alive) setItems(r.items); }).catch(() => { /* names fall back to « Défi » */ });
        return () => { alive = false; };
    }, [version]);
    const byId = new Map(items.map(c => [c._id, c]));
    const events = new Map<string, string>();
    for (const c of items) if (c.eventId && !events.has(c.eventId)) events.set(c.eventId, c.event?.title ?? 'Événement');
    return {
        challenges: items,
        events: [...events].map(([id, title]) => ({ id, title })),
        challengeName: (id?: string | null) => (id ? byId.get(id)?.name ?? 'Défi' : '—'),
        eventTitle: (id?: string | null) => (id ? events.get(id) ?? 'Événement' : '—'),
    };
}

/**
 * Loads `fn()` whenever `key` changes or the page refreshes (`version`).
 * Keeps the previous data while reloading, so filters don't blank the table.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string, enabled = true) {
    const { version } = useAnim();
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const [data, setData] = useState<T | undefined>(undefined);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        setLoading(true);
        fnRef.current()
            .then(d => { if (alive) { setData(d); setError(null); } })
            .catch(e => { if (alive) setError(errorMessage(e, 'Chargement impossible.')); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [key, version, tick, enabled]);
    const reload = useCallback(() => setTick(t => t + 1), []);
    return { data, loading, error, reload };
}
