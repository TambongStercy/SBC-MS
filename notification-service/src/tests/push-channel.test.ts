/**
 * The PUSH channel of /internal/create now reaches the phone.
 *
 * event-service has always sent ticket confirmations, cancellations, refunds,
 * reminders and resales with channel "push"; notification-service marked them
 * sent and delivered nothing, because web push did not exist.
 */
const sendPushToUser = jest.fn();
jest.mock('../services/push.service', () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));
const markAsSent = jest.fn();
const markAsFailed = jest.fn();
jest.mock('../database/repositories/notification.repository', () => ({
    notificationRepository: { markAsSent: (...a: unknown[]) => markAsSent(...a), markAsFailed: (...a: unknown[]) => markAsFailed(...a), update: jest.fn() },
}));

import { notificationService } from '../services/notification.service';

const push = (data: Record<string, unknown>, type = 'system') => ({
    _id: 'n1', userId: '65d2b0344a7e2b9efbf6205d', type, channel: 'push', recipient: 'x', data,
}) as any;

beforeEach(() => { sendPushToUser.mockReset().mockResolvedValue('sent'); markAsSent.mockReset(); markAsFailed.mockReset(); });

it('sends it to the user\'s devices with the kind and page the sender named', async () => {
    await notificationService.sendNotification(push({
        subject: '🎫 Vos billets SBC Event — Concert', body: 'Votre paiement est confirmé.',
        relatedData: { pushCategory: 'events', url: '/events/tickets', pushTag: 'order-1' },
    }));
    expect(sendPushToUser).toHaveBeenCalledWith('65d2b0344a7e2b9efbf6205d',
        { title: '🎫 Vos billets SBC Event — Concert', body: 'Votre paiement est confirmé.', url: '/events/tickets', tag: 'order-1' },
        { category: 'events' });
    expect(markAsSent).toHaveBeenCalledWith('n1');
});

it.each([
    ['transaction', 'money'],
    ['referral', 'filleuls'],
    ['system', 'announcements'],
])('falls back on the type when no kind is named: %s → %s', async (type, category) => {
    await notificationService.sendNotification(push({ subject: 'S', body: 'B' }, type));
    expect(sendPushToUser.mock.calls[0][2]).toEqual({ category });
});

it('ignores a link that leaves the app', async () => {
    await notificationService.sendNotification(push({ subject: 'S', body: 'B', relatedData: { url: 'https://evil.example' } }));
    expect(sendPushToUser.mock.calls[0][1]).not.toHaveProperty('url');
});

it('counts a user without a device as handled, not failed', async () => {
    sendPushToUser.mockResolvedValue('no_device');
    await notificationService.sendNotification(push({ subject: 'S', body: 'B' }));
    expect(markAsSent).toHaveBeenCalled();
    expect(markAsFailed).not.toHaveBeenCalled();
});
