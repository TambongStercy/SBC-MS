import type { Tone } from '../../../ui';

export const PROFILE_STATUS: Record<string, [string, Tone]> = {
    pending: ['À valider', 'warning'],
    approved: ['Publié', 'success'],
    rejected: ['Refusé', 'danger'],
    suspended: ['Suspendu', 'neutral'],
};

export const REPORT_STATUS: Record<string, [string, Tone]> = {
    open: ['Ouvert', 'warning'],
    reviewed: ['Traité', 'success'],
    dismissed: ['Sans suite', 'neutral'],
};

export const INTENTION: Record<string, string> = {
    relation_serieuse: 'Relation sérieuse',
    faire_connaissance: 'Faire connaissance',
    projet_mariage: 'Projet de mariage',
    elargir_cercle_social: 'Élargir son cercle social',
    echange_valeurs_respect: 'Échange, valeurs et respect',
    autre: 'Autre',
};

const SEX: Record<string, string> = { male: 'Homme', female: 'Femme', other: 'Autre', homme: 'Homme', femme: 'Femme' };
export const sexLabel = (s?: string) => (s ? SEX[s.toLowerCase()] ?? s : '—');

/** 0 = Sunday, as the service counts them. */
export const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** The markets' time zones; the service evaluates the weekly window in one of them. */
export const TIMEZONES: Array<[string, string]> = [
    ['Africa/Douala', 'Douala, Yaoundé (UTC+1)'],
    ['Africa/Kinshasa', 'Kinshasa, Brazzaville, Libreville (UTC+1)'],
    ['Africa/Lagos', 'Cotonou, Niamey, N’Djamena (UTC+1)'],
    ['Africa/Abidjan', 'Abidjan, Dakar, Lomé, Bamako, Ouaga (UTC+0)'],
    ['Africa/Lubumbashi', 'Lubumbashi (UTC+2)'],
];

/** The two photos a profile must carry, in the order the member uploads them. */
export const PHOTO_SLOTS = ['Portrait (visage)', 'Photo en pied (corps entier)'];
