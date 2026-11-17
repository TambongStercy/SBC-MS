/**
 * Mongo conditions for the admin filters (country, from, to) of payment-service
 * lists and stats. Query filters only: nothing here changes what a figure means.
 */
import { AdminFilters } from './admin-filters';
import { memberObjectIdsForCountry } from './country-members';

/**
 * `{ [field]: { $in: <member ObjectIds> } }` for ?country, `{}` without it.
 * For collections whose user id is an ObjectId (transactions: all 187k dev rows).
 * Throws CountryLookupError (→ 502) if user-service does not answer.
 */
export async function memberObjectIdMatch(filters: AdminFilters, field = 'userId'): Promise<Record<string, any>> {
    if (!filters.country) return {};
    return { [field]: { $in: await memberObjectIdsForCountry(filters.country) } };
}

/**
 * Narrows an existing `{ $gte?, $lte? }` range (e.g. from the older
 * startDate/endDate params) with ?from/?to; both apply when both are sent.
 * Returns undefined when there is no bound at all.
 */
export function narrowRange(
    existing: { $gte?: Date; $lte?: Date } | undefined,
    filters: AdminFilters,
): { $gte?: Date; $lte?: Date } | undefined {
    const range: { $gte?: Date; $lte?: Date } = { ...(existing || {}) };
    if (filters.from && (!range.$gte || filters.from > range.$gte)) range.$gte = filters.from;
    if (filters.to && (!range.$lte || filters.to < range.$lte)) range.$lte = filters.to;
    return range.$gte || range.$lte ? range : undefined;
}
