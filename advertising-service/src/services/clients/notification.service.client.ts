import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { getUserProfile } from './user.service.client';

const log = logger.getLogger('NotificationServiceClient');

/** Matches notification-service POST /api/notifications/internal/create. */
interface InternalNotificationPayload {
    userId: string;
    type: string;
    channel: string;
    recipient?: string;
    data: {
        subject?: string;
        body: string;
        templateId?: string;
        variables?: Record<string, unknown>;
        relatedData?: Record<string, unknown>;
    };
}

const client = axios.create({
    baseURL: config.services.notificationService,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'advertising-service',
    },
});

/**
 * Best-effort send. Never throws.
 *
 * A campaign must not fail because an email did not go out — a diffuseur who
 * misses a reminder still has their grace budget, but one whose verification blew
 * up because of a mail server has lost a day for nothing.
 */
const send = async (payload: InternalNotificationPayload): Promise<boolean> => {
    try {
        // The route lives under the /notifications router — POSTing /internal/create
        // at the API root 404s silently (verified on preprod 2026-08-09; every
        // advertising email had been failing since launch because of it).
        const { data } = await client.post('/notifications/internal/create', payload);
        if (data?.success) return true;
        log.warn('Notification service responded with failure', { userId: payload.userId });
        return false;
    } catch (err) {
        log.error(`Notification send failed for ${payload.userId}: ${(err as Error).message}`);
        return false;
    }
};

const email = async (userId: string, subject: string, body: string, relatedData?: Record<string, unknown>) => {
    // notification-service refuses an email without its address (400): it does
    // not resolve userId → email itself. Fetching it here is what every other
    // consumer does — and skipping it meant no advertising mail ever sent.
    const profile = await getUserProfile(userId).catch(() => null);
    if (!profile?.email) {
        log.warn(`No email address for user ${userId}; notification "${subject}" not sent`);
        return false;
    }
    return send({
        userId,
        type: 'system',
        channel: 'email',
        recipient: profile.email,
        data: { subject, body, relatedData },
    });
};

/** French throughout: the diffuseur audience is Cameroon and francophone Africa. */
export const notifyCampaignOffer = (userId: string, campaignTitle: string, expectedViews: number) =>
    email(
        userId,
        'Nouvelle campagne disponible',
        `Une nouvelle campagne est disponible pour vous : « ${campaignTitle} ».\n\n`
        + `Elle est proposée à plusieurs diffuseurs et les premiers à accepter l'obtiennent. `
        + `Vous pourriez gagner environ ${expectedViews} vues sur 3 jours.\n\n`
        + `Connectez-vous à SBC pour l'accepter.`,
        { campaignTitle },
    );

/**
 * Sent while the current status is still alive. Once it expires the views are
 * unrecoverable, so this is the single most valuable notification in the flow.
 */
export const notifyVerificationDue = (
    userId: string,
    campaignTitle: string,
    day: number,
    hoursLeft: number,
) =>
    email(
        userId,
        'Vérifiez votre publication maintenant',
        `Votre publication du jour ${day} pour « ${campaignTitle} » expire dans environ ${hoursLeft}h.\n\n`
        + `Connectez votre WhatsApp sur SBC dès maintenant pour que vos vues soient comptées. `
        + `Une fois le statut expiré, les vues de cette journée ne peuvent plus être récupérées.`,
        { campaignTitle, day },
    );

/**
 * Sent the moment a day becomes postable.
 *
 * Days are 24h apart, so without this a diffuseur has to keep opening the app to
 * find out whether their next day has opened — and a day they forget is a day
 * nobody pays them for.
 */
export const notifyDayOpened = (userId: string, campaignTitle: string, day: number) =>
    email(
        userId,
        `Jour ${day} disponible`,
        `Vous pouvez maintenant publier le jour ${day} de « ${campaignTitle} ».\n\n`
        + `Publiez-le sur votre statut WhatsApp, puis vérifiez-le depuis SBC pour que vos `
        + `vues soient comptées.\n\n`
        + `${config.appBaseUrl.replace(/\/$/, '')}/ads-network/diffuseur`,
        {
            campaignTitle,
            day,
            ctaLabel: 'Publier le jour ' + day,
            ctaUrl: `${config.appBaseUrl.replace(/\/$/, '')}/ads-network/diffuseur`,
        },
    );

export const notifyDayDue = (userId: string, campaignTitle: string, day: number, graceRemaining: number) =>
    email(
        userId,
        `Jour ${day} à publier`,
        `Il est temps de publier le jour ${day} de « ${campaignTitle} ».\n\n`
        + (graceRemaining > 0
            ? `Il vous reste ${graceRemaining} jour(s) de report. Au-delà, vos gains sur cette campagne seront annulés.`
            : `Attention : vous n'avez plus de jour de report. Publiez aujourd'hui, sinon vos gains sur cette campagne seront annulés.`),
        { campaignTitle, day, graceRemaining },
    );

