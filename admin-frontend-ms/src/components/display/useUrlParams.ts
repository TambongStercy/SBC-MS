import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filter state kept in the URL (?statut=…&page=…), so a filtered list can be
 * reloaded, shared and survives "back". An empty value removes the key.
 * Changing any filter other than `page` sends the list back to page 1.
 */
export function useUrlParams<K extends string>(defaults: Record<K, string>) {
    const [params, setParams] = useSearchParams();
    const get = (key: K) => params.get(key) ?? defaults[key];
    const set = useCallback((patch: Partial<Record<K, string>>) => {
        setParams(prev => {
            const next = new URLSearchParams(prev);
            for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
                if (v === undefined || v === '' || v === (defaults as Record<string, string>)[k]) next.delete(k);
                else next.set(k, v);
            }
            if (!('page' in patch)) next.delete('page');
            return next;
        }, { replace: true });
    }, [setParams, defaults]);
    const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
    const active = (Object.keys(defaults) as K[]).some(k => k !== 'page' && params.get(k) !== null && params.get(k) !== defaults[k]);
    return { get, set, clear, active };
}
