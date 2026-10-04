import { useQuery } from '@tanstack/react-query';
import { listAdminEvents, type AdminEvent } from '../../../api/event';
import type { Tone } from '../../../ui';

export const ORGANIZER_STATUS: Record<string, [string, Tone]> = { PENDING: ['En attente', 'warning'], APPROVED: ['Approuvé', 'success'], SUSPENDED: ['Suspendu', 'danger'] };
export const EVENT_STATUS: Record<string, [string, Tone]> = { DRAFT: ['Brouillon', 'neutral'], PUBLISHED: ['En vente', 'success'], SUSPENDED: ['Suspendu', 'danger'], CANCELLED: ['Annulé', 'neutral'], COMPLETED: ['Passé', 'primary'] };
export const ORDER_STATUS: Record<string, [string, Tone]> = { PENDING: ['Pas payée', 'neutral'], PAID: ['Payée', 'success'], FAILED: ['Échouée', 'danger'], CANCELLED: ['Annulée', 'neutral'], REFUNDED: ['Remboursée', 'accent'] };
export const ORDER_KIND: Record<string, [string, Tone]> = { PRIMARY: ['Vente', 'primary'], RESALE: ['Revente', 'accent'] };
export const TICKET_STATUS: Record<string, [string, Tone]> = { PENDING: ['En attente', 'neutral'], ISSUED: ['Valable', 'success'], CHECKED_IN: ['Entré', 'primary'], CANCELLED: ['Annulé', 'neutral'], REFUNDED: ['Remboursé', 'accent'], EXPIRED: ['Expiré', 'neutral'] };
export const LISTING_STATUS: Record<string, [string, Tone]> = { DRAFT: ['Brouillon', 'neutral'], ACTIVE: ['En vente', 'success'], SOLD: ['Vendue', 'primary'], CANCELLED: ['Retirée', 'neutral'], EXPIRED: ['Expirée', 'neutral'], SUSPENDED: ['Suspendue', 'danger'] };
export const DISPUTE_STATUS: Record<string, [string, Tone]> = { OPEN: ['Ouvert', 'warning'], RESOLVED: ['Résolu', 'success'], REJECTED: ['Rejeté', 'neutral'] };
export const DISPUTE_KIND: Record<string, string> = {
    RESALE_INVALID_TICKET: 'Billet de revente invalide', RESALE_NOT_RECEIVED: 'Billet de revente pas reçu',
    EVENT_NOT_AS_ADVERTISED: 'Événement pas comme annoncé', OTHER: 'Autre',
};

/** Events by id, for showing titles instead of ids (the 200 most recent). */
export function useEventIndex() {
    const q = useQuery({ queryKey: ['events', 'index'], queryFn: () => listAdminEvents({ limit: 200 }), staleTime: 300_000 });
    const byId = new Map<string, AdminEvent>((q.data?.items ?? []).map(e => [e._id, e]));
    return { events: q.data?.items ?? [], byId, title: (id?: string) => (id ? byId.get(id)?.title ?? 'Événement' : '—') };
}
