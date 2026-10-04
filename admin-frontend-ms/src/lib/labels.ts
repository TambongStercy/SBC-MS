import type { Tone } from '../ui';
import { countryCodeToNameMap } from '../utils/countryUtils';

/** Ledger and withdrawal statuses, as admins should read them. */
export const TX_STATUS: Record<string, [string, Tone]> = {
    completed: ['Payé', 'success'],
    pending_admin_approval: ['À valider', 'warning'],
    processing: ['Chez le fournisseur', 'primary'],
    pending: ['En attente', 'neutral'],
    pending_otp_verification: ['Code non confirmé', 'neutral'],
    rejected_by_admin: ['Refusé', 'danger'],
    failed: ['Échoué', 'danger'],
    cancelled: ['Annulé', 'neutral'],
    refunded: ['Remboursé', 'accent'],
};

/** Payment attempts (PaymentIntent). */
export const PAYMENT_STATUS: Record<string, [string, Tone]> = {
    SUCCEEDED: ['Réussi', 'success'],
    FAILED: ['Échoué', 'danger'],
    CANCELED: ['Annulé', 'neutral'],
    CANCELLED: ['Annulé', 'neutral'],
    PENDING_USER_INPUT: ['Commencé, pas payé', 'neutral'],
    PENDING_PROVIDER: ['En attente du fournisseur', 'warning'],
    PROCESSING: ['En cours', 'primary'],
    REQUIRES_ACTION: ['Action requise', 'warning'],
    ERROR: ['Erreur', 'danger'],
    EXPIRED: ['Expiré', 'neutral'],
};

const OPERATOR_PREFIX: Array<[RegExp, string]> = [
    [/^ORANGE/i, 'Orange Money'],
    [/^MTN/i, 'MTN MoMo'],
    [/^MOOV/i, 'Moov Money'],
    [/^AIRTEL/i, 'Airtel Money'],
    [/^WAVE/i, 'Wave'],
    [/^FREE/i, 'Free Money'],
    [/^T_?MONEY|^TOGOCOM/i, 'T-Money'],
    [/^ZAMANI/i, 'Zamani Cash'],
    [/^MPESA|^VODACOM/i, 'M-Pesa'],
    [/^EXPRESSO/i, 'E-Money'],
];

/** ORANGE_CMR → "Orange Money". Unknown codes come back tidied, not raw. */
export function operatorLabel(code?: string | null): string {
    if (!code) return '—';
    const hit = OPERATOR_PREFIX.find(([re]) => re.test(code));
    return hit ? hit[1] : code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

export const countryName = (code?: string | null) => (code ? countryCodeToNameMap[code.toUpperCase()] ?? code.toUpperCase() : '—');
