import { isSamePhoneNumber, normalizePhoneNumber } from './phone.utils';

/**
 * Mobile Money details of a member (the number and operator that receive
 * withdrawals). Shared by the profile save, which must let unchanged details
 * through, and the code flow that changes them (user.service.ts).
 */
export interface MomoDetails {
    momoNumber?: string | null;
    momoOperator?: string | null;
}

/** Operator codes as stored (`MTN_MOMO_CMR`, `ORANGE_BFA`, `OM_BF`…). */
export const MOMO_OPERATOR_PATTERN = /^[A-Z0-9_]{2,40}$/;

export function normalizeMomoOperator(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase();
}

/** The number in its stored form (dialling code + national number), or null. */
export function normalizeMomoNumber(raw: unknown, countryIso?: string | null): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const normalized = normalizePhoneNumber(raw, countryIso || undefined);
    return normalized && normalized.replace(/\D/g, '').length >= 8 ? normalized : null;
}

/**
 * Whether a profile save leaves the MoMo details as they are. An absent or
 * empty field counts as unchanged: the page resends what it shows, and blanks
 * an operator it does not know for the country. Numbers are compared in any
 * format (with or without the dialling code).
 */
export function isSameMomo(current: MomoDetails, sent: MomoDetails, countryIso?: string | null): boolean {
    const sentNumber = typeof sent.momoNumber === 'string' ? sent.momoNumber.trim() : '';
    const sentOperator = normalizeMomoOperator(sent.momoOperator);
    if (sentNumber) {
        const currentNumber = String(current.momoNumber ?? '');
        if (!currentNumber) return false;
        const normalized = normalizeMomoNumber(sentNumber, countryIso) ?? sentNumber;
        if (!isSamePhoneNumber(currentNumber, normalized) && !isSamePhoneNumber(currentNumber, sentNumber)) return false;
    }
    if (sentOperator && sentOperator !== normalizeMomoOperator(current.momoOperator)) return false;
    return true;
}

/** The OTP target that binds a code to one number + operator. */
export function momoChangeTarget(number: string, operator: string): string {
    return `${number.replace(/\D/g, '')}|${operator}`;
}
