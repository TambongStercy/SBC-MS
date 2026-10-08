import { getCountryCodeFromPhoneNumber } from './operatorMaps';

/**
 * Payer fields for a CinetPay checkout (POST /v1/payment).
 *
 * CinetPay asks for the real payer on every transaction (traceability and
 * compliance). Until 2026-10 we sent `User-<id>` / `SBC` / `no-email@sbc.com`,
 * which is what their dashboard showed for every payment.
 *
 * Their limits: first and last name 2–255 characters, a valid email, and the
 * phone in international form (`+` then 8–15 digits).
 */
export interface CinetPayPayer {
    client_first_name: string;
    client_last_name: string;
    client_email: string;
    client_phone_number?: string;
}

export interface PayerSource {
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_EMAIL = 'no-email@sbc.com';

const clip = (s: string) => s.substring(0, 255);

/** First word is the first name, the rest the last name. A one-word name fills both. */
const splitName = (name: string): { first: string; last: string } => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { first: '', last: '' };
    if (words.length === 1) return { first: words[0], last: words[0] };
    const [first, ...rest] = words;
    return { first, last: rest.join(' ') };
};

/**
 * Stored user phones are dialling code + national number, digits only
 * (user-service normalises on save; Congo-Brazzaville keeps its 0). Older
 * records may lack the code, so a number is only sent when it starts with a
 * dialling code we know — a guessed `+6…` would be a wrong country.
 */
export const toInternationalPhone = (phone?: string | number | null): string | undefined => {
    if (phone === undefined || phone === null) return undefined;
    const digits = phone.toString().replace(/\D/g, '').replace(/^00/, '');
    if (!/^\d{8,15}$/.test(digits)) return undefined;
    if (!getCountryCodeFromPhoneNumber(digits)) return undefined;
    return `+${digits}`;
};

/**
 * The phone is only sent when it belongs to the country being charged: each
 * CinetPay country is a separate merchant account, and a foreign number there
 * risks a refused checkout over an optional field.
 */
export const buildCinetPayPayer = (user: PayerSource | null | undefined, userId: string, countryCode: string): CinetPayPayer => {
    const fullName = (user?.name || '').trim().replace(/\s+/g, ' ');
    let { first, last } = splitName(fullName);
    if (first.length < 2 || last.length < 2) {
        // e.g. "A Mbarga": keep the real name rather than a placeholder.
        first = last = fullName.length >= 2 ? fullName : '';
    }
    const email = user?.email?.trim();

    const payer: CinetPayPayer = {
        client_first_name: clip(first || `User-${userId}`),
        client_last_name: clip(last || 'SBC'),
        client_email: email && EMAIL_RE.test(email) ? email : FALLBACK_EMAIL,
    };
    const phone = toInternationalPhone(user?.phoneNumber);
    if (phone && getCountryCodeFromPhoneNumber(phone) === countryCode.toUpperCase()) {
        payer.client_phone_number = phone;
    }
    return payer;
};
