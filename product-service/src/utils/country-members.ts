/**
 * Members of a country, for the admin `?country=` filter (admin plan, phase 3).
 *
 * Products and flash sales store no country: they belong to their seller's
 * country (`userId` / `sellerUserId`, ObjectIds). The ids come from
 * user-service (`ids-by-country`, deleted members included), cached 5 minutes
 * per country with in-flight de-duplication.
 *
 * Filtering a collection with `$in` of the whole country (CM ≈ 48k ids, BJ ≈ 72k)
 * is the slow part (products: 190–370 ms per query on the dev copy, and the
 * admin list runs two), so callers intersect it first with the sellers actually
 * present in the collection (`countryMembersAmong`, ~2k sellers for CM/BJ out of
 * ~7k): about 25 ms per query.
 */
import { Types } from 'mongoose';
import { userServiceClient } from '../services/clients/user.service.client';

export class CountryFilterUnavailableError extends Error {
    readonly statusCode = 502;
    constructor() {
        super('Filtre pays indisponible : le service utilisateurs ne répond pas.');
    }
}

type Resolver = (country: string) => Promise<string[]>;

const TTL_MS = 5 * 60 * 1000;
const defaultResolver: Resolver = country => userServiceClient.getUserIdsByCountry(country);
let resolver: Resolver = defaultResolver;
const cache = new Map<string, { at: number; ids: Set<string> }>();
const inFlight = new Map<string, Promise<Set<string>>>();

/** For check scripts: answer from a stub instead of user-service (and clear the cache). */
export const setCountryMembersResolver = (stub?: Resolver): void => {
    resolver = stub ?? defaultResolver;
    cache.clear();
    inFlight.clear();
};

const memberSet = async (country: string): Promise<Set<string>> => {
    const code = country.toUpperCase();
    const hit = cache.get(code);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

    const pending = inFlight.get(code);
    if (pending) return pending;

    const load = (async () => {
        try {
            const ids = new Set((await resolver(code)).map(String));
            cache.set(code, { at: Date.now(), ids });
            return ids;
        } catch {
            throw new CountryFilterUnavailableError();
        } finally {
            inFlight.delete(code);
        }
    })();
    inFlight.set(code, load);
    return load;
};

/** Every member id of the country (hex strings). Throws CountryFilterUnavailableError. */
export const memberIdsForCountry = async (country: string): Promise<string[]> => [...await memberSet(country)];

/** Same, as ObjectIds (every user id in this service's collections is an ObjectId). */
export const memberObjectIdsForCountry = async (country: string): Promise<Types.ObjectId[]> =>
    (await memberIdsForCountry(country)).map(id => new Types.ObjectId(id));

/**
 * Of `candidates` (the distinct owner ids found in a collection), those who are
 * members of the country. A short `$in` instead of the whole country's.
 */
export const countryMembersAmong = async (
    country: string,
    candidates: Array<Types.ObjectId | string | null | undefined>,
): Promise<Types.ObjectId[]> => {
    const members = await memberSet(country);
    const out: Types.ObjectId[] = [];
    for (const c of candidates) {
        if (c && members.has(String(c))) out.push(new Types.ObjectId(String(c)));
    }
    return out;
};
