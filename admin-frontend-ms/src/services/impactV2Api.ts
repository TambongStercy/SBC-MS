import axios from 'axios';
import apiClient from '../api/apiClient';
import { fileProxyUrl, uploadChallengeVideo } from './impactChallengeApi';

/**
 * SBC Impact Challenge v2 admin API (event-service, gateway `/api/tickets/impact/admin/*`,
 * gateway module `impactChallenge`: GET = read, the rest = write).
 *
 * Contract: docs/impact-challenge/PHASE1.md. Shapes mirror
 * event-service/src/modules/impact (types.ts, models.ts, services/*).
 * Responses are `{ success: true, data }` or `{ success: false, message, code?, details? }`;
 * messages are French and are shown as they are.
 */

// ---------- Types ----------

export type EditionStatus =
    | 'DRAFT' | 'QUALIFICATION' | 'QUALIFICATION_CLOSED' | 'COMPETITION' | 'FINAL' | 'FINISHED' | 'CANCELLED';

export type CandidateStatus =
    | 'QUALIFYING' | 'WAITLIST' | 'OFFICIAL' | 'STAGE_2' | 'STAGE_3' | 'FINALIST' | 'WINNER' | 'ELIMINATED'
    | 'FINISHED' | 'NOT_SELECTED' | 'SUSPENDED' | 'DISQUALIFIED' | 'WITHDRAWN';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';

export interface VotePack { votes: number; price: number }
export interface JuryCriterion { key: string; label: string; max: number }
export interface TicketTier { upTo: number | null; weight: number }
export interface Prize { key: string; label: string; category: string }
export interface ProfileField { key: string; label: string; required: boolean; maxLength: number }

export interface EditionSettings {
    maxCandidates: number;
    invitationsRequired: number;
    waitlistSize: number;
    finalistsCount: number;
    votePrice: number;
    votePacks: VotePack[];
    weights: { paidVotes: number; publicVote: number; jury: number };
    juryCriteria: JuryCriterion[];
    ticketTiers: TicketTier[];
    prizes: Prize[];
    prizeCooldownDays: number;
    showcaseMonths: number;
    categories: string[];
    profileFields: ProfileField[];
    // Phase 2 (absent on editions created before; the server applies the defaults)
    freeVote?: { membersOnly: boolean; accountsOlderThanRound: boolean; selfVote: boolean };
    paidSelfVote?: boolean;
    balancePayment?: boolean;
    settlementGraceMin?: number;
}

export interface EditionSchedule {
    qualificationOpensAt: string;
    qualificationClosesAt: string;
    competitionStartsAt?: string | null;
    finalAt?: string | null;
}

export interface StatusChange { from: string; to: string; at: string; by?: string; reason?: string }

export interface Edition {
    _id: string;
    name: string;
    slug: string;
    description: string;
    rulesText: string;
    status: EditionStatus;
    statusHistory: StatusChange[];
    schedule: EditionSchedule;
    settings: EditionSettings;
    registrationClosedAt?: string;
    registrationClosedReason?: 'seats_full' | 'date' | 'admin' | 'full';
    seatSeq: number;
    waitlistSeq: number;
    cancellation?: { reason: string; at: string; by: string };
    createdBy?: string;
    /** Seats held now (only on `GET /admin/editions` items). */
    seatsTaken?: number;
    // Phase 2
    stage?: Stage | null;
    stageHistory?: { stage: string; at: string; by?: string }[];
    competitionStartedAt?: string | null;
    rounds?: Partial<Record<RoundKey, Round>>;
    /** Frozen at the decision; names stored since the fix of 2026-11-23 (older ones may lack them). */
    top3?: {
        decidedAt: string;
        by?: string;
        ranking: {
            candidateId: string; rank: number; paidVotes: number; lastPaidAt?: string | null; finalist: boolean;
            name?: string | null; projectName?: string | null; seatNumber?: number | null; paidAmount?: number | null; freeVotes?: number | null;
        }[];
    } | null;
    // Phase 3
    jury?: { lockedAt?: string | null; lockedBy?: string | null } | null;
    live?: { onStageCandidateId: string | null; phase: LivePhase | null; startedAt?: string; updatedAt?: string } | null;
    result?: FinalResult | null;
    createdAt: string;
    updatedAt: string;
}

export interface CandidateProfile {
    name: string;
    photoFileId: string;
    country: string;
    city: string;
    activity: string;
    category: string;
    projectName: string;
    projectDescription: string;
    presentation: string;
    link?: string;
    extra: Record<string, string>;
}

