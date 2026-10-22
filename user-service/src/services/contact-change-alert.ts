import config from '../config';
import { maskEmail } from '../utils/mask-email';
import { WithdrawalLockReason } from '../utils/withdrawal-lock';
import { notificationService } from './clients/notification.service.client';

/**
 * Tells the owner that their email or phone number just changed and that
 * withdrawals are blocked meanwhile. The email goes to the address held
 * BEFORE the change, so whoever replaced it cannot silence the alert. The
 * lock only helps if the owner hears about it in time to call support.
 * Fire-and-forget: never holds up or breaks the change itself.
 */
export function alertContactChange(args: {
    userId: unknown;
    /** The account email before this change. */
    previousEmail?: string | null;
    reason: WithdrawalLockReason;
    newValue: string;
}): void {
    const hours = config.withdrawal.lockHoursAfterContactChange;
    const subject = args.reason === 'email_change'
        ? 'Votre adresse e-mail SBC a été modifiée'
        : 'Votre numéro de téléphone SBC a été modifié';
    const what = args.reason === 'email_change'
        ? `L'adresse e-mail de votre compte SBC vient d'être remplacée par ${maskEmail(args.newValue)}.`
        : `Le numéro de téléphone de votre compte SBC vient d'être remplacé par un numéro se terminant par ${args.newValue.slice(-3)}.`;
    const userId = String(args.userId);

    if (args.previousEmail) {
        void notificationService.sendAccountEmail({
            userId,
            email: args.previousEmail,
            subject,
            body: `Bonjour,\n\n${what}\n\nPour protéger votre argent, les retraits sont bloqués sur votre compte pendant ${hours} h.\n\nSi vous n'êtes pas à l'origine de ce changement, contactez immédiatement le support SBC.`,
        });
    }
    void notificationService.sendPush({
        userId,
        category: 'money',
        title: subject,
        body: `Retraits bloqués pendant ${hours} h. Ce n'est pas vous ? Contactez le support SBC.`,
        url: '/wallet',
        tag: `contact-change-${userId}`,
    });
}
