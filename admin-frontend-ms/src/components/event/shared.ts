import {
  Alert02Icon, Calendar03Icon, Cancel01Icon, CheckmarkCircle02Icon, Clock01Icon, Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { AdminEvent } from '../../api/event';
import type { StatusMap } from '../moduleKit';

/**
 * Shared vocabulary of the SBC Event admin pages (src/pages/Event*Page.tsx):
 * statuses in words with their tone, small helpers, the page size.
 */

export const PAGE_SIZE = 25;

export const EVENT_STATUS: StatusMap = {
  DRAFT: ['Brouillon', 'neutral'],
  PENDING_REVIEW: ['À valider', 'warning', Clock01Icon],
  REJECTED: ['Refusé', 'danger', Cancel01Icon],
  PUBLISHED: ['En vente', 'success', CheckmarkCircle02Icon],
  SUSPENDED: ['Suspendu', 'warning', Alert02Icon],
  CANCELLED: ['Annulé', 'danger', Cancel01Icon],
  COMPLETED: ['Passé', 'info', Calendar03Icon],
};

export const ORGANIZER_STATUS: StatusMap = {
  PENDING: ['En attente', 'warning', Clock01Icon],
  APPROVED: ['Approuvé', 'success', CheckmarkCircle02Icon],
  SUSPENDED: ['Suspendu', 'danger', Alert02Icon],
};

export const ORDER_STATUS: StatusMap = {
  PENDING: ['En attente', 'neutral', Clock01Icon],
  PAID: ['Payée', 'success', CheckmarkCircle02Icon],
  FAILED: ['Échouée', 'danger', Cancel01Icon],
  CANCELLED: ['Annulée', 'danger', Cancel01Icon],
  REFUNDED: ['Remboursée', 'warning'],
};

export const ORDER_KIND: StatusMap = {
  PRIMARY: ['Vente directe', 'primary'],
  RESALE: ['Revente', 'info'],
};

export const TICKET_STATUS: StatusMap = {
  PENDING: ['En attente', 'neutral', Clock01Icon],
  ISSUED: ['Émis', 'success', Tick02Icon],
  CHECKED_IN: ['Entré', 'info', CheckmarkCircle02Icon],
  CANCELLED: ['Annulé', 'danger', Cancel01Icon],
  REFUNDED: ['Remboursé', 'warning'],
  EXPIRED: ['Expiré', 'neutral'],
};

export const LISTING_STATUS: StatusMap = {
  DRAFT: ['Brouillon', 'neutral'],
  ACTIVE: ['En vente', 'success', CheckmarkCircle02Icon],
  SOLD: ['Vendue', 'info', Tick02Icon],
  CANCELLED: ['Annulée', 'neutral'],
  EXPIRED: ['Expirée', 'neutral'],
  SUSPENDED: ['Suspendue', 'danger', Alert02Icon],
};

export const DISPUTE_STATUS: StatusMap = {
  OPEN: ['Ouvert', 'warning', Clock01Icon],
  RESOLVED: ['Résolu', 'success', CheckmarkCircle02Icon],
  REJECTED: ['Rejeté', 'neutral', Cancel01Icon],
};

/** event-service DisputeKind */
export const DISPUTE_KIND: Record<string, string> = {
  RESALE_INVALID_TICKET: 'Billet revendu invalide',
  RESALE_NOT_RECEIVED: 'Billet revendu non reçu',
  EVENT_NOT_AS_ADVERTISED: 'Événement non conforme',
  OTHER: 'Autre',
};

export const isObjectId = (v: string) => /^[0-9a-f]{24}$/i.test(v.trim());
export const isWebinaire = (e: AdminEvent) => e.category === 'webinaire';
/** Where an event takes place: a venue, or the WhatsApp link of a webinaire. */
export const eventPlace = (e: AdminEvent) => (isWebinaire(e) ? 'Webinaire WhatsApp' : [e.venue, e.city].filter(Boolean).join(' · '));
