import { CheckmarkCircle02Icon, Clock01Icon, LockIcon } from '@hugeicons/core-free-icons';
import type { StatusMap } from '../moduleKit';
import { Tooltip } from '../ui';

/** Tombola vocabulary in French (the API values stay in English). */
export const TOMBOLA_STATUS: StatusMap = {
  open: ['Ouverte', 'success', CheckmarkCircle02Icon],
  drawing: ['Tirage en cours', 'warning', Clock01Icon],
  closed: ['Fermée', 'neutral', LockIcon],
};

/** "novembre 2026" */
export const monthLabel = (month: number, year: number) =>
  new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** "Novembre 2026" */
export const monthTitle = (month: number, year: number) => {
  const l = monthLabel(month, year);
  return l.charAt(0).toUpperCase() + l.slice(1);
};

export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => {
  const l = new Date(2000, i, 1).toLocaleDateString('fr-FR', { month: 'long' });
  return l.charAt(0).toUpperCase() + l.slice(1);
});

/**
 * The service stores prizes as hard-coded English labels and pushes them to
 * the winners as they are (CLAUDE.md). Shown here in French, with the stored
 * label in a tooltip; display only.
 */
const PRIZE_FR: Record<string, string> = {
  bike: 'Vélo',
  phone: 'Téléphone',
  '100k fcfa': '100 000 F',
};

export function Prize({ value }: { value: string }) {
  const fr = PRIZE_FR[value.trim().toLowerCase()];
  if (!fr || fr === value) return <span>{value}</span>;
  return (
    <Tooltip content={`Libellé envoyé au gagnant : « ${value} »`}>
      <span tabIndex={0} className="underline decoration-dotted decoration-fg-subtle underline-offset-4">{fr}</span>
    </Tooltip>
  );
}
