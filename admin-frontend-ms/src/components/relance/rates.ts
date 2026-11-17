import type { Campaign } from '../../services/adminRelanceApi';

/**
 * Share of a campaign's messages that reached the filleul. `messagesSent`
 * counts delivered ones only on some campaigns, so failures are added back
 * to the denominator (2 534 sent, 2 534 delivered, 90 failed → 96,6 %).
 */
export function campaignDeliveryRate(c: Pick<Campaign, 'messagesSent' | 'messagesDelivered' | 'messagesFailed'>): number | null {
    const attempts = Math.max(c.messagesSent ?? 0, (c.messagesDelivered ?? 0) + (c.messagesFailed ?? 0));
    return attempts > 0 ? ((c.messagesDelivered ?? 0) / attempts) * 100 : null;
}
