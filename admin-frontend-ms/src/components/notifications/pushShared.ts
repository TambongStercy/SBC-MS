import { countryCodeToNameMap } from '../../utils/countryUtils';

export type PushFilter = { countries?: string[]; subscription?: 'subscribed' | 'unsubscribed'; sex?: 'male' | 'female' };
export type Announcement = {
    _id: string; title: string; body: string; url?: string; recipients: number; createdAt: string;
    filter?: PushFilter; sendNow?: boolean;
};
export type PushOverview = { recent: Announcement[]; toAllToday: number; toAllPerDay: number; audience: number };

export const COUNTRIES = Object.entries(countryCodeToNameMap)
    .filter(([code]) => /^[A-Z]{2}$/.test(code))
    .sort((a, b) => a[1].localeCompare(b[1], 'fr'));

export const countryName = (code: string) => countryCodeToNameMap[code] ?? code;

export const SUBSCRIPTION_LABEL = { subscribed: 'Abonnés', unsubscribed: 'Non abonnés' } as const;
export const SEX_LABEL = { male: 'Hommes', female: 'Femmes' } as const;

/** "Tout le monde", or "Cameroun, Gabon · Non abonnés · Femmes". */
export const describeFilter = (f?: PushFilter | null) => {
    if (!f) return 'Tout le monde';
    const parts = [
        f.countries?.length ? f.countries.map(countryName).join(', ') : '',
        f.subscription ? SUBSCRIPTION_LABEL[f.subscription] : '',
        f.sex ? SEX_LABEL[f.sex] : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Tout le monde';
};

/**
 * Pages of the member app an announcement can open, as members know them.
 * A list rather than a text box: an admin should not have to know routes.
 * Keep in step with SBC-WEB-UI's App.tsx when pages move.
 */
export const APP_PAGES: Array<{ group: string; pages: Array<{ label: string; url: string }> }> = [
    { group: 'Général', pages: [
        { label: 'Accueil', url: '/' },
        { label: 'Formations', url: '/formations' },
        { label: 'SBC Shop', url: '/marketplace' },
        { label: 'Classement', url: '/classement' },
        { label: 'Contacts', url: '/contacts' },
        { label: 'Messages', url: '/chat' },
        { label: 'SBC Love', url: '/sbclove' },
    ] },
    { group: 'Argent', pages: [
        { label: 'Portefeuille', url: '/wallet' },
        { label: 'Solde d’activation', url: '/activation-balance' },
        { label: 'Abonnement', url: '/abonnement' },
    ] },
    { group: 'Parrainage', pages: [
        { label: 'Mes filleuls', url: '/filleuls' },
        { label: 'Espace partenaire', url: '/partenaire' },
        { label: 'Relance', url: '/relance' },
        { label: 'Campagnes de relance', url: '/relance/campagnes' },
    ] },
    { group: 'Événements', pages: [
        { label: 'Événements', url: '/events' },
        { label: 'Mes billets', url: '/events/mes-billets' },
        { label: 'Revente de billets', url: '/events/revente' },
    ] },
    { group: 'Ads Network', pages: [
        { label: 'Ads Network', url: '/ads-network' },
        { label: 'Espace diffuseur', url: '/ads-network/diffuseur' },
        { label: 'Espace annonceur', url: '/ads-network/annonceur' },
        { label: 'Nouvelle campagne pub', url: '/ads-network/annonceur/nouvelle-campagne' },
    ] },
    { group: 'Compte', pages: [
        { label: 'Profil', url: '/profile' },
        { label: 'Notifications', url: '/notifications' },
    ] },
];
export const pageLabel = (url: string) => APP_PAGES.flatMap(g => g.pages).find(p => p.url === url)?.label ?? 'Accueil';

/** Douala hour now (UTC+1, no DST): announcements wait 22:00–07:00 unless sent now. */
export const doualaHour = () => (new Date().getUTCHours() + 1) % 24;
export const isNightInDouala = () => { const h = doualaHour(); return h >= 22 || h < 7; };

export const TITLE_MAX = 120;
export const BODY_MAX = 400;
