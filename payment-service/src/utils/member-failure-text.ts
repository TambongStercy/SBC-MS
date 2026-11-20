import type { PaymentFailure } from './payment-failure';

/**
 * Security plan Phase 10, item 5: show the member why the payment did not go
 * through and what to do next, in French, instead of a generic "échec".
 *
 * Built from the failure recorded on the payment (`failure.code`, decided once
 * in utils/payment-failure.ts). The provider's own text is never shown: it can
 * be English, technical, or carry details the member should not see.
 */
export interface MemberFailureText {
    reason: string;
    nextStep: string;
}

const TEXTS: Record<string, MemberFailureText> = {
    insufficient_balance: {
        reason: 'Le solde de votre compte Mobile Money est insuffisant.',
        nextStep: 'Rechargez votre compte, puis réessayez.',
    },
    limit_reached: {
        reason: 'Votre opérateur a refusé le paiement : plafond de transactions atteint.',
        nextStep: 'Réessayez plus tard ou payez avec un autre numéro.',
    },
    number_not_recognised: {
        reason: "Ce numéro n'est pas reconnu par l'opérateur choisi.",
        nextStep: "Vérifiez le numéro et l'opérateur, puis réessayez.",
    },
    number_format: {
        reason: 'Ce numéro de téléphone ne correspond pas au format du pays.',
        nextStep: 'Saisissez votre numéro Mobile Money sans l’indicatif du pays, puis réessayez.',
    },
    cancelled_by_payer: {
        reason: 'Le paiement a été annulé ou refusé sur le téléphone.',
        nextStep: 'Relancez le paiement et validez la demande sur votre téléphone.',
    },
    expired: {
        reason: "La demande de paiement a expiré avant d'être validée.",
        nextStep: 'Relancez le paiement et validez-le dans les minutes qui suivent.',
    },
    no_final_answer_72h: {
        reason: "L'opérateur n'a jamais confirmé ce paiement.",
        nextStep: "Si votre compte a été débité, contactez le support avec la référence ci-dessous. Sinon, relancez le paiement.",
    },
    missing_details: {
        reason: 'Il manque une information pour lancer le paiement.',
        nextStep: "Choisissez votre pays, votre opérateur et saisissez votre numéro, puis réessayez.",
    },
    amount_below_minimum: {
        reason: "Le montant est inférieur au minimum accepté par l'opérateur.",
        nextStep: 'Contactez le support.',
    },
    refunded: {
        reason: 'Le paiement a été remboursé par le prestataire.',
        nextStep: 'Relancez le paiement.',
    },
};

const PROVIDER_SIDE: MemberFailureText = {
    reason: 'Le service de paiement ne répond pas correctement en ce moment.',
    nextStep: 'Aucun montant n’a été prélevé par SBC. Réessayez dans quelques minutes.',
};

const OUR_SIDE: MemberFailureText = {
    reason: 'Une erreur est survenue de notre côté.',
    nextStep: 'Réessayez dans quelques minutes. Si le problème continue, contactez le support avec la référence ci-dessous.',
};

const UNKNOWN: MemberFailureText = {
    reason: "Le paiement n'a pas abouti.",
    nextStep: "Vérifiez votre solde et votre numéro, puis réessayez. Si votre compte a été débité, contactez le support avec la référence ci-dessous.",
};

/** The text to show the member for a recorded failure (or none recorded). */
export function memberFailureText(failure?: Pick<PaymentFailure, 'group' | 'code'> | null): MemberFailureText {
    if (!failure) return UNKNOWN;
    const byCode = failure.code ? TEXTS[failure.code] : undefined;
    if (byCode) return byCode;
    if (failure.group === 'provider_api') return PROVIDER_SIDE;
    if (failure.group === 'sbc_code') return OUR_SIDE;
    return UNKNOWN;
}

/** Codes with a dedicated text (for the check script). */
export const MEMBER_TEXT_CODES = Object.keys(TEXTS);