export const notifyCampaignCompleted = (userId: string, campaignTitle: string, totalViews: number, earned: number) =>
    email(
        userId,
        'Campagne terminée',
        `Bravo ! Vous avez terminé les 3 jours de « ${campaignTitle} ».\n\n`
        + `Total : ${totalViews} vues vérifiées, ${earned} FCFA.\n\n`
        + `Vos gains seront crédités sur votre solde publicitaire.`,
        { campaignTitle, totalViews, earned },
    );

export const notifyCampaignForfeited = (userId: string, campaignTitle: string) =>
    email(
        userId,
        'Campagne non terminée',
        `Votre campagne « ${campaignTitle} » n'a pas été terminée dans les délais et vos gains ont été annulés.\n\n`
        + `Pour vos prochaines campagnes, pensez à publier chaque jour et à vérifier votre statut avant qu'il n'expire.`,
        { campaignTitle },
    );

/** The test campaign is what replaces a diffuseur's self-declared average. */
export const notifyTestCampaignCompleted = (userId: string, measuredAverageViews: number) =>
    email(
        userId,
        'Félicitations, votre profil diffuseur est validé',
        `Vous avez terminé votre campagne test.\n\n`
        + `Votre moyenne vérifiée est de ${measuredAverageViews} vues par publication. `
        + `Elle sera utilisée pour vous proposer des campagnes adaptées à votre audience.`,
        { measuredAverageViews },
    );

export const notifyReferralUnlocked = (userId: string, rate: number) =>
    email(
        userId,
        'Commission parrainage débloquée',
        `Vous avez atteint 100 campagnes terminées.\n\n`
        + `Vous gagnez désormais ${Math.round(rate * 100)}% sur les campagnes lancées par les annonceurs que vous avez invités. `
        + `Continuez à faire des campagnes pour conserver cet avantage.`,
        { rate },
    );

export const notifyReferralSuspended = (userId: string) =>
    email(
        userId,
        'Commission parrainage suspendue',
        `Votre commission parrainage est suspendue : aucune campagne terminée ce mois-ci alors que des campagnes vous ont été proposées.\n\n`
        + `Terminez une campagne pour la réactiver. Vous n'avez pas besoin de recommencer les 100 campagnes.`,
    );

export const notifyCampaignApproved = (userId: string, campaignTitle: string) => {
    // Straight to the annonceur dashboard, where the "Payer et lancer" button is.
    // An approval that does not say where to pay leaves the annonceur hunting for
    // it, and the campaign sits unpaid.
    const dashboardUrl = `${config.appBaseUrl.replace(/\/$/, '')}/ads-network/annonceur`;

    return email(
        userId,
        'Votre campagne est validée',
        `Bonne nouvelle : votre campagne « ${campaignTitle} » a été validée par notre équipe.\n\n`
        + `Il ne reste qu'une étape — le paiement. Rendez-vous sur votre espace annonceur `
        + `et cliquez sur « Payer et lancer » :\n\n${dashboardUrl}\n\n`
        + `Dès le paiement confirmé, votre campagne sera proposée aux diffuseurs.`,
        {
            campaignTitle,
            // The notification service turns these into the button when the email
            // is rendered as HTML.
            ctaLabel: 'Payer et lancer ma campagne',
            ctaUrl: dashboardUrl,
        },
    );
};

/** The reason is the whole point of this mail: without it nothing can be corrected. */
export const notifyCampaignRejected = (userId: string, campaignTitle: string, reason: string) =>
    email(
        userId,
        'Votre campagne n\'a pas été validée',
        `Votre campagne « ${campaignTitle} » n'a pas été validée.\n\n`
        + `Motif : ${reason}\n\n`
        + `Vous pouvez la modifier et la soumettre à nouveau depuis votre espace annonceur :\n\n`
        + `${config.appBaseUrl.replace(/\/$/, '')}/ads-network/annonceur`,
        {
            campaignTitle,
            reason,
            ctaLabel: 'Modifier ma campagne',
            ctaUrl: `${config.appBaseUrl.replace(/\/$/, '')}/ads-network/annonceur`,
        },
    );

export const notifyAdvertiserCampaignComplete = (userId: string, campaignTitle: string, uniqueViews: number) =>
    email(
        userId,
        'Votre campagne est terminée',
        `Votre campagne « ${campaignTitle} » a atteint son objectif : ${uniqueViews} vues uniques vérifiées.\n\n`
        + `Consultez votre tableau de bord pour le détail par diffuseur.`,
        { campaignTitle, uniqueViews },
    );
