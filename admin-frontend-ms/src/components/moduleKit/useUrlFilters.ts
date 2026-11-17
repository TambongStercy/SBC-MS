import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filter state kept in the URL (?status=pending&q=…), so a filtered list can
 * be reloaded, shared and reached with the back button. Empty values are
 * removed from the URL; changing a filter sends the list back to page 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[], defaults: Partial<Record<K, string>> = {}) {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = params.get(k) ?? defaults[k] ?? '';
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, keys.join('|')]);

  const set = useCallback((patch: Partial<Record<K | 'page', string | number | null | undefined>>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      let resetPage = false;
      for (const [k, v] of Object.entries(patch) as [string, string | number | null | undefined][]) {
        if (k !== 'page') resetPage = true;
        if (v === '' || v == null || (k === 'page' && Number(v) === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  /** Removes this page's filters (and `alsoKeys`, e.g. the shared pays/periode/du/au, in the same URL update). */
  const clear = useCallback((alsoKeys?: unknown) => {
    // Safe as an onClick handler too (the event is not an array, so it is ignored)
    const extra = Array.isArray(alsoKeys) ? (alsoKeys as string[]) : [];
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const k of [...keys, ...extra]) next.delete(k);
      next.delete('page');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, keys.join('|')]);

  const activeCount = keys.filter(k => values[k] !== '' && values[k] !== (defaults[k] ?? '')).length;
  const page = Math.max(1, Number(params.get('page')) || 1);

  return { values, set, clear, activeCount, page, setPage: (p: number) => set({ page: p } as Partial<Record<K | 'page', number>>) };
}