export interface Candidate {
    _id: string;
    editionId: string;
    userId: string;
    sbcId: string | null;
    profile: CandidateProfile;
    status: CandidateStatus;
    statusLabel: string;
    suspendedFrom: CandidateStatus | null;
    invitations: { valid: number; pending: number; required: number; reachedAt: string | null; checkedAt: string | null };
    seatNumber: number | null;
    seatAt: string | null;
    waitlistRank: number | null;
    review: { status: ReviewStatus; reason?: string; at?: string };
    profileUpdatedAt: string;
    statusHistory: StatusChange[];
    // Phase 2
    votes?: { free: number; paid: number; paidAmount: number };
    rank?: number | null;
    publishedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type CandidateRow = Candidate & { belowRequirement: boolean };

export interface CandidateList {
    items: CandidateRow[];
    total: number;
    page: number;
    limit: number;
    /** Count per status over the whole edition (not filtered). */
    byStatus: Partial<Record<CandidateStatus, number>>;
    /** Seat holders below the requirement, whole edition (not filtered). */
    belowRequirementCount: number;
    seats: { taken: number; max: number };
}

export interface AuditEntry {
    _id: string;
    editionId?: string;
    candidateId?: string;
    actorUserId: string | null;
    /** Admins only; null when unknown. */
    actorName?: string | null;
    actorRole: 'admin' | 'member' | 'system';
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    at: string;
}

export interface CandidateDetails {
    candidate: Candidate;
    edition: { _id: string; name: string; status: EditionStatus };
    audit: AuditEntry[];
}

export interface CreateEditionInput {
    name: string;
    description?: string;
    rulesText?: string;
    schedule: { qualificationOpensAt: string; qualificationClosesAt: string; competitionStartsAt?: string; finalAt?: string };
    settings?: Partial<EditionSettings>;
}

/** Only the parts that changed; settings are merged server-side, then validated whole. */
export interface UpdateEditionInput {
    name?: string;
    description?: string;
    rulesText?: string;
    schedule?: Partial<Record<keyof EditionSchedule, string | null>>;
    settings?: Partial<EditionSettings>;
}

export interface CandidateQuery {
    status?: CandidateStatus | '';
    review?: ReviewStatus | '';
    q?: string;
    /** Only seat holders below the requirement. */
    below?: boolean;
    page?: number;
    limit?: number;
}

// ---------- Errors ----------

export interface ImpactApiError {
    message: string;
    code?: string;
    status?: number;
    /** `details.field` / `details.fields` of the answer, as a list. */
    fields: string[];
    /** The answer's `details`, as sent (PROFILES_TO_REVIEW candidates, TOP 3 blockers…). */
    details?: Record<string, unknown>;
}

/** The backend's own answer to a failed call (code, French message, fields). */
export function readImpactError(err: unknown, fallback = 'L’action a échoué.'): ImpactApiError {
    if (axios.isAxiosError(err)) {
        const data = (err.response?.data ?? {}) as { message?: string; code?: string; details?: { field?: string; fields?: string[]; [k: string]: unknown } };
        const fields = Array.isArray(data.details?.fields)
            ? data.details!.fields!.map(String)
            : data.details?.field ? [String(data.details.field)] : [];
        const message = data.message || (err.response ? fallback : 'Le serveur ne répond pas. Vérifiez la connexion, puis réessayez.');
        return { message, code: data.code, status: err.response?.status, fields, ...(data.details ? { details: data.details } : {}) };
    }
    if (err instanceof Error && err.message) return { message: err.message, fields: [] };
    return { message: fallback, fields: [] };
}

/** A sentence to show: the backend's message, plus the locked fields for RULES_LOCKED. */
export function impactErrorMessage(err: unknown, fallback = 'L’action a échoué.'): string {
    const e = readImpactError(err, fallback);
    if (e.code === 'RULES_LOCKED' && e.fields.length) {
        return `${e.message} (${e.fields.map(fieldLabel).join(', ')})`;
    }
    return e.message;
}

/** Thrown by the calls below when the answer says `success: false` with a 2xx. */
const unwrap = <T>(res: { data: { success?: boolean; data?: T; message?: string } }, fallback: string): T => {
    if (!res.data?.success) throw new Error(res.data?.message || fallback);
    return res.data.data as T;
};

const BASE = '/tickets/impact/admin';

// ---------- Editions ----------

export const listEditions = async (): Promise<Edition[]> =>
    unwrap(await apiClient.get(`${BASE}/editions`), 'Impossible de charger les éditions.') ?? [];

export const getEdition = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}`), 'Impossible de charger l’édition.');

export const createEdition = async (input: CreateEditionInput): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions`, input), 'L’édition n’a pas pu être créée.');

export const updateEdition = async (id: string, input: UpdateEditionInput): Promise<Edition> =>
    unwrap(await apiClient.patch(`${BASE}/editions/${id}`, input), 'L’édition n’a pas pu être enregistrée.');

export const openQualification = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/open-qualification`), 'La qualification n’a pas pu être ouverte.');

export const closeQualification = async (id: string, reason: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/close-qualification`, { reason }), 'La qualification n’a pas pu être close.');

export const cancelEdition = async (id: string, reason: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/cancel`, { reason }), 'L’édition n’a pas pu être annulée.');

export const recountEdition = async (id: string): Promise<{ updated: number }> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/recount`), 'Le recomptage a échoué.');

export const listCandidates = async (editionId: string, q: CandidateQuery = {}): Promise<CandidateList> => {
    const params: Record<string, string | number> = {};
    if (q.status) params.status = q.status;
    if (q.review) params.review = q.review;
    if (q.q?.trim()) params.q = q.q.trim();
    if (q.below) params.below = 1;
    if (q.page) params.page = q.page;
    if (q.limit) params.limit = q.limit;
    return unwrap(await apiClient.get(`${BASE}/editions/${editionId}/candidates`, { params }), 'Impossible de charger les candidats.');
};

/** Newest first. The cursor is the last entry shown: its `at` (`before`) and `_id` (`beforeId`). */
export const listEditionAudit = async (editionId: string, opts: { limit?: number; before?: string; beforeId?: string } = {}): Promise<AuditEntry[]> =>
    unwrap(await apiClient.get(`${BASE}/editions/${editionId}/audit`, { params: opts }), 'Impossible de charger le journal.') ?? [];

// ---------- Candidates ----------

export const getCandidate = async (id: string): Promise<CandidateDetails> =>
    unwrap(await apiClient.get(`${BASE}/candidates/${id}`), 'Impossible de charger le candidat.');

export const reviewCandidate = async (
    id: string,
    body: { decision: 'approve' | 'changes'; reason?: string; profileUpdatedAt?: string },
): Promise<Candidate> =>
    unwrap(await apiClient.post(`${BASE}/candidates/${id}/review`, body), 'La décision n’a pas pu être enregistrée.');

export const editCandidateProfile = async (
    id: string,
    body: { profile: Partial<CandidateProfile>; reason: string; profileUpdatedAt?: string },
): Promise<Candidate> =>
    unwrap(await apiClient.patch(`${BASE}/candidates/${id}`, body), 'Le profil n’a pas pu être modifié.');

export const suspendCandidate = async (id: string, reason: string): Promise<Candidate> =>
    unwrap(await apiClient.post(`${BASE}/candidates/${id}/suspend`, { reason }), 'La suspension a échoué.');

export const reinstateCandidate = async (id: string, reason: string): Promise<Candidate> =>
    unwrap(await apiClient.post(`${BASE}/candidates/${id}/reinstate`, { reason }), 'Le rétablissement a échoué.');

export const disqualifyCandidate = async (id: string, reason: string): Promise<Candidate> =>
    unwrap(await apiClient.post(`${BASE}/candidates/${id}/disqualify`, { reason }), 'La disqualification a échoué.');

/** « Ajouter » (qualification only): the member still needs the invitations. */
export const addCandidate = async (
    editionId: string,
    body: Omit<CandidateProfile, 'extra'> & { extra?: Record<string, string>; userId: string; consent: true },
): Promise<Candidate> =>
    unwrap(await apiClient.post(`${BASE}/editions/${editionId}/candidates`, body), 'Le candidat n’a pas pu être ajouté.');

// ---------- Labels ----------

export const EDITION_STATUS_LABELS: Record<EditionStatus, string> = {
    DRAFT: 'En préparation',
    QUALIFICATION: 'Qualification en cours',
    QUALIFICATION_CLOSED: 'Qualification terminée',
    COMPETITION: 'Compétition',
    FINAL: 'Finale',
    FINISHED: 'Terminée',
    CANCELLED: 'Annulée',
};

