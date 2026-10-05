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

/**
 * A wa.me chat with a member, first message already typed. Phone numbers are
 * stored with their country code (Congo's leading 0 included), so the digits
 * are the WhatsApp number as they are. Undefined when there is no usable one.
 */
export function whatsAppLink(phoneNumber: unknown, text: string): string | undefined {
    const digits = String(phoneNumber ?? '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return undefined;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Someone just signed up with the parrain's link. The notification carries a
 * WhatsApp button to welcome them straight away (Rufus, 2026-10-05).
 */
export function pushNewFilleul(referrerId: unknown, filleul: { _id: unknown; name?: string; phoneNumber?: unknown }): void {
    const first = firstName(filleul.name);
    const whatsapp = whatsAppLink(
        filleul.phoneNumber,
        `Bonjour${first ? ` ${first}` : ''} 👋 Bienvenue sur SBC ! Je suis ton parrain, je suis là pour t'aider à bien démarrer.`,
    );
    void notificationService.sendPush({
        userId: String(referrerId),
        category: 'filleuls',
        title: 'Nouveau filleul',
        body: `${first || "Quelqu'un"} vient de s'inscrire avec ton lien.`,
        url: '/filleuls',
        tag: `filleul-${String(filleul._id)}`,
        ...(whatsapp ? { whatsapp } : {}),
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
