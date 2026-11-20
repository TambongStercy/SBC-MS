/**
 * Security plan Phase 10, item 5: check the Mobile Money number before it is
 * sent to the provider. Only for countries where the member types the number on
 * our page (FeexPay: BJ, TG, CG); the hosted checkouts (MoneyFusion, CinetPay)
 * ask for it themselves.
 *
 * The number is the national part (dialling code and non-digits removed).
 * Rules are deliberately broad: they only catch numbers no operator of the
 * country can have (wrong length, letters, a pasted dialling code twice).
 *
 * `PAYIN_NUMBER_CHECK` (payment-service .env):
 * - `log` (default): a number that fails is recorded on the payment
 *   (`metadata.numberCheck`) and still sent, so the rules can be measured
 *   against real successes before they block anyone;
 * - `enforce`: refused with a French message before reaching the provider;
 * - `off`: not checked.
 */
export type NumberCheckMode = 'off' | 'log' | 'enforce';

export function numberCheckMode(): NumberCheckMode {
    const v = String(process.env.PAYIN_NUMBER_CHECK || 'log').toLowerCase();
    return v === 'off' || v === 'enforce' ? v : 'log';
}

interface CountryRule { dial: string; test: (n: string) => boolean; expected: string }

const RULES: Record<string, CountryRule> = {
    // Benin moved to 10 digits ("01" + old 8) in Nov 2024; old 8-digit numbers are still typed.
    BJ: { dial: '229', test: n => /^01\d{8}$/.test(n) || /^\d{8}$/.test(n), expected: '10 chiffres commençant par 01 (ex. 01 97 00 00 00)' },
    TG: { dial: '228', test: n => /^[79]\d{7}$/.test(n), expected: '8 chiffres commençant par 7 ou 9 (ex. 90 00 00 00)' },
    // Congo-Brazzaville keeps its leading 0 (see CLAUDE.md "Phone formats").
    CG: { dial: '242', test: n => /^0\d{8}$/.test(n), expected: '9 chiffres commençant par 0 (ex. 06 000 00 00)' },
};

export interface NumberCheck { ok: boolean; national?: string; expected?: string }

/** Whether `phone` can be a Mobile Money number of `country`. Countries without a rule pass. */
export function checkPayinNumber(country: string | undefined, phone: string | undefined): NumberCheck {
    const rule = country ? RULES[country.toUpperCase()] : undefined;
    if (!rule || !phone) return { ok: true };
    let n = String(phone).replace(/\D/g, '');
    if (n.startsWith('00' + rule.dial)) n = n.slice(2 + rule.dial.length);
    else if (n.startsWith(rule.dial) && n.length > rule.dial.length + 7) n = n.slice(rule.dial.length);
    return rule.test(n) ? { ok: true, national: n } : { ok: false, national: n, expected: rule.expected };
}

export const NUMBER_CHECK_COUNTRIES = Object.keys(RULES);