/** Same words as the backend's `statusLabel` (types.ts STATUS_LABEL_FR). */
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
    QUALIFYING: 'En qualification',
    WAITLIST: 'Liste d’attente',
    OFFICIAL: 'Candidat officiel',
    STAGE_2: 'Étape 2',
    STAGE_3: 'Étape 3',
    FINALIST: 'Finaliste',
    WINNER: 'Gagnant',
    ELIMINATED: 'Éliminé',
    FINISHED: 'Challenge terminé',
    NOT_SELECTED: 'Inscriptions fermées',
    SUSPENDED: 'Suspendu',
    DISQUALIFIED: 'Disqualifié',
    WITHDRAWN: 'Retiré',
};

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
    PENDING: 'Profil à vérifier',
    APPROVED: 'Candidature validée',
    CHANGES_REQUESTED: 'Modifications demandées',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
    'edition.created': 'Édition créée',
    'edition.updated': 'Édition modifiée',
    'edition.qualification_opened': 'Qualification ouverte',
    'edition.close_requested': 'Clôture demandée',
    'edition.qualification_closed': 'Qualification terminée',
    'edition.seats_full': 'Places toutes prises',
    'edition.cancelled': 'Édition annulée',
    'edition.recounted': 'Invitations recomptées',
    'candidate.applied': 'Candidature déposée',
    'candidate.added_by_admin': 'Candidat ajouté par l’administration',
    'candidate.profile_updated': 'Profil modifié par le candidat',
    'candidate.profile_edited_by_admin': 'Profil modifié par l’administration',
    'candidate.profile_approved': 'Profil validé',
    'candidate.changes_requested': 'Modifications demandées',
    'candidate.official': 'Devenu candidat officiel',
    'candidate.waitlisted': 'Placé en liste d’attente',
    'candidate.promoted': 'Promu de la liste d’attente',
    'candidate.not_selected': 'Non retenu (inscriptions fermées)',
    'candidate.suspended': 'Candidat suspendu',
    'candidate.reinstated': 'Candidat rétabli',
    'candidate.disqualified': 'Candidat disqualifié',
    'candidate.withdrawn': 'Candidature retirée',
    // Phase 2
    'edition.competition_started': 'Compétition lancée (profils publiés)',
    'edition.stage_advanced': 'Passage à l’étape suivante',
    'edition.top3_decided': 'TOP 3 désigné',
    'round.scheduled': 'Dates du vote programmées',
    'round.opened': 'Vote ouvert',
    'round.closed': 'Vote clos',
    'submission.video_submitted': 'Vidéo déposée',
    'submission.project_submitted': 'Projet déposé',
    'submission.accept': 'Contenu validé et publié',
    'submission.reject': 'Contenu refusé',
    'submission.resubmit': 'Nouvelle version demandée',
    'submission.external_url': 'Lien de publication modifié',
    'vote.purchase_started': 'Achat de votes lancé',
    'vote.late_refund': 'Paiement tardif remboursé',
    'vote.refunded_by_admin': 'Achat remboursé par l’administration',
    // Phase 3
    'jury.juror_added': 'Juré ajouté',
    'jury.juror_removed': 'Juré retiré',
    'jury.score_saved': 'Note du jury enregistrée',
    'jury.score_updated': 'Note du jury corrigée',
    'jury.locked': 'Notes du jury verrouillées',
    'final.started': 'Finale démarrée',
    'final.on_stage': 'Passage sur scène',
    'final.result_published': 'Résultat publié',
    // Phase 4
    'tombola.committed': 'Graine de la tombola fixée',
    'tombola.drawn': 'Tirage de la tombola effectué',
    'tombola.revealed': 'Gagnant de la tombola affiché',
    'tombola.prize_status': 'Statut d’un lot de la tombola',
    // Phase 5
    'showcase.created': 'Pages SBC Impact créées',
    'showcase.edited': 'Page SBC Impact modifiée',
    'showcase.update_proposed': 'Nouvelle proposée par un finaliste',
    'showcase.update_published': 'Nouvelle publiée par l’administration',
    'showcase.update_approve': 'Nouvelle d’un finaliste publiée',
    'showcase.update_reject': 'Nouvelle d’un finaliste refusée',
    'showcase.update_remove': 'Nouvelle retirée',
};

export const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;

/** Who did it: the admin's name when known, else the role. */
export const actorLabel = (a: Pick<AuditEntry, 'actorName' | 'actorRole'>) => a.actorName || ACTOR_ROLE_LABELS[a.actorRole] || a.actorRole;

export const ACTOR_ROLE_LABELS: Record<AuditEntry['actorRole'], string> = {
    admin: 'Administration',
    member: 'Membre',
    system: 'Système',
};

export const CLOSED_REASON_LABELS: Record<NonNullable<Edition['registrationClosedReason']>, string> = {
    seats_full: 'toutes les places sont prises',
    date: 'la date de fin est passée',
    admin: 'close par l’administration',
    full: 'places et liste d’attente complètes',
};

const FIELD_LABELS: Record<string, string> = {
    name: 'nom',
    description: 'description',
    rulesText: 'règlement',
    weights: 'pondération',
    'schedule.qualificationOpensAt': 'ouverture de la qualification',
    'schedule.qualificationClosesAt': 'fin de la qualification',
    'schedule.competitionStartsAt': 'début de la compétition',
    'schedule.finalAt': 'finale',
    qualificationOpensAt: 'ouverture de la qualification',
    qualificationClosesAt: 'fin de la qualification',
    competitionStartsAt: 'début de la compétition',
    finalAt: 'finale',
    maxCandidates: 'nombre de candidats',
    invitationsRequired: 'invitations requises',
    waitlistSize: 'liste d’attente',
    finalistsCount: 'nombre de finalistes',
    votePrice: 'prix d’un vote',
    votePacks: 'packs de votes',
    juryCriteria: 'critères du jury',
    ticketTiers: 'paliers de tickets',
    prizes: 'lots',
    prizeCooldownDays: 'délai entre deux gains',
    showcaseMonths: 'durée SBC Impact',
    categories: 'catégories',
    profileFields: 'questions du profil',
    freeVote: 'règles du vote gratuit',
    paidSelfVote: 'vote payant pour soi-même',
    balancePayment: 'paiement par le solde SBC',
    settlementGraceMin: 'délai de confirmation des paiements',
    'rounds.FREE.opensAt': 'ouverture du vote gratuit',
    'rounds.FREE.closesAt': 'fin du vote gratuit',
    'rounds.PAID.opensAt': 'ouverture des votes payants',
    'rounds.PAID.closesAt': 'fin des votes payants',
    'rounds.FINAL.opensAt': 'ouverture du vote public de la finale',
    'rounds.FINAL.closesAt': 'fin du vote public de la finale',
};

