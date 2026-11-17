/**
 * Country filter on `users.country`, robust to the stored spellings.
 *
 * The field is mostly ISO-2 upper case, but older rows hold names
 * ("Congo-Brazzaville", "Cameroun", "Bénin", …) and any case. Rather than a
 * case-insensitive regex (no index), the distinct stored values are read once
 * (cached 5 min), each is mapped to its ISO-2 code with the same rules as the
 * normalisation script, and the filter is an exact `$in` on the raw values that
 * map to the requested code — which the `country` index serves.
 *
 * Users with no country (mostly non-African numbers) match no country.
 * `scripts/normalize-user-countries.ts` fills in what can be derived.
 */
import { Model, Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import { determineUserCountryCode } from './phone.utils';

const TTL_MS = 5 * 60 * 1000;
let distinctCache: { at: number; values: string[] } | null = null;
let inFlight: Promise<string[]> | null = null;

/**
 * Stored value → ISO-2 upper case, or null when it cannot be placed.
 * Country field only (no phone fallback): `determineUserCountryCode` knows the
 * African codes and names; any other two-letter value is taken as a code.
 */
export function isoOfCountryValue(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v) return null;
    const code = determineUserCountryCode(v);
    if (code !== 'Autres') return code;
    return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;
}

async function storedCountryValues(): Promise<string[]> {
    if (distinctCache && Date.now() - distinctCache.at < TTL_MS) return distinctCache.values;
    if (!inFlight) {
        // The raw collection: the model's soft-delete hooks do not apply to distinct anyway.
        inFlight = UserModel.collection.distinct('country')
            .then((values) => {
                const strings = values.filter((v): v is string => typeof v === 'string');
                distinctCache = { at: Date.now(), values: strings };
                return strings;
            })
            .finally(() => { inFlight = null; });
    }
    return inFlight;
}

/** Every stored `users.country` spelling that means `iso` (always includes the code itself). */
export async function countryValuesFor(iso: string): Promise<string[]> {
    const code = iso.trim().toUpperCase();
    const out = new Set<string>([code]);
    for (const v of await storedCountryValues()) {
        if (isoOfCountryValue(v) === code) out.add(v);
    }
    return [...out];
}

/** Mongo condition on `users.country` for an ISO-2 code. */
export async function countryCondition(iso: string): Promise<{ $in: string[] }> {
    return { $in: await countryValuesFor(iso) };
}

/** For tests. */
export function resetCountryValuesCache(): void {
    distinctCache = null;
    idsCache.clear();
}

const idsCache = new Map<string, { at: number; ids: Types.ObjectId[] }>();
const idsInFlight = new Map<string, Promise<Types.ObjectId[]>>();

/**
 * `_id`s of the members of a country (deleted ones included: their records
 * still belong to their country). Cached 5 min per country, like the copies
 * other services keep of `GET /users/internal/ids-by-country`.
 */
export async function memberObjectIdsForCountry(iso: string): Promise<Types.ObjectId[]> {
    const code = iso.trim().toUpperCase();
    const hit = idsCache.get(code);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
    let pending = idsInFlight.get(code);
    if (!pending) {
        pending = (async () => {
            const rows = await UserModel.collection
                .find({ country: await countryCondition(code) }, { projection: { _id: 1 } })
                .toArray();
            const ids = rows.map((r) => r._id as unknown as Types.ObjectId);
            idsCache.set(code, { at: Date.now(), ids });
            return ids;
        })().finally(() => idsInFlight.delete(code));
        idsInFlight.set(code, pending);
    }
    return pending;
}

/**
 * `$in` condition restricting `field` (a member ObjectId) of `model` to the
 * members of a country. The country's ids (CM ~48k, BJ ~72k) are intersected
 * with the distinct members actually present in the collection first, so the
 * `$in` stays as short as the collection's own population.
 */
export async function countryMemberIn(
    model: Model<any>,
    field: string,
    iso: string,
    base: Record<string, unknown> = {},
): Promise<{ $in: Types.ObjectId[] }> {
    const [present, members] = await Promise.all([
        model.distinct(field, base) as Promise<unknown[]>,
        memberObjectIdsForCountry(iso),
    ]);
    const inCountry = new Set(members.map(String));
    return { $in: present.filter((v): v is Types.ObjectId => v != null && inCountry.has(String(v))) };
}
