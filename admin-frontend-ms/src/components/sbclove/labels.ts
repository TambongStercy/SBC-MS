import { CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, PauseCircleIcon } from '@hugeicons/core-free-icons';
import type { StatusMap } from '../moduleKit';

/** SBC Love vocabulary in French (the API values stay in English). */

export const INTENTION_LABELS: Record<string, string> = {
  relation_serieuse: 'Relation sérieuse',
  faire_connaissance: 'Faire connaissance',
  projet_mariage: 'Projet de mariage',
  elargir_cercle_social: 'Élargir son cercle social',
  echange_valeurs_respect: 'Échange, valeurs et respect',
  autre: 'Autre',
};

export const SEX_LABELS: Record<string, string> = { male: 'Homme', female: 'Femme' };

export const PROFILE_STATUS: StatusMap = {
  pending: ['À valider', 'warning', Clock01Icon],
  approved: ['Approuvé', 'success', CheckmarkCircle02Icon],
  rejected: ['Refusé', 'danger', CancelCircleIcon],
  suspended: ['Suspendu', 'neutral', PauseCircleIcon],
};

export const REPORT_STATUS: StatusMap = {
  open: ['Ouvert', 'warning', Clock01Icon],
  reviewed: ['Traité', 'success', CheckmarkCircle02Icon],
  dismissed: ['Ignoré', 'neutral'],
};

export const WEEKDAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** The two photos a profile must carry, in order (the member uploads them into named slots). */
export const SLOT_LABELS = ['Portrait (visage)', 'Photo en pied (corps entier)'];

/** Shown wherever a rejection reason is typed: the member app never displays it (CLAUDE.md, SBC Love). */
export const REJECTION_REASON_NOTE =
  'Le membre ne voit pas ce motif : l’application lui affiche un message fixe. Le motif reste dans l’historique de modération du profil.';

export const intentionLabel = (intention?: string, other?: string) =>
  intention === 'autre' && other ? other : (intention ? INTENTION_LABELS[intention] ?? intention : '—');
