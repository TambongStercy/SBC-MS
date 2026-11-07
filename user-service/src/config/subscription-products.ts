/**
 * Products sold beside CLASSIQUE and CIBLE (Rufus 2026-10-31, Kersten's
 * "Paiements SBC" note 2026-11-05).
 *
 * XAF prices include the provider-fee margin the way CLASSIQUE (2150) and CIBLE
 * (5300) do; PRO and MISE_EN_AVANT are sold at the round price Rufus quoted.
 * USD prices are for crypto (NOWPayments), at the same 500 F/$ basis the
 * existing crypto commissions use, plus the crypto fee margin.
 *
 * Commissions are in the currency of the payment: XAF for Mobile Money, USD
 * for crypto.
 */

export type AddonOfferId = 'PRO' | 'PRO_YEARLY' | 'MISE_EN_AVANT';
export type Period = 'monthly' | 'yearly';

export interface AddonOffer {
    id: AddonOfferId;
    type: 'PRO' | 'MISE_EN_AVANT';
    name: string;
    period: Period;
    months: number;
    xaf: number;
    usd: number;
    /** Price shown crossed out (the yearly offer is 12 months for the price of 6). */
    listXaf: number | null;
    listUsd: number | null;
    features: string[];
}

const PRO_FEATURES = [
    'Recevez les demandes de clients près de chez vous',
    'Dans l\'application SBC Network, rubrique Espace pro',
];

export const ADDON_OFFERS: AddonOffer[] = [
    { id: 'PRO', type: 'PRO', name: 'Espace Pro (mensuel)', period: 'monthly', months: 1, xaf: 2000, usd: 4.8, listXaf: null, listUsd: null, features: PRO_FEATURES },
    { id: 'PRO_YEARLY', type: 'PRO', name: 'Espace Pro (annuel)', period: 'yearly', months: 12, xaf: 12000, usd: 27.8, listXaf: 24000, listUsd: 55.6, features: PRO_FEATURES },
    {
        id: 'MISE_EN_AVANT', type: 'MISE_EN_AVANT', name: 'Mise en avant', period: 'monthly', months: 1, xaf: 3000, usd: 7, listXaf: null, listUsd: null,
        features: [
            'Votre profil « En vedette » en haut de « Qui m\'a enregistré »',
            'Plus de vues sur vos statuts WhatsApp',
        ],
    },
];

export const findAddonOffer = (id: string): AddonOffer | undefined => ADDON_OFFERS.find(o => o.id === id);

/** Commission on PRO / MISE_EN_AVANT: 20% to the direct parrain (Rufus's note, 2026-11-07). */
export const ADDON_COMMISSION_RATE_L1 = 0.20;
/** Commission is a share of the price before the fee margin. */
export const addonCommissionBase = (offer: AddonOffer, currency: 'XAF' | 'USD') =>
    currency === 'XAF' ? offer.xaf : (offer.xaf / 500);

export type WinnerFrom = 'NONE' | 'CLASSIQUE' | 'CIBLE';

/** Pack Winner: "15 000 F + frais ou 32 $ + frais". */
export const WINNER = {
    name: 'Pack Winner',
    price: {
        NONE: { xaf: 15900, usd: 37.1 },
        CLASSIQUE: { xaf: 13650, usd: 32.5 }, // Rufus: 12 850 + frais
        CIBLE: { xaf: 10600, usd: 25.5 },     // Rufus: 10 000 + frais
    } as Record<WinnerFrom, { xaf: number; usd: number }>,
    commissions: {
        NONE: { xaf: [5000, 2500, 1250], usd: [10, 5, 2.5] },
        CLASSIQUE: { xaf: [4000, 2000, 1000], usd: [8, 4, 2] },
        CIBLE: { xaf: [2500, 1250, 625], usd: [5, 2.5, 1.25] },
    } as Record<WinnerFrom, { xaf: number[]; usd: number[] }>,
    proMonths: 12,
    miseEnAvantMonths: 1, // Rufus 2026-11-07: "ajoute la mise en avant pendant 1 mois sur SBC Network"
    relancePackId: 'winner_email_1k', // 1 000 relance email credits (notification-service BUNDLED_PACKS)
    relanceCredits: 1000,
    extraNumberSlots: 3,
    features: [
        'Tout le Pack Ciblé, à vie, avec ses 6 formations',
        'Recevez les demandes de clients pendant 1 an (Espace Pro offert)',
        'Mise en avant pendant 1 mois sur SBC Network',
        '3 numéros WhatsApp en plus dans le fichier de contacts SBC',
        '1 000 crédits de relance prospects',
        'Page de vente pour convertir vos prospects automatiquement',
        'Accès au groupe VIP SBC',
    ],
};

/** One more WhatsApp number in the SBC contacts file (Rufus: 500 F par numéro). */
export const EXTRA_NUMBER = { xaf: 500, usd: 1.2 };

/** Rufus's wording from the membership page as it was before the 2026-11-07 redesign: keep it word for word. */
export const TRAININGS = ['Trading', 'Achat en Chine', 'Art oratoire', 'Marketing digital', 'Bots WhatsApp'];

export const PACK_FEATURES = {
    CLASSIQUE: [
        'Possibilité de gagner entre 5 000 et 10 000 FCFA par jour',
        'Vente de produits digitaux',
        'Contacts WhatsApp ciblés par pays',
        'Accès à la marketplace SBC',
        `${TRAININGS.length} formations incluses : ${TRAININGS.join(', ')}`,
    ],
    CIBLE: [
        'Tout le Pack Classique',
        'Ciblage avancé : pays, sexe, âge, profession, ville et centres d\'intérêt',
        'Commissions sur 3 niveaux',
        `${TRAININGS.length + 1} formations incluses : ${TRAININGS.join(', ')}, SBC IA Creator`,
    ],
};
