/**
 * SBC Impact Challenge v2 — editions, candidates, qualification.
 * Spec: « SBC Impact Challenge — Cahier des charges fonctionnel » v1.0, with
 * Rufus's answers of 2026-11-23 (see DEFAULT_SETTINGS).
 *
 * Phase 1 (this module): an edition, its public rules, candidate profiles, the
 * invitation counter, the first-N seats (+ a waiting list), the candidate space
 * and its notifications. The stages (videos, votes, final, tombola, showcase)
 * come in later phases and reuse the Animation engine; their settings already
 * live on the edition so the rules can be published before qualification opens.
 */

export enum EditionStatus {
    DRAFT = 'DRAFT',
    /** Profiles accepted; invitations counted; seats handed out. */
    QUALIFICATION = 'QUALIFICATION',
    /** Qualification over (date reached, or seats and waiting list full). */
    QUALIFICATION_CLOSED = 'QUALIFICATION_CLOSED',
    COMPETITION = 'COMPETITION',
    FINAL = 'FINAL',
    FINISHED = 'FINISHED',
    CANCELLED = 'CANCELLED',
}

/** Editions shown to members as "the current Challenge". */
export const LIVE_EDITION_STATUSES = [
    EditionStatus.QUALIFICATION, EditionStatus.QUALIFICATION_CLOSED, EditionStatus.COMPETITION, EditionStatus.FINAL,
];

/** Candidate statuses (spec §4), plus the qualification outcomes. */
export enum CandidateStatus {
    QUALIFYING = 'QUALIFYING',          // En qualification
    WAITLIST = 'WAITLIST',              // Qualification débloquée, en attente d'une place
    OFFICIAL = 'OFFICIAL',              // Candidat officiel
    STAGE_2 = 'STAGE_2',                // Étape 2
    STAGE_3 = 'STAGE_3',                // Étape 3
    FINALIST = 'FINALIST',              // Finaliste
    WINNER = 'WINNER',                  // Gagnant
    ELIMINATED = 'ELIMINATED',          // Éliminé
    FINISHED = 'FINISHED',              // Challenge terminé
    NOT_SELECTED = 'NOT_SELECTED',      // Inscriptions fermées avant d'avoir une place
    SUSPENDED = 'SUSPENDED',            // Suspendu par l'administration (réversible)
    DISQUALIFIED = 'DISQUALIFIED',
    WITHDRAWN = 'WITHDRAWN',            // Retrait volontaire
}

export const STATUS_LABEL_FR: Record<CandidateStatus, string> = {
    QUALIFYING: 'En qualification',
    WAITLIST: 'Qualification débloquée — liste d’attente',
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

/** A seat is held by every candidate who got one, except those who left. */
export const SEAT_LOST_STATUSES = [CandidateStatus.DISQUALIFIED, CandidateStatus.WITHDRAWN];

export enum ProfileReview {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    CHANGES_REQUESTED = 'CHANGES_REQUESTED',
}

export interface TicketTier { upTo: number | null; weight: number }
export interface Prize { key: string; label: string; category: string }
export interface JuryCriterion { key: string; label: string; max: number }
export interface VotePack { votes: number; price: number }
export interface ProfileField { key: string; label: string; required: boolean; maxLength: number }

export interface EditionSettings {
    maxCandidates: number;
    invitationsRequired: number;
    /** Candidates who reach the count once the seats are taken (our addition, §3.3). */
    waitlistSize: number;
    finalistsCount: number;
    votePrice: number;
    votePacks: VotePack[];
    /** Final score, in % (spec §12): paid votes + final public vote + jury = 100. */
    weights: { paidVotes: number; publicVote: number; jury: number };
    juryCriteria: JuryCriterion[];
    /** Tombola: weight of a member's n-th ticket of the edition (Rufus's option B). */
    ticketTiers: TicketTier[];
    prizes: Prize[];
    /** A member cannot win the same prize category twice within this many days. */
    prizeCooldownDays: number;
    showcaseMonths: number;
    /** Business categories offered on the profile (empty = free text). */
    categories: string[];
    /** Extra profile questions configured by the administration (§3.1). */
    profileFields: ProfileField[];
}

/** Spec §19 values + Rufus's answers (2026-11-23). */
export const DEFAULT_SETTINGS: EditionSettings = {
    maxCandidates: 20,
    invitationsRequired: 10,
    waitlistSize: 5,
    finalistsCount: 3,
    votePrice: 200,
    votePacks: [{ votes: 1, price: 200 }, { votes: 5, price: 1000 }, { votes: 10, price: 2000 }],
    weights: { paidVotes: 50, publicVote: 30, jury: 20 },
    juryCriteria: [
        { key: 'impact', label: 'Impact', max: 10 },
        { key: 'innovation', label: 'Innovation', max: 10 },
        { key: 'faisabilite', label: 'Faisabilité', max: 10 },
        { key: 'potentiel', label: 'Potentiel', max: 10 },
        { key: 'presentation', label: 'Présentation', max: 10 },
    ],
    ticketTiers: [{ upTo: 10, weight: 1 }, { upTo: 50, weight: 0.5 }, { upTo: null, weight: 0.25 }],
    prizes: [
        { key: 'cash', label: 'Prix en espèces', category: 'cash' },
        { key: 'ordinateur', label: 'Un ordinateur', category: 'ordinateur' },
        { key: 'telephone', label: 'Un téléphone portable', category: 'telephone' },
    ],
    prizeCooldownDays: 365,
    showcaseMonths: 12,
    categories: [
        'Commerce', 'Agriculture & agroalimentaire', 'Mode & beauté', 'Services', 'Technologie & numérique',
        'Éducation & formation', 'Santé & bien-être', 'Artisanat', 'Transport & logistique', 'Autre',
    ],
    profileFields: [],
};

/**
 * Which settings freeze when (spec §12, §18). Qualification rules freeze when
 * qualification opens; the competition rules (votes, weights, jury, tombola
 * tickets) when the competition starts. Prizes stay editable (Rufus: the
 * administration must be able to change the prizes); they lock at the draw.
 */
export const QUALIFICATION_LOCKED: (keyof EditionSettings)[] = [
    'maxCandidates', 'invitationsRequired', 'waitlistSize', 'categories', 'profileFields',
];
export const COMPETITION_LOCKED: (keyof EditionSettings)[] = [
    'finalistsCount', 'votePrice', 'votePacks', 'weights', 'juryCriteria', 'ticketTiers', 'prizeCooldownDays', 'showcaseMonths',
];

export const editionRank = (s: EditionStatus) =>
    [EditionStatus.DRAFT, EditionStatus.QUALIFICATION, EditionStatus.QUALIFICATION_CLOSED,
        EditionStatus.COMPETITION, EditionStatus.FINAL, EditionStatus.FINISHED].indexOf(s);

/** Version of the publication consent text shown on the profile form. */
export const CONSENT_VERSION = 'impact-2026-12';
