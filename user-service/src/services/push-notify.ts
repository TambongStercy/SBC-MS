import { notificationService } from './clients/notification.service.client';

/**
 * Pushes user-service sends to members' phones (through notification-service).
 * All fire-and-forget: a push must never hold up or break a payment or a
 * registration.
 */

/** "Paul" from "Paul Biya"; nothing from an email address used as a name. */
const firstName = (name?: string | null) => {
    const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
    return first.includes('@') ? '' : first;
};

const money = (amount: number, currency: string) =>
    currency === 'USD' ? `$${amount}` : `${Math.round(amount).toLocaleString('fr-FR')} FCFA`;

/** A commission just credited: the most motivating thing a parrain can hear. */
export function pushCommission(args: {
    referrerId: unknown; amount: number; currency: string; level: number;
    filleulName?: string | null; plan: string; sourceRef: string;
}): void {
    const who = firstName(args.filleulName) || 'Un filleul';
    const body = args.level === 1
        ? `${who} vient de prendre ${args.plan}.`
        : `${who} (filleul de niveau ${args.level}) vient de prendre ${args.plan}.`;
    void notificationService.sendPush({
        userId: String(args.referrerId),
        category: 'money',
        title: `+${money(args.amount, args.currency)} de commission`,
        body,
        url: '/wallet',
        tag: `commission-${args.sourceRef}-${args.level}`,
    });
}

/** Someone just signed up with the parrain's link. */
export function pushNewFilleul(referrerId: unknown, filleulName: string | undefined, filleulId: unknown): void {
    const who = firstName(filleulName) || "Quelqu'un";
    void notificationService.sendPush({
        userId: String(referrerId),
        category: 'filleuls',
        title: 'Nouveau filleul',
        body: `${who} vient de s'inscrire avec ton lien.`,
        url: '/filleuls',
        tag: `filleul-${String(filleulId)}`,
    });
}

/** A monthly subscription ends soon and does not renew by itself. */
export function pushSubscriptionEnding(userId: unknown, label: string, endDate: Date): void {
    const day = endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Douala' });
    void notificationService.sendPush({
        userId: String(userId),
        category: 'subscription',
        title: `${label} se termine le ${day}`,
        body: 'Renouvelle-le pour garder tes avantages.',
        url: '/abonnement',
        tag: `subscription-ending-${String(userId)}-${label}`,
    });
}