/** "settings.maxCandidates" → "nombre de candidats" (unknown keys as they are). */
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? FIELD_LABELS[field.replace(/^settings\./, '')] ?? field;

// ---------- Locks (PHASE1.md « Locks », event-service edition.service updateEdition) ----------

const RANK: EditionStatus[] = ['DRAFT', 'QUALIFICATION', 'QUALIFICATION_CLOSED', 'COMPETITION', 'FINAL', 'FINISHED'];
/** Position in the life of an edition (-1 = cancelled). */
export const editionRank = (s: EditionStatus) => RANK.indexOf(s);

export const QUALIFICATION_LOCKED = ['maxCandidates', 'invitationsRequired', 'waitlistSize', 'categories', 'profileFields'] as const;
export const COMPETITION_LOCKED = [
    'finalistsCount', 'votePrice', 'votePacks', 'weights', 'juryCriteria', 'ticketTiers', 'prizeCooldownDays', 'showcaseMonths',
    'freeVote', 'paidSelfVote', 'balancePayment', 'settlementGraceMin',
] as const;

export type LockableField =
    | 'rulesText' | 'qualificationOpensAt' | 'qualificationClosesAt' | 'competitionStartsAt'
    | (typeof QUALIFICATION_LOCKED)[number] | (typeof COMPETITION_LOCKED)[number];

/** Nothing can change any more (the backend answers EDITION_CLOSED). */
export const isEditionClosed = (s: EditionStatus) => s === 'CANCELLED' || s === 'FINISHED';

/**
 * Why a field cannot change for this status, or null when it can. Qualification
 * rules freeze when qualification opens; competition rules when the competition
 * starts. Name, description, final date and prizes are never locked by status.
 */
export function lockReason(status: EditionStatus, field: LockableField): string | null {
    if (isEditionClosed(status)) return 'Cette édition est terminée : plus rien n’est modifiable.';
    const rank = editionRank(status);
    const qualificationLocked = field === 'rulesText' || field === 'qualificationOpensAt' || field === 'qualificationClosesAt'
        || (QUALIFICATION_LOCKED as readonly string[]).includes(field);
    if (qualificationLocked && rank >= 1) return 'Verrouillé depuis l’ouverture de la qualification (règles publiées).';
    const competitionLocked = field === 'competitionStartsAt' || (COMPETITION_LOCKED as readonly string[]).includes(field);
    if (competitionLocked && rank >= 3) return 'Verrouillé depuis le début de la compétition.';
    return null;
}

/** Minimum length of the public rules before qualification can open. */
export const RULES_MIN_LENGTH = 200;

// ---------- Dates (datetime-local ⇄ ISO, in the admin's local time) ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → "2026-12-01T09:00" in local time ('' when empty or invalid). */
export function toLocalInput(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-12-01T09:00" read as local time → ISO ('' stays '' so optional dates can be cleared). */
export function fromLocalInput(value: string): string {
    if (!value) return '';
    // new Date('YYYY-MM-DDTHH:mm') is local time (date-only strings would be UTC)
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// ---------- Photos ----------

/**
 * A candidate's photo (`photoFileId`, an R2 key from settings-service) through
 * our own origin (`/api/settings/files/<id>`, behind Cloudflare), the same proxy
 * the v1 Impact Challenge uses for its videos (`fileProxyUrl`). `width` asks the
 * proxy for a WebP resize (16–1024 px), so the list loads small thumbnails.
 */
export function photoUrl(fileId?: string | null, width?: number): string {
    if (!fileId) return '';
    if (/^https?:\/\//i.test(fileId)) return fileId;
    return `${fileProxyUrl(fileId)}${width ? `?w=${width}` : ''}`;
}

// =====================================================================
// Phase 2: weeks 1–3, contents, votes, TOP 3 (docs/impact-challenge/PHASE2.md)
// =====================================================================

export type Stage = 'WEEK1' | 'WEEK2' | 'WEEK3' | 'TOP3' | 'LIVE' | 'RESULT';
export type RoundKey = 'FREE' | 'PAID' | 'FINAL';
export type RoundStatus = 'SCHEDULED' | 'OPEN' | 'CLOSED';

export interface Round {
    status: RoundStatus;
    opensAt?: string | null;
    closesAt?: string | null;
    openedAt?: string | null;
    closedAt?: string | null;
}

/** The stage a round belongs to: it opens only then (backend ROUND_STAGE). */
export const ROUND_STAGE: Record<RoundKey, Stage> = { FREE: 'WEEK2', PAID: 'WEEK3', FINAL: 'LIVE' };
/** A round as stored, or a scheduled one without dates (editions created before it existed). */
export const roundOf = (e: Edition, k: RoundKey): Round => e.rounds?.[k] ?? { status: 'SCHEDULED' };

/** …and the edition status it runs in (backend ROUND_EDITION_STATUS). */
export const ROUND_EDITION_STATUS: Record<RoundKey, EditionStatus> = { FREE: 'COMPETITION', PAID: 'COMPETITION', FINAL: 'FINAL' };

export type SubmissionKind = 'VIDEO' | 'PROJECT';
export type SubmissionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'RESUBMIT_REQUESTED';

export interface ProjectContent {
    problem: string; solution: string; howItWorks: string; targetCustomers: string;
    businessModel: string; expectedImpact: string; fundingUse: string; outlook: string;
    videoFileId?: string;
}

export interface Submission {
    _id: string;
    candidateId: string;
    kind: SubmissionKind;
    version: number;
    status: SubmissionStatus;
    video?: { videoFileId: string; caption?: string };
    project?: ProjectContent;
    review: { reason: string | null; at: string } | null;
    publishedAt: string | null;
    externalUrl: string | null;
    createdAt: string;
    updatedAt: string;
}

export type SubmissionRow = Submission & {
    candidate: { name: string; projectName: string; photoFileId: string; seatNumber?: number; status: CandidateStatus } | null;
};

export type PurchaseStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type PayMethod = 'MOBILE_MONEY' | 'BALANCE';

export interface Purchase {
    _id: string;
    candidateId: string;
    votes: number;
    amount: number;
    method: PayMethod;
    status: PurchaseStatus;
    /** The votes are in the candidate's total. */
    counted: boolean;
    /** Paid too late (or refunded by the administration): never counted. */
    lateSettlement: boolean;
    paymentSessionId: string | null;
    /** Set once a refund started; `at` once it is done. */
    refund: { reason: string; at: string | null } | null;
    createdAt: string;
    settledAt: string | null;
}

export type PurchaseRow = Purchase & {
    userId: string;
    buyerName: string | null;
    candidateName: string | null;
    flags: string[];
    refundUncertain: boolean;
    providerStatus: string | null;
};

export interface PurchaseList {
    items: PurchaseRow[];
    total: number;
    page: number;
    limit: number;
    totals: {
        byStatus: Partial<Record<PurchaseStatus, { count: number; amount: number; votes: number; countedVotes: number }>>;
        revenue: number;
        countedVotes: number;
        /** Purchases whose refund could not be confirmed (whole edition, not filtered). */
        uncertainRefunds: number;
    };
}

export interface FreeVoteRow { _id: string; candidateId: string; candidateName: string | null; voterUserId: string; voterName: string | null; at: string }
export interface FreeVoteList { items: FreeVoteRow[]; total: number; page: number; limit: number }

type AnomalyBuyer = { userId: string; buyerName: string | null; candidateName: string | null };

export interface Anomalies {
    freeVotes: {
        sharedNetworks: { network: string; voters: number; candidates: number }[];
        sharedDevices: { device: string; voters: number }[];
        bursts: { candidateId: string; candidateName: string | null; at: string; votes: number }[];
    };
    paidVotes: {
        topBuyers: { userId: string; name: string | null; amount: number; votes: number; purchases: number; candidates: number }[];
        flagged: (Purchase & AnomalyBuyer & { flags: string[]; providerStatus: string | null })[];
        uncertainRefunds: (Purchase & AnomalyBuyer)[];
    };
}

export interface Top3Row {
    candidateId: string;
    /** May be null on a podium frozen before names were stored. */
    name: string | null;
    projectName: string | null;
    seatNumber?: number | null;
    status: CandidateStatus;
    paidVotes: number;
    paidAmount: number | null;
    freeVotes: number | null;
    /** When the candidate reached their total (time of their last counted vote): breaks ties. */
    lastPaidAt: string | null;
    rank: number;
    finalist: boolean;
}

export interface Top3Preview {
    ranking: Top3Row[];
    finalistsCount: number;
    tieAtCut: boolean;
    /** `until` (PAYMENTS_SETTLING): when the confirmation delay ends. */
    blockers: { code: string; message: string; until?: string }[];
    flaggedPurchases: number;
    decided: boolean;
    decidedAt?: string | null;
}

// ---------- Calls ----------

export const launchCompetition = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/launch-competition`), 'La compétition n’a pas pu être lancée.');

export const advanceStage = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/advance-stage`), 'L’étape suivante n’a pas pu commencer.');

export const scheduleRound = async (id: string, key: RoundKey, body: { opensAt: string; closesAt: string }): Promise<Edition> =>
    unwrap(await apiClient.put(`${BASE}/editions/${id}/rounds/${key}`, body), 'Les dates du vote n’ont pas pu être enregistrées.');

export const openRoundNow = async (id: string, key: RoundKey): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/rounds/${key}/open`), 'Le vote n’a pas pu être ouvert.');

export const closeRoundNow = async (id: string, key: RoundKey, reason: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/rounds/${key}/close`, { reason }), 'Le vote n’a pas pu être clos.');

