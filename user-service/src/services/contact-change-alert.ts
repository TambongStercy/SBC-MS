import config from '../config';
import { maskEmail } from '../utils/mask-email';
import { WithdrawalLockReason } from '../utils/withdrawal-lock';
import { notificationService } from './clients/notification.service.client';
import { riskEvent } from '../utils/risk-event';

/**
 * Tells the owner that their email, phone number, Mobile Money number or crypto wallet just
 * changed and that withdrawals are blocked meanwhile. The email goes to the address held
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
        : args.reason === 'momo_change'
            ? 'Votre numéro Mobile Money SBC a été modifié'
            : args.reason === 'crypto_change'
                ? 'Votre portefeuille crypto SBC a été modifié'
                : 'Votre numéro de téléphone SBC a été modifié';
    const what = args.reason === 'email_change'
        ? `L'adresse e-mail de votre compte SBC vient d'être remplacée par ${maskEmail(args.newValue)}.`
        : args.reason === 'momo_change'
            ? `Le numéro Mobile Money qui reçoit vos retraits SBC vient d'être remplacé par un numéro se terminant par ${args.newValue.slice(-3)}.`
            : args.reason === 'crypto_change'
                ? `L'adresse crypto qui reçoit vos retraits SBC vient d'être remplacée par une adresse se terminant par ${args.newValue.slice(-4)}.`
                : `Le numéro de téléphone de votre compte SBC vient d'être remplacé par un numéro se terminant par ${args.newValue.slice(-3)}.`;
    const userId = String(args.userId);
    // Security plan Phases 4 and 8: a withdrawal soon after this scores in the fraud engine,
    // and the new details get a KYC level 1 check (crypto wallets are not checked).
    if (args.reason === 'authenticator_reset') riskEvent('authenticator_change', userId, { kind: 'reset' });
    else riskEvent('contact_change', userId, { kind: args.reason.replace('_change', '') });

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
