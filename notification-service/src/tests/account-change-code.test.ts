/**
 * A code that confirms a change of MoMo number, crypto wallet, e-mail or phone
 * says so in its e-mail: it must not look like a login code a member would
 * pass on to someone taking over the account.
 */
jest.mock('../services/push.service', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../database/repositories/notification.repository', () => ({ notificationRepository: {} }));

import { Types } from 'mongoose';
import { notificationService, ACCOUNT_CHANGE_LABELS } from '../services/notification.service';
import { getProcessedTemplate } from '../utils/templates';
import { DeliveryChannel, NotificationType } from '../database/models/notification.model';

const userId = new Types.ObjectId();
let send: jest.SpyInstance;
beforeEach(() => {
    send = jest.spyOn(notificationService as any, 'createAndSendNotification').mockResolvedValue({} as any);
});
afterEach(() => send.mockRestore());

const templateFor = async (purpose?: string, isRegistration = false) => {
    await notificationService.sendOtpNotification(userId, 'm@x.com', DeliveryChannel.EMAIL, 'AB3CD4', 10, isRegistration, 'M', purpose);
    return send.mock.calls[0][0];
};

describe('code e-mails for account changes', () => {
    it.each(Object.keys(ACCOUNT_CHANGE_LABELS))('%s uses the change template with what is changed', async purpose => {
        const call = await templateFor(purpose);
        expect(call.templateId).toBe('verify-account-change');
        const t = getProcessedTemplate(NotificationType.OTP, call.templateId, call.variables);
        expect(t.subject).toBe(`AB3CD4 : code SBC pour changer ${ACCOUNT_CHANGE_LABELS[purpose]}`);
        expect(t.subject).not.toMatch(/login/i);
        expect(t.body).toContain(ACCOUNT_CHANGE_LABELS[purpose]);
        expect(t.body).toContain('Ce n’est pas un code de connexion');
        expect(t.body).not.toContain('{{');
        expect(t.plainText).not.toContain('{{');
    });

    it('the MoMo and crypto subjects name the payout destination', async () => {
        const momo = await templateFor('changeMomo');
        expect(getProcessedTemplate(NotificationType.OTP, momo.templateId, momo.variables).subject).toContain('Mobile Money');
        send.mockClear();
        const crypto = await templateFor('changeCrypto');
        expect(getProcessedTemplate(NotificationType.OTP, crypto.templateId, crypto.variables).subject).toContain('portefeuille crypto');
    });

    it('login, registration and withdrawal codes keep their templates', async () => {
        expect((await templateFor(undefined)).templateId).toBe('verify-login');
        send.mockClear();
        expect((await templateFor(undefined, true)).templateId).toBe('verify-registration');
        send.mockClear();
        expect((await templateFor('withdrawal_verification')).templateId).toBe('withdrawal-verification');
        send.mockClear();
        expect((await templateFor('something-else')).templateId).toBe('verify-login');
    });
});
