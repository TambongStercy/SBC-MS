/**
 * Country of an event, for the admin `?country=` filter (admin plan, phase 3).
 *
 * `events.country` is free text typed by the organizer: an ISO-2 code in any
 * case ("CM", "cm") or a country name in French or English, with or without
 * accents ("Cameroun", "Cameroon", "Côte d'Ivoire"). Rather than guess with
 * regexes, we read the few distinct values stored, normalise each one to an
 * ISO-2 code here, and filter with an exact `$in` of the raw values that map
 * to the requested code (index-friendly, any spelling).
 *
 * Everything that belongs to an event (orders, tickets, listings, disputes,
 * commissions, animation records…) is scoped by the ids of the matching events.
 */
import { Types } from 'mongoose';
import Event from '../database/models/event.model';
import Organizer from '../database/models/organizer.model';
import { memberIdSetForCountry } from './country-members';

/** Names → ISO-2 (normalised keys: lower case, no accents, single spaces). */
const NAMES: Record<string, string> = {};
const add = (code: string, ...names: string[]) => { for (const n of names) NAMES[normalizeName(n)] = code; };

export function normalizeName(raw: string): string {
    return raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[’'`]/g, ' ')
        .replace(/[-_.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Africa (borrowed from user-service `countryNameVariations`).
add('DZ', 'algeria', 'algérie');
add('EG', 'egypt', 'égypte');
add('LY', 'libya', 'libye');
add('MA', 'morocco', 'maroc');
add('SD', 'sudan', 'soudan');
add('TN', 'tunisia', 'tunisie');
add('SS', 'south sudan', 'soudan du sud');
add('BJ', 'benin', 'bénin', 'republic of benin', 'république du bénin');
add('BF', 'burkina faso', 'burkina', 'burkinafaso');
add('CV', 'cape verde', 'cap vert', 'cabo verde');
add('CI', "cote d'ivoire", "côte d'ivoire", 'cote divoire', 'cotedivoire', 'ivory coast');
add('GM', 'gambia', 'gambie', 'the gambia');
add('GH', 'ghana');
add('GN', 'guinea', 'guinée', 'guinee', 'guinea conakry', 'guinée conakry');
add('GW', 'guinea bissau', 'guinée bissau', 'guiné bissau');
add('LR', 'liberia', 'libéria');
add('ML', 'mali');
add('MR', 'mauritania', 'mauritanie');
add('NE', 'niger');
add('NG', 'nigeria', 'nigéria');
add('SN', 'senegal', 'sénégal');
add('SL', 'sierra leone');
add('TG', 'togo');
add('AO', 'angola');
add('CM', 'cameroon', 'cameroun', 'camerun', 'kamerun', 'republic of cameroon', 'république du cameroun');
add('CF', 'central african republic', 'république centrafricaine', 'centrafrique');
add('TD', 'chad', 'tchad');
add('CG', 'congo', 'republic of congo', 'congo brazzaville', 'république du congo', 'congo republic');
add('CD', 'democratic republic of congo', 'dr congo', 'drc', 'rdc', 'congo kinshasa',
    'république démocratique du congo', 'zaire');
add('GQ', 'equatorial guinea', 'guinée équatoriale');
add('GA', 'gabon');
add('ST', 'sao tome and principe', 'são tomé et príncipe', 'sao tome');
add('BI', 'burundi');
add('KM', 'comoros', 'comores');
add('DJ', 'djibouti');
add('ER', 'eritrea', 'érythrée');
add('ET', 'ethiopia', 'éthiopie');
add('KE', 'kenya');
add('MG', 'madagascar');
add('MW', 'malawi');
add('MU', 'mauritius', 'maurice', 'île maurice');
add('MZ', 'mozambique');
add('RW', 'rwanda');
add('SC', 'seychelles');
add('SO', 'somalia', 'somalie');
add('TZ', 'tanzania', 'tanzanie');
add('UG', 'uganda', 'ouganda');
add('BW', 'botswana');
add('SZ', 'eswatini', 'swaziland');
add('LS', 'lesotho');
add('NA', 'namibia', 'namibie');
add('ZA', 'south africa', 'afrique du sud');
add('ZM', 'zambia', 'zambie');
add('ZW', 'zimbabwe');
// Diaspora countries most likely to host an SBC event.
add('FR', 'france');
add('BE', 'belgium', 'belgique');
add('CH', 'switzerland', 'suisse');
add('DE', 'germany', 'allemagne');
add('GB', 'united kingdom', 'royaume uni', 'uk', 'england', 'angleterre');
add('IT', 'italy', 'italie');
add('ES', 'spain', 'espagne');
add('CA', 'canada');
add('US', 'united states', 'usa', 'etats unis', 'états unis', "etats unis d'amerique");
add('CN', 'china', 'chine');
add('AE', 'united arab emirates', 'emirats arabes unis', 'dubai', 'dubaï');

/** ISO-2 of a stored `events.country` value, or undefined when unknown/empty. */
export function eventCountryCode(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const t = raw.trim();
    if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
    return NAMES[normalizeName(t)];
}

/** The raw `events.country` values (exact spellings) that mean `code`. */
export async function eventCountryValues(code: string): Promise<string[]> {
    const raws: unknown[] = await Event.distinct('country');
    return raws.filter((r): r is string => eventCountryCode(r) === code.toUpperCase());
}

/** Mongo filter on `events` for that country (`$in: []` when no event matches). */
export async function eventCountryMatch(code: string): Promise<{ country: { $in: string[] } }> {
    return { country: { $in: await eventCountryValues(code) } };
}

/** Ids of the events held in `code` (ISO-2). */
export async function eventIdsForCountry(code: string): Promise<Types.ObjectId[]> {
    return Event.find(await eventCountryMatch(code)).distinct('_id');
}

/**
 * Event scope for records that carry an `eventId`: undefined = no country
 * filter; otherwise the ids to `$in` on.
 */
export async function eventScope(country?: string): Promise<Types.ObjectId[] | undefined> {
    return country ? eventIdsForCountry(country) : undefined;
}

/**
 * Adds `{ [field]: { $in: ids } }` to `filter` without clobbering an existing
 * condition on the same field (e.g. `?eventId=` + `?country=`): both apply.
 */
export function andIn(filter: Record<string, any>, field: string, ids: Types.ObjectId[] | undefined): void {
    if (!ids) return;
    (filter.$and ||= []).push({ [field]: { $in: ids } });
}

/**
 * Organizers of a country. An organizer's country is where its events take
 * place (an organizer with events in CM and BJ belongs to both). An organizer
 * with no event at all yet is placed by its member account's country
 * (user-service ids-by-country — a 502 if user-service fails).
 */
export async function organizerIdsForCountry(code: string): Promise<Types.ObjectId[]> {
    const [byEvents, withEvents] = await Promise.all([
        Event.find(await eventCountryMatch(code)).distinct('organizerId') as Promise<Types.ObjectId[]>,
        Event.distinct('organizerId') as Promise<Types.ObjectId[]>,
    ]);
    // Few organizers have no event: load those (small) and test their member id.
    const eventless = await Organizer.find({ _id: { $nin: withEvents } }).select('userId').lean();
    let byMember: Types.ObjectId[] = [];
    if (eventless.length) {
        const members = await memberIdSetForCountry(code);
        byMember = eventless.filter((o) => members.has(String(o.userId))).map((o) => o._id as Types.ObjectId);
    }
    return [...byEvents, ...byMember];
}
