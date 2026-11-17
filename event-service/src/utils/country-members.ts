/**
 * Member ids of one country, for the admin `?country=` filter (admin plan, phase 3).
 *
 * event-service has no member country of its own: user-service resolves it
 * (`/users/internal/ids-by-country`, deleted members included). Cached 5 min per
 * country in process, with in-flight de-duplication. A failed call is a 502 —
 * never "no filter".
 */
import { Types } from 'mongoose';
import { getUserIdsByCountry } from '../services/clients/user.service.client';
import { AppError } from './errors';
import logger from './logger';

const log = logger.getLogger('CountryMembers');

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ids: string[] }>();
const inFlight = new Map<string, Promise<string[]>>();

/** Swappable for the check script (no real user-service call there). */
export let resolveMemberIds: (country: string) => Promise<string[]> = getUserIdsByCountry;
export const setMemberIdsResolver = (fn: (country: string) => Promise<string[]>) => {
    resolveMemberIds = fn;
    cache.clear();
};

export const COUNTRY_UNAVAILABLE = 'Filtre pays indisponible : le service utilisateurs ne répond pas.';

/** Member ids (hex strings) of `code` (ISO-2). Throws a 502 AppError if user-service fails. */
export const memberIdsForCountry = async (code: string): Promise<string[]> => {
    const key = code.toUpperCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = resolveMemberIds(key)
        .then((ids) => {
            cache.set(key, { at: Date.now(), ids });
            return ids;
        })
        .catch((err) => {
            log.error(`ids-by-country ${key} failed: ${(err as Error).message}`);
            throw new AppError(COUNTRY_UNAVAILABLE, 502);
        })
        .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
};

/** Same, as a Set (membership tests on small candidate lists). */
export const memberIdSetForCountry = async (code: string): Promise<Set<string>> =>
    new Set(await memberIdsForCountry(code));

/** Same, as ObjectIds (event-service stores user ids as ObjectIds). */
export const memberObjectIdsForCountry = async (code: string): Promise<Types.ObjectId[]> =>
    (await memberIdsForCountry(code)).filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
