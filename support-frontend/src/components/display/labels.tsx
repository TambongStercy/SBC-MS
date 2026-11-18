import type { ApprovalStatus, ApprovalType, BusinessStatus, CaseStatus, CaseType, RecheckOutcome, Severity, TicketPriority, TicketStatus, ViewTaskState } from '../../api/types';
import { Badge } from '../ui';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
type Labelled = Record<string, { label: string; tone: Tone }>;

/** Every status the app shows, in French, with its colour. One place to change a wording. */
export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: Tone }> = {
  new: { label: 'Nouveau', tone: 'primary' },
  open: { label: 'En cours', tone: 'info' },
  waiting_member: { label: 'Attente membre', tone: 'warning' },
  waiting_internal: { label: 'Attente interne', tone: 'warning' },
  resolved: { label: 'Résolu', tone: 'success' },
  closed: { label: 'Fermé', tone: 'neutral' },
};

export const TICKET_PRIORITY: Record<TicketPriority, { label: string; tone: Tone }> = {
  low: { label: 'Basse', tone: 'neutral' },
  normal: { label: 'Normale', tone: 'outline' },
  high: { label: 'Haute', tone: 'warning' },
  urgent: { label: 'Urgente', tone: 'danger' },
};

/** Ticket categories (CdC §7.2 list pending; unknown keys are shown as sent). */
export const TICKET_CATEGORY: Record<string, string> = {
  activation: 'Activation du compte',
  withdrawal: 'Retrait',
  payment: 'Paiement',
  account: 'Compte et connexion',
  identity_verification: 'Vérification d’identité',
  ads: 'Ads Network',
  commission: 'Commissions et filleuls',
  other: 'Autre',
};

export const CASE_TYPE: Record<CaseType, string> = {
  activation: 'Activation',
  withdrawal_divergence: 'Divergence de retrait',
  debit_missing: 'Débit sans preuve',
  paid_not_debited: 'Succès sans débit',
  duplicate_callback: 'Rappel en double',
  unknown_status: 'Statut inconnu',
  amount_mismatch: 'Écart de montant',
  ledger_mismatch: 'Écart de registre',
};

export const CASE_STATUS: Record<CaseStatus, { label: string; tone: Tone }> = {
  open: { label: 'Ouvert', tone: 'primary' },
  in_progress: { label: 'En traitement', tone: 'info' },
  waiting_provider: { label: 'Attente prestataire', tone: 'warning' },
  resolved: { label: 'Résolu', tone: 'success' },
  closed: { label: 'Fermé', tone: 'neutral' },
};

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  info: { label: 'Info', tone: 'info' },
  warning: { label: 'Alerte', tone: 'warning' },
  critical: { label: 'Critique', tone: 'danger' },
};

/** CONTRACT §2.2 business statuses. */
export const BUSINESS_STATUS: Record<BusinessStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Demandé (OTP)', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'À valider', tone: 'warning' },
  RESERVED: { label: 'Fonds réservés', tone: 'info' },
  SUBMITTED: { label: 'Envoyé au prestataire', tone: 'info' },
  PENDING: { label: 'En cours', tone: 'info' },
  SUCCEEDED: { label: 'Réussi', tone: 'success' },
  FAILED: { label: 'Échoué', tone: 'danger' },
  CANCEL_REQUESTED: { label: 'Annulation demandée', tone: 'warning' },
  CANCELLED: { label: 'Annulé', tone: 'neutral' },
  REJECTED: { label: 'Refusé par l’admin', tone: 'neutral' },
  EXPIRED: { label: 'Expiré (non validé)', tone: 'neutral' },
  UNKNOWN: { label: 'Statut inconnu', tone: 'danger' },
};

export const RECHECK_RESULT: Record<RecheckOutcome, { label: string; tone: Tone; help: string }> = {
  confirmed: { label: 'Confirmé', tone: 'success', help: 'Le prestataire confirme le paiement. Le traitement normal a été rejoué.' },
  pending: { label: 'En attente', tone: 'warning', help: 'Le prestataire n’a pas encore de réponse finale. Une nouvelle vérification est planifiée.' },
  not_found: { label: 'Introuvable', tone: 'danger', help: 'Le prestataire ne connaît pas cette référence. Rien n’a été activé.' },
  failed: { label: 'Échoué', tone: 'danger', help: 'Le prestataire indique un échec.' },
  provider_unavailable: { label: 'Prestataire indisponible', tone: 'warning', help: 'Le prestataire n’a pas répondu. Rien n’a changé ; réessayez plus tard.' },
};

export const APPROVAL_TYPE: Record<ApprovalType, string> = {
  regularization: 'Régularisation de retrait',
  manual_activation: 'Activation manuelle',
  contact_change: 'Changement de contact',
};

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En attente', tone: 'warning' },
  approved: { label: 'Approuvée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  executed: { label: 'Exécutée', tone: 'success' },
  failed: { label: 'Échec à l’exécution', tone: 'danger' },
  expired: { label: 'Expirée', tone: 'neutral' },
};

export const VIEW_STATE: Record<ViewTaskState, { label: string; tone: Tone }> = {
  available: { label: 'Disponible', tone: 'neutral' },
  assigned: { label: 'Attribuée', tone: 'primary' },
  in_progress: { label: 'En cours', tone: 'info' },
  approved: { label: 'Validée', tone: 'success' },
  rejected: { label: 'Rejetée', tone: 'danger' },
  to_review: { label: 'À revoir', tone: 'warning' },
};

/** A status badge from one of the tables above; an unknown value is shown as sent. */
export function StatusBadge({ map, value }: { map: Labelled; value: string | null | undefined }) {
  if (!value) return <span className="text-fg-subtle">—</span>;
  const entry = map[value];
  return <Badge tone={entry?.tone ?? 'neutral'}>{entry?.label ?? value}</Badge>;
}
