import { createInternalNotification } from './clients/notification.service.client';
import { userServiceClient } from './clients/user.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('SbcloveNotificationService');

const firstName = (name?: string): string => (name ? name.split(' ')[0] : 'cher membre');

/**
 * Sends the reciprocal-match email to a user (spec §10-11). Best-effort.
 */
const sendMatchEmail = async (userId: string): Promise<void> => {
    const user = await userServiceClient.getUserById(userId);
    const prenom = firstName(user?.name);
    const body =
        `Bonjour ${prenom},\n\n` +
        `Une personne avec qui vous avez manifesté un intérêt a également montré un intérêt ` +
        `pour votre profil sur SBCLOVE.\n\n` +
        `Pour des raisons de sécurité et de respect de la vie privée, SBC ne partage pas ` +
        `automatiquement les coordonnées personnelles.\n\n` +
        `Connectez-vous à votre espace SBC pour consulter ce match et choisir la suite que ` +
        `vous souhaitez donner.\n\n` +
        `L'équipe SBC`;

    await createInternalNotification({
        userId,
        type: 'SBCLOVE_MATCH',
        channel: 'EMAIL',
        recipient: user?.email,
        data: {
            title: 'SBCLOVE – Un intérêt réciproque a été détecté',
            body,
            variables: { prenom },
        },
    });
    log.info(`Match email queued for user ${userId}`);
};

/**
 * Notifies a user that the other party in a match wishes to be contacted (spec §13).
 */
const sendContactRequestEmail = async (userId: string): Promise<void> => {
    const user = await userServiceClient.getUserById(userId);
    const prenom = firstName(user?.name);
    const body =
        `Bonjour ${prenom},\n\n` +
        `Une personne avec qui vous avez un match sur SBCLOVE souhaite être mise en contact ` +
        `avec vous.\n\n` +
        `Connectez-vous à votre espace SBC, rubrique "Mes matchs", pour indiquer si vous ` +
        `souhaitez également aller plus loin.\n\n` +
        `L'équipe SBC`;

    await createInternalNotification({
        userId,
        type: 'SBCLOVE_CONTACT_REQUEST',
        channel: 'EMAIL',
        recipient: user?.email,
        data: { title: 'SBCLOVE – Une demande de contact', body, variables: { prenom } },
    });
    log.info(`Contact-request email queued for user ${userId}`);
};

/**
 * Notifies both users that mutual contact has been unlocked (spec §13).
 */
const sendContactUnlockedEmail = async (userId: string): Promise<void> => {
    const user = await userServiceClient.getUserById(userId);
    const prenom = firstName(user?.name);
    const body =
        `Bonjour ${prenom},\n\n` +
        `Bonne nouvelle : vous et votre match avez tous les deux accepté d'aller plus loin sur ` +
        `SBCLOVE.\n\n` +
        `Connectez-vous à votre espace SBC pour découvrir la suite.\n\n` +
        `L'équipe SBC`;

    await createInternalNotification({
        userId,
        type: 'SBCLOVE_CONTACT_UNLOCKED',
        channel: 'EMAIL',
        recipient: user?.email,
        data: { title: 'SBCLOVE – Contact mutuel accepté', body, variables: { prenom } },
    });
};

export const sbcloveNotificationService = {
    sendMatchEmail,
    sendContactRequestEmail,
    sendContactUnlockedEmail,
};
