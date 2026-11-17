import { countryCodeToNameMap } from '../utils/countryUtils';

/**
 * Countries for the admin's country filter: ISO-2 code + French name, the
 * countries SBC works in first, then the rest alphabetically. "Tous les pays"
 * (no value) is the default everywhere.
 */
const MAIN_MARKETS = ['CM', 'CI', 'BJ', 'TG', 'SN', 'BF', 'ML', 'NE', 'GA', 'CG', 'CD', 'GN', 'TD', 'GH'];

export interface CountryOption { code: string; name: string; main: boolean }

export const COUNTRIES: CountryOption[] = (() => {
    const all = Object.entries(countryCodeToNameMap)
        .filter(([code]) => /^[A-Z]{2}$/.test(code))
        .map(([code, name]) => ({ code, name, main: MAIN_MARKETS.includes(code) }));
    const main = MAIN_MARKETS.map(c => all.find(a => a.code === c)).filter(Boolean) as CountryOption[];
    const rest = all.filter(a => !a.main).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return [...main, ...rest];
})();

export const countryName = (code?: string | null) =>
    (code && COUNTRIES.find(c => c.code === code.toUpperCase())?.name) || code || '';

export const isCountryCode = (v: unknown): v is string =>
    typeof v === 'string' && COUNTRIES.some(c => c.code === v.toUpperCase());
