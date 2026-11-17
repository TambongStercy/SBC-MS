import { useSearchParams } from 'react-router-dom';
import { PageFilters } from '../filters/PageFilters';
import type { PageFilters as Filters } from '../../hooks/usePageFilters';
import { SHARED_RESET_KEYS } from './useUrlSearchAndPage';

/**
 * The shared country / period row for the payment repair pages, plus the one
 * rule that differs from other pages: these are queues, so the period only
 * narrows the list when the admin picks one, and the "À traiter" counts
 * ignore it (an old stuck item still needs action).
 */
export function PaymentsFilterRow({ filters, hidePeriod, hideCountry, note = true }: {
  filters: Filters;
  hidePeriod?: boolean;
  hideCountry?: boolean;
  /** Show the line about the period and the counts. */
  note?: boolean;
}) {
  const [, setParams] = useSearchParams();
  // One URL update for the page's own keys AND the shared ones: PageFilters
  // calls filters.reset() first, and this later update (built from the same
  // starting URL) must not put the shared keys back.
  const clearAll = () => setParams(prev => {
    const next = new URLSearchParams(prev);
    SHARED_RESET_KEYS.forEach(k => next.delete(k));
    return next;
  }, { replace: true });

  return (
    <div>
      <PageFilters filters={filters} onReset={clearAll} hidePeriod={hidePeriod} hideCountry={hideCountry} className="mb-0" />
      {note && !hidePeriod && (
        <p className="mt-2 text-xs text-fg-muted">
          Par défaut, tous les retraits bloqués sont listés, même anciens. Les compteurs « À traiter » ignorent la période.
        </p>
      )}
    </div>
  );
}
