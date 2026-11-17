import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDateTime } from '../common/format';

/** Keys cleared by "Effacer les filtres": this page's own plus the shared country/period ones (usePageFilters). */
export const SHARED_RESET_KEYS = ['q', 'page', 'pays', 'periode', 'du', 'au'];

export const fullDate = (d?: string | null) => (d ? formatDateTime(d) : '—');

/**
 * Search text and page kept in the URL (`q`, `page`), the search applied
 * 400 ms after typing stops.
 */
export function useUrlSearchAndPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [input, setInput] = useState(q);

  // Keep the box in step when the URL changes from elsewhere (tab switch, clear).
  useEffect(() => { setInput(q); }, [q]);

  useEffect(() => {
    if (input === q) return;
    const t = window.setTimeout(() => {
      setParams(prev => {
        const next = new URLSearchParams(prev);
        if (input.trim()) next.set('q', input); else next.delete('q');
        next.delete('page');
        return next;
      }, { replace: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [input, q, setParams]);

  const setPage = (p: number) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (p > 1) next.set('page', String(p)); else next.delete('page');
    return next;
  });

  const clear = () => {
    setInput('');
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('page');
      return next;
    }, { replace: true });
  };

  /** Search, page AND the shared country/period keys, in one URL update (two would overwrite each other). */
  const clearAll = () => {
    setInput('');
    setParams(prev => {
      const next = new URLSearchParams(prev);
      SHARED_RESET_KEYS.forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  };

  return { input, setInput, q: q.trim(), page, setPage, clear, clearAll };
}
