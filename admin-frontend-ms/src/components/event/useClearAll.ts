import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const SHARED = ['pays', 'periode', 'du', 'au', 'page'];

/**
 * Clears the page's own URL filters and the shared country/period in ONE
 * URL update. Two updates in a row (filters.reset() then f.clear()) would each
 * start from the same old URL, and the second would bring back what the first removed.
 */
export function useClearAll(keys: readonly string[]) {
  const [, setParams] = useSearchParams();
  return useCallback(() => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const k of [...keys, ...SHARED]) next.delete(k);
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, keys.join('|')]);
}
