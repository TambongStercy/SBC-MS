/**
 * Guided paths (FAQ flows) shown to members in "Aide" and used by the assistant
 * (level 1). Seeded in code: each leaf either opens a secure screen of the app
 * (`action`), points to knowledge-base articles (`articles`, by slug), or
 * proposes a ticket in a category.
 */

export interface GuideNode {
    id: string;
    label: string;
    text?: string;
    action?: 'activation_check' | 'withdrawal_status' | 'ticket' | 'contact_change_self';
    category?: string;
    articles?: string[];
    children?: GuideNode[];
}

export const GUIDES: GuideNode[] = [
    {
        id: 'not-activated',
        label: 'Mon compte n’est pas activé',
        text: 'Vous avez payé mais votre compte n’est pas activé ? Nous vérifions votre paiement directement auprès de l’opérateur.',
        children: [
            {
                id: 'not-activated-check',
                label: 'Vérifier mon paiement',
                action: 'activation_check',
                text: 'Choisissez votre paiement dans la liste, ou saisissez la référence reçue par SMS.',
            },
            {
                id: 'not-activated-no-payment',
                label: 'Je ne trouve pas mon paiement',
                action: 'ticket',
                category: 'activation_paiement',
                text: 'Ouvrez une demande avec la capture du SMS de l’opérateur : un agent vérifiera.',
            },
        ],
    },
    {
        id: 'withdrawal-blocked',
        label: 'Mon retrait est bloqué',
        text: 'Voyez le statut réel de vos retraits, tel que l’opérateur nous l’a donné.',
        children: [
            { id: 'withdrawal-status', label: 'Voir le statut de mes retraits', action: 'withdrawal_status' },
            {
                id: 'withdrawal-locked',
                label: 'Mes retraits sont bloqués après un changement d’email ou de numéro',
                text: 'Par sécurité, les retraits sont bloqués 48 h après un changement d’email ou de numéro de téléphone. Ils reprennent automatiquement ensuite.',
            },
            { id: 'withdrawal-ticket', label: 'Parler à un agent', action: 'ticket', category: 'retrait' },
        ],
    },
    {
        id: 'account-access',
        label: 'Je n’arrive pas à me connecter',
        children: [
            {
                id: 'account-password',
                label: 'J’ai oublié mon mot de passe',
                text: 'Utilisez « Mot de passe oublié » sur l’écran de connexion, avec votre email ou votre numéro.',
            },
            {
                id: 'account-contact-lost',
                label: 'Je n’ai plus accès à mon email ou à mon numéro',
                action: 'ticket',
                category: 'compte_acces',
                text: 'Un agent vérifiera votre identité avant tout changement. Aucun agent ne vous demandera jamais votre mot de passe ni un code reçu.',
            },
            {
                id: 'account-change-self',
                label: 'Je veux changer mon email ou mon numéro (je suis connecté)',
                action: 'contact_change_self',
                text: 'Allez dans Profil → Modifier : un code est envoyé à la nouvelle adresse. Les retraits sont bloqués 48 h après le changement.',
            },
        ],
    },
    {
        id: 'commissions',
        label: 'Une commission n’est pas arrivée',
        action: 'ticket',
        category: 'commissions',
    },
    {
        id: 'views',
        label: 'Ma preuve de vues WhatsApp',
        action: 'ticket',
        category: 'vues_whatsapp',
        text: 'Les preuves vidéo sont vérifiées par notre équipe dans l’ordre d’arrivée.',
    },
    { id: 'other', label: 'Autre question', action: 'ticket', category: 'autre' },
];
