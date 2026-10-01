/**
 * Kinds of push a user can turn off one by one. Urgent ones go out at any
 * hour; the rest wait for the morning (see push.service quiet hours).
 */
export const PUSH_CATEGORIES = [
    { key: 'money', label: 'Argent : commissions et retraits', urgent: true },
    { key: 'chat', label: 'Messages', urgent: true },
    { key: 'filleuls', label: 'Nouveaux filleuls', urgent: false },
    { key: 'relance', label: 'Relance', urgent: false },
    { key: 'events', label: 'Événements et billets', urgent: false },
    { key: 'tombola', label: 'Tombola', urgent: false },
    { key: 'ads', label: 'Ads Network', urgent: false },
    { key: 'subscription', label: 'Abonnement', urgent: false },
    { key: 'announcements', label: 'Annonces SBC', urgent: false },
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number]['key'];

export const isPushCategory = (v: unknown): v is PushCategory =>
    PUSH_CATEGORIES.some(c => c.key === v);

export const isUrgent = (c: PushCategory) => PUSH_CATEGORIES.find(x => x.key === c)!.urgent;

/**
 * No non-urgent push between 22:00 and 07:00, Douala time (UTC+1, no DST) —
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
