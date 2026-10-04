import type { CampaignStatus } from '../../../api/adsNetwork';
import type { Tone } from '../../../ui';

export const API = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api';
/** A stored file through our own origin (behind Cloudflare), not the bucket. */
export const fileUrl = (fileId?: string) => (fileId ? `${API}/settings/files/${encodeURIComponent(fileId)}` : '');

export const CAMPAIGN_STATUS: Record<CampaignStatus, [string, Tone]> = {
    draft: ['Brouillon', 'neutral'],
    pending_review: ['À valider (non payée)', 'warning'],
    paid: ['Payée — à valider', 'warning'],
    approved: ['Validée, attend le paiement', 'primary'],
    rejected: ['Refusée', 'danger'],
    active: ['En cours', 'success'],
    paused: ['En pause', 'neutral'],
    completed: ['Terminée', 'success'],
    banked: ['Clôturée — crédit rendu', 'accent'],
    cancelled: ['Annulée', 'neutral'],
};

/** Filter choices; "a-valider" is the moderation queue (paid, plus old unpaid submissions). */
export const STATUS_FILTER: Array<{ value: string; label: string; statuses: CampaignStatus[] }> = [
    { value: '', label: 'Toutes', statuses: ['draft', 'pending_review', 'paid', 'approved', 'rejected', 'active', 'paused', 'completed', 'banked', 'cancelled'] },
    { value: 'a-valider', label: 'À valider', statuses: ['paid', 'pending_review'] },
    { value: 'en-cours', label: 'En cours', statuses: ['active'] },
    { value: 'en-pause', label: 'En pause', statuses: ['paused'] },
    { value: 'terminees', label: 'Terminées', statuses: ['completed', 'banked'] },
    { value: 'refusees', label: 'Refusées', statuses: ['rejected'] },
    { value: 'brouillons', label: 'Brouillons', statuses: ['draft'] },
    { value: 'annulees', label: 'Annulées', statuses: ['cancelled'] },
];

/** advertising-service ParticipationStatus. */
export const PARTICIPATION_STATUS: Record<string, [string, Tone]> = {
    offered: ['Offre envoyée', 'neutral'],
    declined: ['Déclinée', 'neutral'],
    expired: ['Offre expirée', 'neutral'],
    in_progress: ['En cours', 'primary'],
    completed: ['Terminée, payée', 'success'],
    forfeited: ['Abandonnée', 'danger'],
};
