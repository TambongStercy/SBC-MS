import { createInternalNotification } from './clients/notification.service.client';
import { userServiceClient } from './clients/user.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('SbcloveNotificationService');

// notification-service contract: `type` must be a NotificationType and `channel`
// a DeliveryChannel (both lowercase enum values). SBCLOVE emails are system mails.
const NOTIFICATION_TYPE = 'system';
const EMAIL_CHANNEL = 'email';

const firstName = (name?: string): string => (name ? name.split(' ')[0] : 'cher membre');

// The email sender treats data.body as HTML, so turn line breaks into <br/>.
const toHtml = (text: string): string => text.replace(/\n/g, '<br/>');

/**
 * Sends a SBCLOVE email via notification-service. Best-effort and never throws;
 * skips silently if the user has no email on file (recipient is required).
 * Fetches the user once and passes the first name to the body builder.
 */
const sendEmail = async (userId: string, subject: string, buildBody: (prenom: string) => string): Promise<void> => {
    const user = await userServiceClient.getUserById(userId);
    if (!user?.email) {
        log.warn(`No email on file for user ${userId}; skipping SBCLOVE email "${subject}".`);
        return;
    }
    const prenom = firstName(user.name);
    await createInternalNotification({
        userId,
        type: NOTIFICATION_TYPE,
        channel: EMAIL_CHANNEL,
        recipient: user.email,
        data: { subject, body: toHtml(buildBody(prenom)), variables: { prenom } },
    });
    log.info(`SBCLOVE email "${subject}" queued for user ${userId}`);
};

/** Reciprocal-match email (spec §10-11). */
const sendMatchEmail = (userId: string): Promise<void> =>
    sendEmail(userId, 'SBCLOVE – Un intérêt réciproque a été détecté', (prenom) =>
        `Bonjour ${prenom},\n\n` +
        `Une personne avec qui vous avez manifesté un intérêt a également montré un intérêt ` +
        `pour votre profil sur SBCLOVE.\n\n` +
        `Pour des raisons de sécurité et de respect de la vie privée, SBC ne partage pas ` +
        `automatiquement les coordonnées personnelles.\n\n` +
        `Connectez-vous à votre espace SBC pour consulter ce match et choisir la suite que ` +
        `vous souhaitez donner.\n\n` +
        `L'équipe SBC`);

/** Notifies a user that the other party in a match wishes to be contacted (spec §13). */
const sendContactRequestEmail = (userId: string): Promise<void> =>
    sendEmail(userId, 'SBCLOVE – Une demande de contact', (prenom) =>
        `Bonjour ${prenom},\n\n` +
        `Une personne avec qui vous avez un match sur SBCLOVE souhaite être mise en contact ` +
        `avec vous.\n\n` +
        `Connectez-vous à votre espace SBC, rubrique "Mes matchs", pour indiquer si vous ` +
        `souhaitez également aller plus loin.\n\n` +
        `L'équipe SBC`);

/** Notifies both users that mutual contact has been unlocked (spec §13). */
const sendContactUnlockedEmail = (userId: string): Promise<void> =>
    sendEmail(userId, 'SBCLOVE – Contact mutuel accepté', (prenom) =>
        `Bonjour ${prenom},\n\n` +
        `Bonne nouvelle : vous et votre match avez tous les deux accepté d'aller plus loin sur ` +
        `SBCLOVE.\n\n` +
        `Connectez-vous à votre espace SBC pour découvrir la suite.\n\n` +
        `L'équipe SBC`);

export const sbcloveNotificationService = {
    sendMatchEmail,
    sendContactRequestEmail,
    sendContactUnlockedEmail,
};
