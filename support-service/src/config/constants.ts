/**
 * Fixed lists from the CdC (SBC-SUP-CdC-001 v1.1 §7.2, §7.3) and the contract.
 * Keys are stable identifiers stored in the database; labels are what agents
 * and members read (French).
 */

export const TICKET_CATEGORIES = [
    { key: 'compte_acces', label: 'Compte & accès', defaultPriority: 'normal' },
    { key: 'activation_paiement', label: 'Activation / paiement', defaultPriority: 'high' },
    { key: 'retrait', label: 'Retrait', defaultPriority: 'high' },
    { key: 'commissions', label: 'Commissions', defaultPriority: 'normal' },
    { key: 'vues_whatsapp', label: 'Vues WhatsApp', defaultPriority: 'normal' },
    { key: 'technique', label: 'Technique', defaultPriority: 'normal' },
    { key: 'autre', label: 'Autre', defaultPriority: 'low' },
] as const;
export type TicketCategory = typeof TICKET_CATEGORIES[number]['key'];
export const TICKET_CATEGORY_KEYS = TICKET_CATEGORIES.map((c) => c.key) as TicketCategory[];

export const TICKET_STATUSES = [
    { key: 'nouveau', label: 'Nouveau' },
    { key: 'ouvert', label: 'Ouvert' },
    { key: 'en_attente_membre', label: 'En attente du membre' },
    { key: 'en_attente_interne', label: 'En attente interne' },
    { key: 'resolu', label: 'Résolu' },
    { key: 'ferme', label: 'Fermé' },
] as const;
export type TicketStatus = typeof TICKET_STATUSES[number]['key'];
export const TICKET_STATUS_KEYS = TICKET_STATUSES.map((s) => s.key) as TicketStatus[];
export const OPEN_TICKET_STATUSES: TicketStatus[] = ['nouveau', 'ouvert', 'en_attente_membre', 'en_attente_interne'];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = typeof TICKET_PRIORITIES[number];

/** SLA targets in hours: first agent answer, then resolution. */
export const SLA_HOURS: Record<TicketPriority, { firstResponse: number; resolution: number }> = {
    urgent: { firstResponse: 1, resolution: 8 },
    high: { firstResponse: 4, resolution: 24 },
    normal: { firstResponse: 24, resolution: 72 },
    low: { firstResponse: 48, resolution: 120 },
};

export const TICKET_SOURCES = ['member', 'assistant', 'system', 'agent'] as const;

export const CASE_TYPES = [
    'activation', 'withdrawal_divergence', 'debit_missing', 'paid_not_debited',
    'duplicate_callback', 'unknown_status', 'amount_mismatch', 'ledger_mismatch',
] as const;
export type CaseType = typeof CASE_TYPES[number];
export const CASE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type CaseSeverity = typeof CASE_SEVERITIES[number];
export const CASE_STATUSES = ['open', 'in_progress', 'waiting_provider', 'resolved', 'closed'] as const;
export type CaseStatus = typeof CASE_STATUSES[number];

export const VIEW_TASK_STATES = ['available', 'assigned', 'in_progress', 'approved', 'rejected', 'to_review', 'closed'] as const;
export type ViewTaskState = typeof VIEW_TASK_STATES[number];
export const ACTIVE_VIEW_STATES: ViewTaskState[] = ['assigned', 'in_progress'];

/** CdC §5 business statuses of a withdrawal, in plain French for members. */
export const WITHDRAWAL_STATUS_TEXT: Record<string, { label: string; explanation: string }> = {
    REQUESTED: { label: 'Code à confirmer', explanation: 'Votre demande attend le code de confirmation envoyé lors du retrait.' },
    PENDING_APPROVAL: { label: 'En validation', explanation: 'Votre demande est reçue et en cours de validation par l’équipe SBC.' },
    RESERVED: { label: 'En préparation', explanation: 'Le montant est réservé sur votre solde et l’envoi est en préparation.' },
    SUBMITTED: { label: 'Envoyé à l’opérateur', explanation: 'Le retrait est transmis à l’opérateur, qui doit encore le confirmer.' },
    PENDING: { label: 'Chez l’opérateur', explanation: 'L’opérateur traite le retrait ; nous attendons sa confirmation.' },
    SUCCEEDED: { label: 'Effectué', explanation: 'L’opérateur a confirmé l’envoi de l’argent sur votre compte mobile.' },
    FAILED: { label: 'Échoué', explanation: 'L’opérateur a refusé le retrait ; votre solde n’a pas été débité.' },
    CANCEL_REQUESTED: { label: 'Annulation demandée', explanation: 'L’annulation est demandée ; le montant reste réservé jusqu’à la confirmation.' },
    CANCELLED: { label: 'Annulé', explanation: 'Le retrait est annulé et le montant est de nouveau disponible.' },
    UNKNOWN: { label: 'En vérification', explanation: 'L’opérateur n’a pas encore donné de réponse définitive ; votre argent reste réservé pendant notre vérification.' },
};

export const withdrawalStatusText = (businessStatus: string | undefined) =>
    WITHDRAWAL_STATUS_TEXT[String(businessStatus || '').toUpperCase()]
    ?? { label: 'En cours', explanation: 'Votre retrait est en cours de traitement.' };

export const PAYIN_STATUS_LABELS: Record<string, string> = {
    confirmed: 'Paiement confirmé par l’opérateur',
    pending: 'Paiement en attente de confirmation de l’opérateur',
    not_found: 'Paiement introuvable chez l’opérateur',
    failed: 'Paiement échoué ou annulé chez l’opérateur',
    provider_unavailable: 'L’opérateur ne répond pas pour le moment',
};
