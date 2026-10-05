import { sendPushToUser } from './push.service';
import { userServiceClient } from './clients/user.service.client';

/**
 * Relance's push notifications to the parrain. Fire-and-forget: the sender
 * loop must not wait on a push service, and a failed push is not worth a
 * failed send. Email alerts used to be the only signal, through a mail server
 * that is often slow, so relance could stop without the parrain noticing.
 */
const fire = (work: () => Promise<unknown>) => { void work().catch(() => undefined); };

export function pushCreditsLow(referrerId: string, remaining: number): void {
    fire(() => sendPushToUser(referrerId, {
        title: 'Crédits de relance bas',
        body: `Il vous reste ${remaining} crédits. Rechargez pour que la relance continue.`,
        url: '/relance',
        tag: 'relance-credits',
        cta: 'Recharger',
    }, { category: 'relance' }));
}

export function pushCreditsExhausted(referrerId: string): void {
    fire(() => sendPushToUser(referrerId, {
        title: 'Relance en pause',
        body: 'Plus de crédits : vos filleuls attendent. Rechargez pour reprendre.',
        url: '/relance',
        tag: 'relance-credits',
        cta: 'Recharger',
    }, { category: 'relance' }));
}

export function pushFilleulPaid(referrerId: string, referralId: string): void {
    fire(async () => {
        const first = (await userServiceClient.getUserDetails(referralId))?.name?.trim().split(/\s+/)[0];
        return sendPushToUser(referrerId, {
            title: 'Relance réussie',
            body: `${first || 'Un filleul relancé'} vient de payer.`,
            url: '/relance',
            tag: `relance-paid-${referralId}`,
            cta: 'Voir',
        }, { category: 'relance' });
    });
}
