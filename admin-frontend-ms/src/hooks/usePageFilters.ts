import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_PERIOD, DateRange, PeriodKey, isPeriodKey, rangeFor, toDateInput } from '../lib/period';
import { isCountryCode } from '../lib/countries';

/**
 * Country + period filters shared by every admin page, kept in the URL
 * (?pays=CM&periode=thisMonth, custom: &du=2026-11-01&au=2026-11-16) so a
 * filtered view can be shared and survives a reload.
 *
 *   const filters = usePageFilters();
 *   api.list({ ...otherParams, ...filters.apiParams });   // { country?, from?, to? }
 *   <PageFilters filters={filters}>{page-specific filters}</PageFilters>
 *
 * apiParams only carries what is set: "Tous les pays" sends no country,
 * "Toute la période" no dates. `from`/`to` are ISO instants (inclusive).
 */
export interface PageFilters {
    country: string;               // '' = Tous les pays
    period: PeriodKey;
    range: DateRange;
    custom: { from: string; to: string }; // yyyy-MM-dd, for the custom inputs
    apiParams: { country?: string; from?: string; to?: string };
    isFiltered: boolean;
    setCountry: (code: string) => void;
    setPeriod: (key: PeriodKey) => void;
    setCustomRange: (from: string, to: string) => void;
    /** Clears country + period, plus the page's own URL keys given here, in ONE URL update. */
    // Accepts anything so `onClick={filters.reset}` keeps working (the click event is ignored).
    reset: (extraKeys?: string[] | unknown) => void;
}

export function usePageFilters(): PageFilters {
    const [params, setParams] = useSearchParams();

    const rawCountry = params.get('pays') || '';
    const country = isCountryCode(rawCountry) ? rawCountry.toUpperCase() : '';
    const rawPeriod = params.get('periode');
    const period: PeriodKey = isPeriodKey(rawPeriod) ? rawPeriod : DEFAULT_PERIOD;
    const customFrom = params.get('du') || '';
    const customTo = params.get('au') || '';

    const range = useMemo(
        () => rangeFor(period, { from: customFrom, to: customTo }),
        [period, customFrom, customTo],
    );

    const apiParams = useMemo(() => ({
        ...(country ? { country } : {}),
        ...(range.from ? { from: range.from.toISOString() } : {}),
        ...(range.to ? { to: range.to.toISOString() } : {}),
    }), [country, range]);

    const update = useCallback((mutate: (p: URLSearchParams) => void) => {
        setParams(prev => {
            // Start from the live URL, not this render's snapshot: a page's own
            // URL update made in the same tick (e.g. its onReset) is already in
            // window.location (BrowserRouter writes it synchronously) and must
            // not be overwritten.
            const next = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : prev);
            mutate(next);
            // Any page index belongs to the previous filters.
            next.delete('page');
            return next;
        }, { replace: true });
    }, [setParams]);

    const setCountry = useCallback((code: string) => update(p => {
        if (code) p.set('pays', code); else p.delete('pays');
    }), [update]);

    const setPeriod = useCallback((key: PeriodKey) => update(p => {
        if (key === DEFAULT_PERIOD) p.delete('periode'); else p.set('periode', key);
        if (key !== 'custom') { p.delete('du'); p.delete('au'); }
        else if (!p.get('du')) {
            // Start the custom range on the current month, which the admin then adjusts.
            const r = rangeFor('thisMonth');
            p.set('du', toDateInput(r.from));
            p.set('au', toDateInput(r.to));
        }
    }), [update]);

    const setCustomRange = useCallback((from: string, to: string) => update(p => {
        p.set('periode', 'custom');
        if (from) p.set('du', from); else p.delete('du');
        if (to) p.set('au', to); else p.delete('au');
    }), [update]);

    const reset = useCallback((extraKeys?: string[] | unknown) => update(p => {
        const extra = Array.isArray(extraKeys) ? extraKeys.filter((k): k is string => typeof k === 'string') : [];
        ['pays', 'periode', 'du', 'au', ...extra].forEach(k => p.delete(k));
    }), [update]);

    return {
        country, period, range,
        custom: { from: customFrom, to: customTo },
        apiParams,
        isFiltered: !!country || period !== DEFAULT_PERIOD,
        setCountry, setPeriod, setCustomRange, reset,
    };
}
