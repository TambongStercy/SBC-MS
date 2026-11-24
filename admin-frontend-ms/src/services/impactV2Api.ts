import axios from 'axios';
import apiClient from '../api/apiClient';
import { fileProxyUrl } from './impactChallengeApi';

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
}

/** The backend's own answer to a failed call (code, French message, fields). */
export function readImpactError(err: unknown, fallback = 'L’action a échoué.'): ImpactApiError {
    if (axios.isAxiosError(err)) {
        const data = (err.response?.data ?? {}) as { message?: string; code?: string; details?: { field?: string; fields?: string[] } };
        const fields = Array.isArray(data.details?.fields)
            ? data.details!.fields!.map(String)
            : data.details?.field ? [String(data.details.field)] : [];
        const message = data.message || (err.response ? fallback : 'Le serveur ne répond pas. Vérifiez la connexion, puis réessayez.');
        return { message, code: data.code, status: err.response?.status, fields };
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
