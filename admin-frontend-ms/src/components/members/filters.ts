import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { countryCodeToNameMap } from '../../utils/countryUtils';

export const countryLabel = (code?: string) => (code ? countryCodeToNameMap[code.toUpperCase()] ?? code : '—');

/** Country select options, sorted by name. */
export const COUNTRY_OPTIONS = Object.entries(countryCodeToNameMap)
  .filter(([code]) => code !== 'Autres')
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

/**
 * Filters kept in the URL (?q=&status=&page=…): survives reloads and can be
 * shared. Setting any filter goes back to page 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const get = (k: K | 'page') => params.get(k) ?? '';
  const values = Object.fromEntries(keys.map(k => [k, get(k)])) as Record<K, string>;
  const page = Math.max(1, parseInt(get('page') || '1', 10) || 1);
  const active = keys.some(k => !!values[k]);

  const set = useCallback((k: K, v: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) next.set(k, v); else next.delete(k);
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const setPage = useCallback((p: number) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (p > 1) next.set('page', String(p)); else next.delete('page');
      return next;
    });
  }, [setParams]);

  /** Clears this page's filters, plus `alsoKeys` (e.g. the shared pays/periode/du/au) in the same URL update. */
  const clear = useCallback((alsoKeys: readonly string[] = []) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      [...keys, ...alsoKeys].forEach(k => next.delete(k));
      next.delete('page');
      return next;
    }, { replace: true });
    // keys is a constant array at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams]);

  return { values, page, active, set, setPage, clear };
}


/** URL keys of the shared country/period filters (hooks/usePageFilters). */
export const PAGE_FILTER_KEYS = ['pays', 'periode', 'du', 'au'] as const;
