/**
 * Without VAPID keys, push is off: the app is told so, and senders get nothing
 * thrown at them.
 */
const sendNotification = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification } }));
jest.mock('../config', () => {
    const actual = jest.requireActual('../config').default;
    return { __esModule: true, default: { ...actual, push: { publicKey: '', privateKey: '', subject: 'mailto:t@t' } } };
});

import { pushEnabled, sendPushToUser } from '../services/push.service';

it('is off without keys, and sending quietly does nothing', async () => {
    expect(pushEnabled()).toBe(false);
    expect(await sendPushToUser('65d2b0344a7e2b9efbf6205d', { title: 'T', body: 'B' })).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
});