/**
 * The ranking (a plain read), or the frozen podium once decided. `recount`
 * recounts the votes from the ledgers first (« Recompter »); the decision
 * always recounts on the server.
 */
export const getTop3 = async (id: string, opts: { recount?: boolean } = {}): Promise<Top3Preview> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/top3`, opts.recount ? { params: { recount: 1 } } : undefined), 'Impossible de charger le classement.');

/** Needs the admin's code (the apiClient interceptor asks for it). `expectedOrder` = the ids in the order shown. */
export const decideTop3 = async (id: string, expectedOrder: string[]): Promise<{ edition: Edition; ranking: Top3Row[] }> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/top3`, { expectedOrder }), 'Le TOP 3 n’a pas pu être désigné.');

export const listSubmissions = async (id: string, q: { kind?: SubmissionKind | ''; status?: SubmissionStatus | '' } = {}): Promise<SubmissionRow[]> => {
    const params: Record<string, string> = {};
    if (q.kind) params.kind = q.kind;
    if (q.status) params.status = q.status;
    return unwrap(await apiClient.get(`${BASE}/editions/${id}/submissions`, { params }), 'Impossible de charger les contenus.') ?? [];
};

export const reviewSubmission = async (
    id: string,
    body: { decision: 'accept' | 'reject' | 'resubmit'; reason?: string; updatedAt?: string },
): Promise<Submission> =>
    unwrap(await apiClient.post(`${BASE}/submissions/${id}/review`, body), 'La décision n’a pas pu être enregistrée.');

/** https, or '' to remove the link. */
export const setSubmissionExternalUrl = async (id: string, externalUrl: string): Promise<Submission> =>
    unwrap(await apiClient.patch(`${BASE}/submissions/${id}`, { externalUrl }), 'Le lien n’a pas pu être enregistré.');

export const listFreeVotes = async (id: string, q: { candidateId?: string; page?: number; limit?: number } = {}): Promise<FreeVoteList> => {
    const params: Record<string, string | number> = {};
    if (q.candidateId) params.candidateId = q.candidateId;
    if (q.page) params.page = q.page;
    if (q.limit) params.limit = q.limit;
    return unwrap(await apiClient.get(`${BASE}/editions/${id}/free-votes`, { params }), 'Impossible de charger les votes gratuits.');
};

export interface PurchaseQuery {
    status?: PurchaseStatus | '';
    method?: PayMethod | '';
    candidateId?: string;
    flagged?: boolean;
    refundUncertain?: boolean;
    page?: number;
    limit?: number;
}

export const listPurchases = async (id: string, q: PurchaseQuery = {}): Promise<PurchaseList> => {
    const params: Record<string, string | number> = {};
    if (q.status) params.status = q.status;
    if (q.method) params.method = q.method;
    if (q.candidateId) params.candidateId = q.candidateId;
    if (q.flagged) params.flagged = 1;
    if (q.refundUncertain) params.refundUncertain = 1;
    if (q.page) params.page = q.page;
    if (q.limit) params.limit = q.limit;
    return unwrap(await apiClient.get(`${BASE}/editions/${id}/purchases`, { params }), 'Impossible de charger les achats de votes.');
};

