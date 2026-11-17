/**
 * Who an admin announcement (push or pop-up) is for. Empty = every member.
 * Criteria combine (AND); a list matches any of its values (OR). user-service
 * applies it (`/users/internal/filter-for-announcement`, `count-for-announcement`):
 * a member whose profile lacks a field a criterion needs is not picked.
 */
export interface AnnouncementTargeting {
    countries?: string[];
    subscription?: 'subscribed' | 'unsubscribed';
    sex?: 'male' | 'female';
    interests?: string[];
    professions?: string[];
    ageMin?: number;
    ageMax?: number;
}

const strings = (v: unknown, max: number): string[] =>
    Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '' && x.length <= 120).map(x => x.trim()))].slice(0, max)
        : [];

const age = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 13 && n <= 100 ? n : undefined;
};

export class TargetingError extends Error {}

/** A clean targeting from a request body; null when it asks for nothing (= everyone). Throws TargetingError when contradictory. */
export function targetingFrom(raw: unknown): AnnouncementTargeting | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const countries = strings(r.countries, 60).filter(c => /^[a-z]{2}$/i.test(c)).map(c => c.toUpperCase());
    const interests = strings(r.interests, 100);
    const professions = strings(r.professions, 100);
    const subscription = r.subscription === 'subscribed' || r.subscription === 'unsubscribed' ? r.subscription : undefined;
    const sex = r.sex === 'male' || r.sex === 'female' ? r.sex : undefined;
    const ageMin = age(r.ageMin);
    const ageMax = age(r.ageMax);
    if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) throw new TargetingError("L'âge minimum doit être inférieur ou égal à l'âge maximum.");
    const t: AnnouncementTargeting = {
        ...(countries.length ? { countries } : {}),
        ...(interests.length ? { interests } : {}),
        ...(professions.length ? { professions } : {}),
        ...(subscription ? { subscription } : {}),
        ...(sex ? { sex } : {}),
        ...(ageMin !== undefined ? { ageMin } : {}),
        ...(ageMax !== undefined ? { ageMax } : {}),
    };
    return Object.keys(t).length ? t : null;
}
