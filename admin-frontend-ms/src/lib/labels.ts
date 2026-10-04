import type { Tone } from '../ui';
import { countryCodeToNameMap } from '../utils/countryUtils';
import { OPERATOR_NAME } from './operators';

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
    if (OPERATOR_NAME[code]) return OPERATOR_NAME[code];
    const hit = OPERATOR_PREFIX.find(([re]) => re.test(code));
    return hit ? hit[1] : code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

export const countryName = (code?: string | null) => (code ? countryCodeToNameMap[code.toUpperCase()] ?? code.toUpperCase() : '—');

/** Ledger movement types, and which way each moves the main balance. */
export const TX_TYPE: Record<string, { label: string; sign: 1 | -1 | 0 }> = {
    deposit: { label: 'Gain / dépôt', sign: 1 },
    withdrawal: { label: 'Retrait', sign: -1 },
    transfer: { label: 'Transfert', sign: 0 },
    payment: { label: 'Paiement', sign: -1 },
    refund: { label: 'Remboursement', sign: 1 },
    fee: { label: 'Frais', sign: -1 },
    conversion: { label: 'Conversion', sign: 0 },
    activation_transfer_in: { label: 'Vers le solde d’activation', sign: -1 },
    activation_transfer_out: { label: 'Activation transférée', sign: 0 },
    sponsor_activation: { label: 'Activation d’un filleul', sign: 0 },
    advertising_earnings: { label: 'Gains Ads Network', sign: 0 },
    advertising_transfer_out: { label: 'Gains Ads vers le solde', sign: 1 },
};
export const txTypeLabel = (t?: string) => (t ? TX_TYPE[t]?.label ?? t.replace(/_/g, ' ') : '—');

/** What a payment was for. */
export const PAYMENT_TYPE: Record<string, string> = {
    SUBSCRIPTION: 'Abonnement',
    SUBSCRIPTION_UPGRADE: 'Passage au Ciblé',
    TOMBOLA_TICKET: 'Ticket de tombola',
    FLASH_SALE_FEE: 'Vente flash',
    EVENT_TICKET_PURCHASE: 'Billet d’événement',
    EVENT_TICKET_RESALE: 'Billet en revente',
    CHALLENGE_VOTE: 'Vote Impact Challenge',
    CHALLENGE_SUPPORT: 'Soutien Impact Challenge',
    AD_CAMPAIGN: 'Campagne Ads Network',
};
export const paymentTypeLabel = (t?: string) =>
    t ? PAYMENT_TYPE[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : 'Paiement';

export const GATEWAY: Record<string, string> = {
    feexpay: 'FeexPay', cinetpay: 'CinetPay', moneyfusion: 'MoneyFusion', nowpayments: 'NOWPayments (crypto)',
    lygos: 'Lygos', testing: 'Test', none: '—',
};
export const gatewayLabel = (g?: string) => (g ? GATEWAY[g.toLowerCase()] ?? g : '—');

export const SUBSCRIPTION_LABEL: Record<string, [string, Tone]> = {
    CLASSIQUE: ['Classique', 'success'],
    CIBLE: ['Ciblé', 'primary'],
};