/** Needs the admin's code (the apiClient interceptor asks for it). The buyer reads `reason`. */
export const refundPurchase = async (purchaseId: string, reason: string): Promise<Purchase & { refundCompleted: boolean }> =>
    unwrap(await apiClient.post(`${BASE}/purchases/${purchaseId}/refund`, { reason }), 'Le remboursement a échoué.');

export const getAnomalies = async (id: string): Promise<Anomalies> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/anomalies`), 'Impossible de charger les anomalies.');

/** Reads a JSON error sent back as a Blob (responseType: 'blob'). */
async function blobError(err: unknown, fallback: string): Promise<Error> {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (data instanceof Blob) {
        try {
            const body = JSON.parse(await data.text());
            if (typeof body?.message === 'string') return new Error(body.message);
        } catch { /* not JSON */ }
    }
    return new Error(impactErrorMessage(err, fallback));
}

/** The official candidates as CSV, downloaded through apiClient (admin token attached). */
export async function downloadCandidatesCsv(id: string): Promise<void> {
    let res;
    try {
        res = await apiClient.get(`${BASE}/editions/${id}/candidates.csv`, { responseType: 'blob' });
    } catch (err) {
        throw await blobError(err, 'L’export n’a pas pu être téléchargé.');
    }
    const disposition = String(res.headers?.['content-disposition'] ?? '');
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : 'candidats-sbc-impact.csv';
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Labels ----------

export const STAGE_LABELS: Record<Stage, string> = {
    WEEK1: 'Semaine 1 · Présentation',
    WEEK2: 'Semaine 2 · Vidéo et vote gratuit',
    WEEK3: 'Semaine 3 · Projet et votes payants',
    TOP3: 'TOP 3 · Préparation de la finale',
    LIVE: 'Finale en direct',
    RESULT: 'Résultat publié',
};

export const ROUND_LABELS: Record<RoundKey, string> = { FREE: 'Vote gratuit', PAID: 'Votes payants', FINAL: 'Vote public de la finale' };
export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = { SCHEDULED: 'Programmé', OPEN: 'Ouvert', CLOSED: 'Clos' };

export const SUBMISSION_KIND_LABELS: Record<SubmissionKind, string> = { VIDEO: 'Vidéo « Ma vision de SBC »', PROJECT: 'Présentation du projet' };
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
    PENDING: 'À valider',
    ACCEPTED: 'Validé et publié',
    REJECTED: 'Refusé',
    RESUBMIT_REQUESTED: 'Nouvelle version demandée',
};

/** The 8 headings of the project presentation (spec §7), in order, worded as the backend's. */
export const PROJECT_HEADINGS: [keyof Omit<ProjectContent, 'videoFileId'>, string][] = [
    ['problem', 'Le problème'],
    ['solution', 'La solution'],
    ['howItWorks', 'Le fonctionnement'],
    ['targetCustomers', 'La clientèle cible'],
    ['businessModel', 'Le modèle économique'],
    ['expectedImpact', 'L’impact attendu'],
    ['fundingUse', 'L’utilisation d’un éventuel financement'],
    ['outlook', 'Les perspectives de développement'],
];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
    PENDING: 'En attente',
    SUCCESS: 'Payé',
    FAILED: 'Échoué',
    CANCELLED: 'Annulé',
    REFUNDED: 'Remboursé',
};

export const PAY_METHOD_LABELS: Record<PayMethod, string> = { MOBILE_MONEY: 'Mobile Money', BALANCE: 'Solde SBC' };

const FLAG_LABELS: Record<string, string> = {
    AMOUNT_MISMATCH: 'Montant payé différent',
};
export const flagLabel = (f: string) => FLAG_LABELS[f] ?? f;

// =====================================================================
// Phase 3: the live final, the jury, the result (docs/impact-challenge/PHASE3.md)
// =====================================================================

export type LivePhase = 'PRESENTATION' | 'QUESTIONS' | 'SCORING';

export const LIVE_PHASE_LABELS: Record<LivePhase, string> = {
    PRESENTATION: 'Présentation',
    QUESTIONS: 'Questions',
    SCORING: 'Notation',
};

/** `GET /admin/members/lookup`: one account by e-mail or phone (contact masked). */
export interface MemberLookup {
    found: boolean;
    /** Several accounts share this number: search by e-mail. */
    ambiguous?: boolean;
    userId?: string;
    name?: string;
    avatar?: string;
    contactHint?: string;
}

export interface JuryCriterionDef { key: string; label: string; max: number }

export interface JurorRow {
    _id: string;
    userId: string;
    name: string;
    addedAt: string;
    removedAt: string | null;
    /** Finalists this juror has marked. */
    scored: number;
    scores: { candidateId: string; total: number; updatedAt: string; edits: number }[];
}

export interface JuryOverview {
    lockedAt: string | null;
    criteria: JuryCriterionDef[];
    maxTotal: number;
    finalists: { _id: string; name: string }[];
    jurors: JurorRow[];
}

export interface JuryScoreDetail {
    candidateId: string;
    jurorUserId: string;
    jurorName: string | null;
    jurorRemoved: boolean;
    scores: Record<string, number>;
    total: number;
    comment: string | null;
    updatedAt: string;
    /** Earlier versions, oldest first. */
    history: { scores: Record<string, number>; total: number; comment?: string; at: string }[];
}

export interface FinalResultRow {
    candidateId: string;
    name: string;
    projectName: string;
    paidVotes: number;
    finalVotes: number;
    juryAverage: number;
    juryMax: number;
    jurorsCount: number;
    /** Each part on 0–100 (the best finalist of the part = 100). */
    components: { paidVotes: number; publicVote: number; jury: number };
    score: number;
    rank: number;
}

export interface FinalResult {
    publishedAt: string;
    by?: string;
    weights: { paidVotes: number; publicVote: number; jury: number };
    rows: FinalResultRow[];
    winnerCandidateId: string;
}

export interface MissingScore { candidateId: string; name: string; scoredBy: number; notScoredBy: string[] }

export type ResultPreview =
    | {
        published: false;
        weights: { paidVotes: number; publicVote: number; jury: number };
        rows: FinalResultRow[];
        missing: MissingScore[];
        blockers: { code: string; message: string; details?: unknown }[];
        warnings: string[];
        formula: string;
    }
    | { published: true; result: FinalResult; formula: string };

// ---------- Calls ----------

export const lookupMember = async (contact: string): Promise<MemberLookup> =>
    unwrap(await apiClient.get(`${BASE}/members/lookup`, { params: { contact } }), 'La recherche du membre a échoué.');

export const getJury = async (id: string): Promise<JuryOverview> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/jury`), 'Impossible de charger le jury.');

