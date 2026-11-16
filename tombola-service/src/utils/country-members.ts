/**
 * Member ids per country, for the admin `?country=` filter (admin plan, phase 3).
 *
 * The country lives on the member (user-service), not on this service's
 * records, so the filter is "records whose member is one of these ids".
 * user-service answers in ~0.25 s even for the biggest countries (BJ ≈ 72k
 * ids); the list is cached here 5 minutes per country so paging through an
 * admin list does not ask again, and concurrent requests share one call.
 *
 * A failed lookup throws CountryFilterUnavailableError (502): falling back to
 * "no filter" would show every country under a country heading.
 */
import { Types } from 'mongoose';
import { userServiceClient } from '../services/clients/user.service.client';
import { AppError } from './errors';

const TTL_MS = 5 * 60 * 1000;

/** An AppError, so every existing handler answers it as a 502 with this message. */
export class CountryFilterUnavailableError extends AppError {
    constructor() {
        super('Filtre pays indisponible : le service utilisateurs ne répond pas.', 502);
    }
}

type Resolver = (country: string) => Promise<string[]>;

let resolver: Resolver = (country) => userServiceClient.getUserIdsByCountry(country);
const cache = new Map<string, { ids: string[]; expiresAt: number }>();
const inFlight = new Map<string, Promise<string[]>>();

/** Hex ids of every member of `country` (ISO-2, any case), deleted members included. */
export async function memberIdsForCountry(country: string): Promise<string[]> {
    const key = country.toUpperCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.ids;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const call = resolver(key)
        .then((ids) => {
            cache.set(key, { ids, expiresAt: Date.now() + TTL_MS });
            return ids;
        })
        .catch(() => {
            throw new CountryFilterUnavailableError();
        })
        .finally(() => inFlight.delete(key));
    inFlight.set(key, call);
    return call;
}

/** Same ids as a Set, for intersecting with ids already loaded. */
export async function memberIdSetForCountry(country: string): Promise<Set<string>> {
    return new Set(await memberIdsForCountry(country));
}

/**
 * The ids among `candidates` (members already seen on the records being
 * listed) that belong to `country`, as ObjectIds. Intersecting in memory keeps
 * the Mongo `$in` to the members actually present, not the ~50–70k of a big
 * country.
 */
export async function keepMembersOfCountry(candidates: (string | Types.ObjectId)[], country: string): Promise<Types.ObjectId[]> {
    const inCountry = await memberIdSetForCountry(country);
    return candidates.map(String).filter((id) => inCountry.has(id)).map((id) => new Types.ObjectId(id));
}

/** ObjectId variant, for collections storing user ids as ObjectIds. */
export async function memberObjectIdsForCountry(country: string): Promise<Types.ObjectId[]> {
    return (await memberIdsForCountry(country)).map((id) => new Types.ObjectId(id));
}

/** Test hook (check scripts): replace the user-service call and empty the cache. */
export function setCountryResolverForTests(fn: Resolver): void {
    resolver = fn;
    cache.clear();
    inFlight.clear();
}
