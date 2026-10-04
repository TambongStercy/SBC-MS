import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The value, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 350): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

/** A piece of UI state kept in the address (?key=value): survives refresh and back. */
export function useParamState(key: string, fallback: string): [string, (v: string) => void] {
    const [params, setParams] = useSearchParams();
    const value = params.get(key) ?? fallback;
    // Functional update: several setters in one tick (e.g. "clear all") each
    // start from the latest address, not the same stale copy.
    const set = (v: string) => {
        setParams(prev => {
            const next = new URLSearchParams(prev);
            if (v === fallback) next.delete(key); else next.set(key, v);
            return next;
        }, { replace: true });
    };
    return [value, set];
}

/** True below the phone/desktop breakpoint (1024px), updated on resize. */
export function useIsPhone(): boolean {
    const query = '(max-width: 1023px)';
    const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
    useEffect(() => {
        const m = window.matchMedia(query);
        const on = () => setPhone(m.matches);
        m.addEventListener('change', on);
        return () => m.removeEventListener('change', on);
    }, []);
    return phone;
}

/** The API's own message when there is one, else the fallback. */
export function errorMessage(err: unknown, fallback = "Une erreur s'est produite. Réessaie."): string {
    const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
    return e?.response?.data?.message || e?.response?.data?.error || (e?.message && !/^Request failed/.test(e.message) ? e.message : '') || fallback;
}
