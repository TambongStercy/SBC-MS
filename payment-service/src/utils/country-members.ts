/**
 * Country filter of the admin lists/stats (admin plan, phase 3): who the
 * members of a country are, and the Mongo conditions built from that.
 *
 * Member ids come from user-service `GET /users/internal/ids-by-country`
 * (case-insensitive, legacy names, deleted members included), cached here for
 * 5 minutes per country with in-flight de-duplication: a dashboard opens
 * several stats at once and they share one call.
 *
 * Read-only helpers: nothing here touches money, statuses or balances.
 */
import { Response } from 'express';
import { Types } from 'mongoose';
import { userServiceClient } from '../services/clients/user.service.client';
import { AdminFilterError } from './admin-filters';
import logger from './logger';

const log = logger.getLogger('CountryMembers');

const TTL_MS = 5 * 60 * 1000;

/** The member lookup failed: the caller answers 502, never "no filter". */
export class CountryLookupError extends Error {
    readonly statusCode = 502;
    constructor() {
        super('Filtre pays indisponible : le service utilisateurs ne répond pas.');
    }
}

type Resolver = (country: string) => Promise<string[]>;

let resolver: Resolver = (country) => userServiceClient.getUserIdsByCountry(country);

interface Entry { at: number; ids: Promise<string[]>; objectIds?: Promise<Types.ObjectId[]> }
const cache = new Map<string, Entry>();

/** Check scripts only: replace the user-service call (and empty the cache). */
export function setCountryMembersResolver(fn: Resolver): void {
    resolver = fn;
    cache.clear();
}

function entryFor(country: string): Entry {
    const code = country.toUpperCase();
    const hit = cache.get(code);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;

    const ids = resolver(code).catch((error: any) => {
        cache.delete(code); // never cache a failure
        log.error(`ids-by-country ${code} failed: ${error?.message || error}`);
        throw new CountryLookupError();
    });
    const entry: Entry = { at: Date.now(), ids };
    cache.set(code, entry);
    return entry;
}

/** Member ids of a country, as hex strings (for collections storing string ids). */
export function memberIdsForCountry(country: string): Promise<string[]> {
    return entryFor(country).ids;
}

/** Same, as ObjectIds (for collections storing ObjectId ids, e.g. transactions). */
export function memberObjectIdsForCountry(country: string): Promise<Types.ObjectId[]> {
    const entry = entryFor(country);
    if (!entry.objectIds) {
        entry.objectIds = entry.ids.then(ids =>
            ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id)));
    }
    return entry.objectIds;
}

/** Stored codes are upper case, a few lower case: exact `$in` keeps it index-friendly. */
export function countryCodeVariants(country: string): string[] {
    return [country.toUpperCase(), country.toLowerCase()];
}

/**
 * Records that carry their own country code, which is missing on older ones
 * (73% of payment intents, every withdrawal before mid-2025): the record's code
 * when it has a real ISO-2 one, otherwise its member's country.
 * Returns a condition to put inside `$and` (it is an `$or`).
 */
export function directOrMemberCountryMatch(
    codeField: string,
    userField: string,
    country: string,
    memberIds: Array<string | Types.ObjectId>,
): Record<string, unknown> {
    return {
        $or: [
            { [codeField]: { $in: countryCodeVariants(country) } },
            { [codeField]: { $not: /^[A-Za-z]{2}$/ }, [userField]: { $in: memberIds } },
        ],
    };
}

/**
 * Answers a filter error (400 bad input, 502 member lookup down) and returns
 * true; returns false for any other error, which the caller handles as before.
 */
export function sendFilterError(res: Response, error: unknown): boolean {
    if (error instanceof AdminFilterError || error instanceof CountryLookupError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return true;
    }
    return false;
}