export const getJuryScores = async (id: string): Promise<JuryScoreDetail[]> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/jury/scores`), 'Impossible de charger les notes.') ?? [];

export const addJuror = async (id: string, userId: string): Promise<{ _id: string; userId: string; name: string }> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/jury`, { userId }), 'Le juré n’a pas pu être ajouté.');

export const removeJuror = async (id: string, jurorId: string, reason: string): Promise<unknown> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/jury/${jurorId}/remove`, { reason }), 'Le juré n’a pas pu être retiré.');

export const startFinal = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/final/start`), 'La finale n’a pas pu démarrer.');

/** Who is on stage (null = nobody) and what is happening. */
export const setOnStage = async (id: string, candidateId: string | null, phase?: LivePhase | null): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/final/on-stage`, { candidateId, ...(phase ? { phase } : {}) }), 'Le passage sur scène n’a pas pu être enregistré.');

export const lockJury = async (id: string): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/jury/lock`), 'Les notes n’ont pas pu être verrouillées.');

export const getResult = async (id: string): Promise<ResultPreview> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/result`), 'Impossible de calculer le résultat.');

/** Needs the admin's code (the apiClient interceptor asks for it). `expectedOrder` = the ids in the order shown. */
export const publishResult = async (id: string, expectedOrder: string[]): Promise<Edition> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/result`, { expectedOrder }), 'Le résultat n’a pas pu être publié.');

// ---------- The member app ----------

/**
 * The member app's address (VITE_MEMBER_APP_URL; the production site by
 * default). The live screen of the final is its `/impact-challenge/finale` page.
 */
export const MEMBER_APP_URL = String(import.meta.env.VITE_MEMBER_APP_URL || 'https://sniperbuisnesscenter.com').replace(/\/+$/, '');
export const liveScreenUrl = () => `${MEMBER_APP_URL}/impact-challenge/finale`;

// =====================================================================
// Phase 4: SBC Tombola (docs/impact-challenge/PHASE4.md)
// Not the monthly tombola of tombola-service (/tombola in this admin).
// =====================================================================

export type PrizeStatus = 'PENDING' | 'DELIVERED' | 'FORFEITED' | 'NOT_AWARDED';

export interface TombolaWinner {
    order: number;
    prizeKey: string;
    prizeLabel: string;
    category: string;
    /** null when no holder was left for this prize (NOT_AWARDED). */
    ticketNumber: number | null;
    /** « Awa N. » */
    displayName: string | null;
    status: PrizeStatus;
    // administration only
    userId?: string | null;
    holderHash?: string | null;
    /** Draws needed for this prize (bias-free rejection sampling). */
    attempts?: number;
    statusNote?: string | null;
    statusAt?: string | null;
}

export interface TombolaDraw {
    _id: string;
    editionId: string;
    status: 'COMMITTED' | 'DONE';
    /** sha256(seed), public from the commitment on. */
    seedCommitment: string;
    committedAt: string;
    /** The seed was fixed while the paid votes were open (the guarantee). */
    committedBeforeTicketsClosed: boolean;
    /** Revealed once drawn (null in the admin overview: read it from the proof). */
    seed: string | null;
    drawnAt: string | null;
    prizes: { key: string; label: string; category: string }[];
    totalTickets: number | null;
    participants: number | null;
    segmentsHash: string | null;
    revealedCount: number;
    winnersCount: number;
    winners: TombolaWinner[];
}

export interface TombolaOverview {
    draw: TombolaDraw | null;
    tickets: {
        totalTickets: number;
        participants: number;
        totalWeight: number;
        weightScale: number;
        topHolders: { userId: string; name: string | null; tickets: number; sharePct: number }[];
    };
    prizes: { key: string; label: string; category: string }[];
    tiers: TicketTier[];
    cooldownDays: number;
    paidRoundClosed: boolean;
    canCommit: boolean;
    canDraw: boolean;
    blockers: { code: string; message: string }[];
}

export interface TombolaHistoryRow {
    drawId: string;
    editionId: string;
    editionName: string | null;
    drawnAt: string;
    totalTickets: number;
    participants: number;
    winners: { order: number; prize: string; category: string; ticketNumber: number | null; displayName: string | null; status: PrizeStatus; userId?: string | null; statusNote?: string | null; statusAt?: string | null }[];
}

export const PRIZE_STATUS_LABELS: Record<PrizeStatus, string> = {
    PENDING: 'En attente',
    DELIVERED: 'Remis',
    FORFEITED: 'Non remis',
    NOT_AWARDED: 'Non attribué',
};

export const getTombola = async (id: string): Promise<TombolaOverview> =>
    unwrap(await apiClient.get(`${BASE}/editions/${id}/tombola`), 'Impossible de charger la tombola.');

export const commitTombola = async (id: string): Promise<TombolaDraw> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/tombola/commit`), 'La graine n’a pas pu être fixée.');

/** Needs the admin's code (the apiClient interceptor asks for it). */
export const drawTombola = async (id: string): Promise<TombolaDraw> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/tombola/draw`), 'Le tirage n’a pas pu avoir lieu.');

