/**
 * Members of a country, for the admin `?country=` filters (admin plan, phase 3).
 *
 * Relance configs, targets, campaigns and pack credits carry no country: they
 * belong to the country of their parrain (the owner's userId). user-service's
 * `/users/internal/ids-by-country` gives every member id of a country (deleted
 * members included: their records still belong to their country). The list is
 * kept 5 minutes per country, and concurrent requests share one call.
 *
 * Every relance collection stores user ids as ObjectIds (schema and dev data,
 * checked 2026-11-16), so callers use the ObjectId variant.
 */
import { Response } from 'express';
import { Types } from 'mongoose';
import { userServiceClient } from '../services/clients/user.service.client';
import logger from './logger';

const log = logger.getLogger('CountryMembers');

const TTL_MS = 5 * 60 * 1000;

interface Entry { ids: string[]; set?: Set<string>; objectIds?: Types.ObjectId[]; at: number }

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

/** user-service could not give the members of a country: answer 502, never "no filter". */
export class CountryMembersUnavailableError extends Error {}

/** Swaps the user-service call, for check scripts and tests. */
let resolver: (code: string) => Promise<string[]> = code => userServiceClient.getUserIdsByCountry(code);
export function setCountryMembersResolver(fn: (code: string) => Promise<string[]>): void {
    resolver = fn;
    cache.clear();
    inFlight.clear();
}

async function entryFor(code: string): Promise<Entry> {
    const key = code.toUpperCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = (async () => {
        try {
            const ids = await resolver(key);
            const entry: Entry = { ids, at: Date.now() };
            cache.set(key, entry);
            return entry;
        } catch (error: any) {
            log.error(`Members of ${key} unavailable: ${error?.response?.data?.message ?? error?.message ?? error}`);
            throw new CountryMembersUnavailableError(key);
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, p);
    return p;
}

/** Hex ids of the country's members. Throws CountryMembersUnavailableError. */
export async function memberIdsForCountry(code: string): Promise<string[]> {
    return (await entryFor(code)).ids;
}

/** Same, as a Set of hex strings (built once per cache entry). */
export async function memberIdSetForCountry(code: string): Promise<Set<string>> {
    const entry = await entryFor(code);
    entry.set ??= new Set(entry.ids);
    return entry.set;
}

/** Same, as ObjectIds (converted once per cache entry). */
export async function memberObjectIdsForCountry(code: string): Promise<Types.ObjectId[]> {
    const entry = await entryFor(code);
    entry.objectIds ??= entry.ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
    return entry.objectIds;
}

/** The 502 every admin handler answers when the country cannot be resolved. */
export function answerCountryUnavailable(res: Response): void {
    res.status(502).json({ success: false, message: 'Filtre pays indisponible : le service utilisateurs ne répond pas.' });
}
