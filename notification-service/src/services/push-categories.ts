/**
 * Kinds of push a user can turn off one by one.
 *
 * Only announcements wait out the night (holdAtNight): they are bulk messages,
 * and a phone buzzing at 23:00 for one makes people switch notifications off.
 * Everything else is about something that just happened to that member — a
 * filleul, a ticket, a tombola draw, an Ads day — and some of it goes stale if
 * held (an event reminder "dans moins d'une heure" arriving the next morning).
 */
export const PUSH_CATEGORIES = [
    // cta: the button on the notification when the sender names none.
    { key: 'money', label: 'Argent : commissions et retraits', holdAtNight: false, cta: 'Voir mon solde' },
    { key: 'chat', label: 'Messages', holdAtNight: false, cta: 'Répondre' },
    { key: 'filleuls', label: 'Nouveaux filleuls', holdAtNight: false, cta: 'Voir mes filleuls' },
    { key: 'relance', label: 'Relance', holdAtNight: false, cta: 'Ouvrir la relance' },
    { key: 'events', label: 'Événements et billets', holdAtNight: false, cta: 'Voir mes billets' },
    { key: 'tombola', label: 'Tombola', holdAtNight: false, cta: 'Voir' },
    { key: 'ads', label: 'Ads Network', holdAtNight: false, cta: 'Ouvrir Ads Network' },
    { key: 'subscription', label: 'Abonnement', holdAtNight: false, cta: 'Renouveler' },
    { key: 'announcements', label: 'Annonces SBC', holdAtNight: true, cta: 'Découvrir' },
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number]['key'];

export const isPushCategory = (v: unknown): v is PushCategory =>
    PUSH_CATEGORIES.some(c => c.key === v);

export const holdsAtNight = (c: PushCategory) => PUSH_CATEGORIES.find(x => x.key === c)!.holdAtNight;

export const defaultCta = (c: PushCategory) => PUSH_CATEGORIES.find(x => x.key === c)!.cta;

/**
 * No held push (announcements) between 22:00 and 07:00, Douala time (UTC+1, no DST) —
 * most members are in Central/West Africa, within an hour of it.
 */
const DOUALA_OFFSET_H = 1;
export const QUIET_FROM_H = 22;
export const QUIET_UNTIL_H = 7;

export function inQuietHours(now: Date): boolean {
    const h = (now.getUTCHours() + DOUALA_OFFSET_H) % 24;
    return h >= QUIET_FROM_H || h < QUIET_UNTIL_H;
}

/** The next 07:00 Douala time after `now`. */
export function endOfQuietHours(now: Date): Date {
    const t = new Date(now);
    t.setUTCHours(QUIET_UNTIL_H - DOUALA_OFFSET_H, 0, 0, 0);
    if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 1);
    return t;
}