export const revealNextWinner = async (id: string): Promise<TombolaDraw> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/tombola/reveal`), 'Le gagnant suivant n’a pas pu être affiché.');

/** FORFEITED needs a note of 5 characters at least. */
export const setPrizeStatus = async (id: string, order: number, status: 'DELIVERED' | 'FORFEITED' | 'PENDING', note?: string): Promise<TombolaDraw> =>
    unwrap(await apiClient.post(`${BASE}/editions/${id}/tombola/winners/${order}/status`, { status, ...(note ? { note } : {}) }), 'Le statut du lot n’a pas pu être enregistré.');

export const getTombolaHistory = async (): Promise<TombolaHistoryRow[]> =>
    unwrap(await apiClient.get(`${BASE}/tombola/history`), 'Impossible de charger l’historique des tirages.') ?? [];

const PUBLIC = '/tickets/impact/public';

/** The public proof of a draw (seed, commitment, segments, method, winners). */
export const getTombolaProof = async (drawId: string): Promise<{ seed?: string | null; seedCommitment: string; segmentsHash?: string }> =>
    unwrap(await apiClient.get(`${PUBLIC}/tombola/draws/${drawId}/proof`), 'Impossible de charger la preuve du tirage.');

/** The member app's readable proof of a draw (it shows the public proof, from which anyone can recompute the winners). */
export const tombolaProofUrl = (drawId: string) => `${MEMBER_APP_URL}/impact-challenge/tombola/preuve/${encodeURIComponent(drawId)}`;

/** The member app's tombola page (the live screen of the draw). */
export const tombolaScreenUrl = () => `${MEMBER_APP_URL}/impact-challenge/tombola`;

// =====================================================================
// Phase 5: the « SBC Impact » showcase (docs/impact-challenge/PHASE5.md)
// =====================================================================

export type ShowcaseUpdateKind = 'STEP' | 'PRODUCT' | 'ACHIEVEMENT' | 'NEWS' | 'RESULT';
export type ShowcaseUpdateStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'REMOVED';

export interface ShowcasePage {
    _id: string;
    editionId: string;
    candidateId: string;
    profile: {
        name: string; photoFileId: string; activity?: string; category?: string; country?: string; city?: string;
        presentation?: string; projectName: string; projectDescription?: string; sbcId?: string | null;
    };
    result: { rank: number; score: number; winner: boolean; editionName: string; decidedAt: string };
    videoFileId: string | null;
    podcast: { url: string; title?: string; platform?: string } | null;
    youtubeUrl: string | null;
    shopUrl: string | null;
    visibleFrom: string;
    visibleUntil: string;
    /** Past its end date (a hidden page is `hidden`, not archived). */
    archived: boolean;
    // administration
    userId?: string;
    hidden?: boolean;
    hiddenAt?: string | null;
    hiddenReason?: string | null;
    /** In the list only. */
    pendingUpdates?: number;
    /** The end date can't go under it (page detail and edit answers). */
    minVisibleUntil?: string | null;
}

export interface ShowcaseUpdate {
    _id: string;
    kind: ShowcaseUpdateKind;
    title: string;
    body: string;
    imageFileId: string | null;
    link: string | null;
    publishedAt: string | null;
    status: ShowcaseUpdateStatus;
    authorRole: 'admin' | 'finalist';
    review: { reason: string | null; at: string } | null;
    createdAt: string;
}

export type ShowcaseDetail = ShowcasePage & { updates: ShowcaseUpdate[] };
export type PendingShowcaseUpdate = ShowcaseUpdate & { showcaseId: string; finalist: { name: string; projectName: string } | null };

export interface ShowcaseEdit {
    podcast?: { url: string; title?: string; platform?: string } | null;
    youtubeUrl?: string;
    shopUrl?: string;
    visibleUntil?: string;
    hidden?: boolean;
    hiddenReason?: string;
}

export interface ShowcaseUpdateInput { kind: ShowcaseUpdateKind; title: string; body: string; imageFileId?: string; link?: string }

export const SHOWCASE_KIND_LABELS: Record<ShowcaseUpdateKind, string> = {
    STEP: 'Étape franchie',
    PRODUCT: 'Nouveau produit',
    ACHIEVEMENT: 'Réussite',
    NEWS: 'Actualité',
    RESULT: 'Résultat',
};

export const SHOWCASE_UPDATE_STATUS_LABELS: Record<ShowcaseUpdateStatus, string> = {
    PENDING: 'À valider',
    PUBLISHED: 'Publiée',
    REJECTED: 'Refusée',
    REMOVED: 'Retirée',
};

export const listShowcase = async (q: { editionId?: string } = {}): Promise<ShowcasePage[]> =>
    unwrap(await apiClient.get(`${BASE}/showcase`, { params: q.editionId ? { editionId: q.editionId } : undefined }), 'Impossible de charger les pages SBC Impact.') ?? [];

export const getShowcase = async (id: string): Promise<ShowcaseDetail> =>
    unwrap(await apiClient.get(`${BASE}/showcase/${id}`), 'Impossible de charger la page SBC Impact.');

export const editShowcase = async (id: string, body: ShowcaseEdit): Promise<ShowcasePage> =>
    unwrap(await apiClient.patch(`${BASE}/showcase/${id}`, body), 'La page n’a pas pu être modifiée.');

export const postShowcaseUpdate = async (id: string, body: ShowcaseUpdateInput): Promise<ShowcaseUpdate> =>
    unwrap(await apiClient.post(`${BASE}/showcase/${id}/updates`, body), 'La nouvelle n’a pas pu être publiée.');

export const listPendingShowcaseUpdates = async (): Promise<PendingShowcaseUpdate[]> =>
    unwrap(await apiClient.get(`${BASE}/showcase/updates/pending`), 'Impossible de charger les nouvelles à valider.') ?? [];

/** approve; reject (reason ≥ 10, the finalist reads it); remove a published one (reason ≥ 5). */
export const reviewShowcaseUpdate = async (updateId: string, decision: 'approve' | 'reject' | 'remove', reason?: string): Promise<ShowcaseUpdate> =>
    unwrap(await apiClient.post(`${BASE}/showcase/updates/${updateId}/review`, { decision, ...(reason ? { reason } : {}) }), 'La décision n’a pas pu être enregistrée.');

export const createShowcasePages = async (editionId: string): Promise<{ created: number }> =>
    unwrap(await apiClient.post(`${BASE}/editions/${editionId}/showcase/create`), 'Les pages n’ont pas pu être créées.');

/** The admin's existing upload (settings-service `/settings/files/upload`), for a news image. */
export const uploadShowcaseImage = async (file: File): Promise<string> => (await uploadChallengeVideo(file)).fileId;

/** The page in the member app. */
export const showcasePublicUrl = (id: string) => `${MEMBER_APP_URL}/impact/${encodeURIComponent(id)}`;

/** Same rule as the server: https on youtube.com / youtu.be (any subdomain). '' = no link. */
export function youtubeUrlError(v: string): string | null {
    const raw = v.trim();
    if (!raw) return null;
    const base = httpsUrlError(raw);
    if (base) return base;
    return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(new URL(raw).hostname) ? null : 'Ce lien n’est pas une adresse YouTube.';
}

/** https only, 400 characters at most (the server's rule). '' = no link. */
export function httpsUrlError(v: string): string | null {
    const raw = v.trim();
    if (!raw) return null;
    let u: URL;
    try { u = new URL(raw); } catch { return 'Adresse web invalide.'; }
    if (u.protocol !== 'https:') return 'L’adresse doit commencer par https://.';
    if (raw.length > 400) return 'Adresse trop longue.';
    return null;
}

/**
 * The end date can't go under visibleFrom + `showcaseMonths`. The server sends
 * it (`minVisibleUntil`); this is only the fallback (12 months).
 */
export function showcaseMinEnd(visibleFrom: string, months = 12): Date {
    const d = new Date(visibleFrom);
    d.setMonth(d.getMonth() + months);
    return d;
}
