/**
 * Asserts the SBC Support owner endpoints in user-service
 * (docs/support/CONTRACT.md §2.1) and the one-activation-per-payment guard
 * (`subscriptionactivations`).
 *
 * Needs a local Mongo. Uses its own database and drops only that one. Every
 * outbound service URL points at a dead port and the notification client is
 * stubbed, so nothing is ever sent.
 *
 *   npx ts-node --swc src/scripts/check-support-owner.ts
 */
export {};

// Before anything reads the config.
const DEAD = 'http://127.0.0.1:9';
for (const k of ['NOTIFICATION_SERVICE_URL', 'PAYMENT_SERVICE_URL', 'PRODUCT_SERVICE_URL', 'API_GATEWAY_URL', 'SETTINGS_SERVICE_URL',
    'TOMBOLA_SERVICE_URL', 'CANAL_SERVICE_URL', 'USER_SERVICE_URL']) process.env[k] = DEAD;
process.env.CONTACTS_WEBHOOK_URL = '';
process.env.SERVICE_SECRET = 'test-secret-support-owner';
process.env.WHATSAPP_OTP_ENABLED = 'false';
const DB = process.env.SUPPORT_OWNER_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_owner_test';
if (!/_test$/.test(DB.split('?')[0])) { console.error('Refusing to run on a database whose name does not end in _test'); process.exit(1); }

// Codes printed by the dev OTP banner are hidden: never print an OTP.
const realLog = console.log;
console.log = (...args: any[]) => { if (args.some(a => typeof a === 'string' && /OTP/.test(a))) return; realLog(...args); };

/* eslint-disable @typescript-eslint/no-var-requires */
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');
const UserModel = require('../database/models/user.model').default;
const ReferralModel = require('../database/models/referral.model').default;
const SubscriptionModel = require('../database/models/subscription.model').default;
const { SubscriptionType } = require('../database/models/subscription.model');
const SubscriptionActivationModel = require('../database/models/subscription-activation.model').default;
const { notificationService } = require('../services/clients/notification.service.client');
const { subscriptionService } = require('../services/subscription.service');
const { userService } = require('../services/user.service');
const { STALE_RESERVATION_MS } = require('../services/subscription-activation');
const userRoutes = require('../api/routes/user.routes').default;
const subscriptionRoutes = require('../api/routes/subscription.routes').default;

let failures = 0;
let passes = 0;
const check = (label: string, ok: boolean, detail = '') => {
    realLog(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (ok) passes++; else failures++;
};

// ─── Notification stubs ──────────────────────────────────────────────────────
const otpsSent: any[] = [];
const emails: any[] = [];
const pushes: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { otpsSent.push(p); return true; };
(notificationService as any).sendAccountEmail = async (p: any) => { emails.push(p); return true; };
(notificationService as any).sendPush = async (p: any) => { pushes.push(p); return true; };
(notificationService as any).exitUserFromRelanceLoop = async () => true;
(notificationService as any).sendAccountActivationEmail = async () => true;
const lastCode = () => otpsSent[otpsSent.length - 1]?.code as string;

// Subscription side effects
// On the prototype: the webhook controller holds its own SubscriptionService instance.
let commissionCalls = 0;
const { SubscriptionService } = require('../services/subscription.service');
SubscriptionService.prototype.distributeSubscriptionCommission = async () => { commissionCalls++; };
SubscriptionService.prototype.triggerVCFCacheRegeneration = () => undefined;

const SECRET = process.env.SERVICE_SECRET!;
let base = '';
const post = (path: string, body: any, headers: Record<string, string> = {}) =>
    axios.post(`${base}${path}`, body, {
        headers: { Authorization: `Bearer ${SECRET}`, 'x-service-name': 'support-service', 'x-request-id': 'req-test', 'x-support-actor': 'agent1|support_agent', ...headers },
        validateStatus: () => true,
    });

const FORBIDDEN_KEYS = ['password', 'otps', 'contactsOtps', 'otpSendLog', 'token', 'passwordResetToken', 'passwordResetTokenExpiration', 'ipAddress', 'adminPermissions'];
const CONTRACT_KEYS = ['_id', 'name', 'email', 'phoneNumber', 'country', 'city', 'sex', 'language', 'role', 'createdAt', 'lastLogin',
    'isVerified', 'blocked', 'deleted', 'referrerId', 'referrerName', 'balance', 'usdBalance', 'reservedBalance', 'debt',
    'withdrawalLockedUntil', 'subscriptions',
    // Security plan Phase 2 (ledger) and Phase 5 (geo, frozen, Mobile Money; masked by support-service per agent permission).
    'ledger', 'geo', 'frozen', 'momoNumber', 'momoOperator'].sort();

async function main() {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([UserModel.syncIndexes(), SubscriptionActivationModel.syncIndexes()]);

    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    app.use('/api/subscriptions', subscriptionRoutes);
    const server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}`;

    const mk = (o: any) => UserModel.create({ password: 'Secret123!', country: 'CM', referralCode: `R${Math.random().toString(36).slice(2, 8)}`, ...o });
    const parrain = await mk({ name: 'Parrain Paul', email: 'parrain@gmail.com', phoneNumber: '237699000001' });
    const member = await mk({
        name: 'Membre Marie', email: 'marie.old@gmail.com', phoneNumber: '237677001122', city: 'Douala', sex: 'female',
        language: ['fr'], balance: 1500, usdBalance: 2, debt: 0, ipLastUpdated: new Date('2026-11-01T10:00:00Z'),
    });
    const legacy = await mk({ name: 'Ancien Format', email: 'legacy@gmail.com', phoneNumber: '677998877' });
    const other = await mk({ name: 'Autre Compte', email: 'taken@gmail.com', phoneNumber: '237655443322' });
    await mk({ name: 'Supprimé', email: 'gone@gmail.com', phoneNumber: '237611111111', deleted: true });
    await ReferralModel.create({ referrer: parrain._id, referredUser: member._id, referralLevel: 1 });
    await SubscriptionModel.create({ user: member._id, subscriptionType: 'CLASSIQUE', startDate: new Date(), endDate: new Date('2099-01-01'), status: 'active' });
    await userService.generateAndStoreOtp(member._id, 'otps'); // a live sign-in code on the account

    // ─── Auth ───────────────────────────────────────────────────────────────
    const noAuth = await axios.post(`${base}/api/users/internal/support-details`, { userIds: [String(member._id)] }, { validateStatus: () => true });
    check('support-details without the service secret is refused', noAuth.status === 401);
    const badAuth = await axios.post(`${base}/api/users/internal/support-details`, { userIds: [String(member._id)] }, { headers: { Authorization: 'Bearer nope' }, validateStatus: () => true });
    check('support-details with a wrong secret is refused', badAuth.status === 403);

    // ─── support-details ────────────────────────────────────────────────────
    const missing = new mongoose.Types.ObjectId().toString();
    const det = await post('/api/users/internal/support-details', { userIds: [String(legacy._id), missing, String(member._id)] });
    check('support-details answers 200', det.status === 200 && det.data.success === true, String(det.status));
    const rows: any[] = det.data.data || [];
    check('unknown ids are left out, order kept', rows.length === 2 && rows[0]._id === String(legacy._id) && rows[1]._id === String(member._id));
    const m = rows[1] || {};
    const raw = JSON.stringify(det.data);
    check('no password/otps/token field anywhere in the answer', FORBIDDEN_KEYS.every(k => !raw.includes(`"${k}"`)));
    check('no password hash anywhere in the answer', !raw.includes('$2b$') && !raw.includes('$2a$'));
    check('exactly the contract fields', JSON.stringify(Object.keys(m).sort()) === JSON.stringify(CONTRACT_KEYS), Object.keys(m).sort().join(','));
    check('reservedBalance defaults to 0', m.reservedBalance === 0);
    check('balances and profile fields come through', m.balance === 1500 && m.usdBalance === 2 && m.city === 'Douala' && m.language === 'fr' && m.country === 'CM');
    check('lastLogin is the last authenticated activity', m.lastLogin === '2026-11-01T10:00:00.000Z');
    check('direct parrain resolved', m.referrerId === String(parrain._id) && m.referrerName === 'Parrain Paul');
    check('subscriptions listed', Array.isArray(m.subscriptions) && m.subscriptions.length === 1 && m.subscriptions[0].type === 'CLASSIQUE' && m.subscriptions[0].status === 'active');
    const tooMany = await post('/api/users/internal/support-details', { userIds: Array.from({ length: 101 }, () => missing) });
    check('more than 100 ids is refused', tooMany.status === 400);
    const badId = await post('/api/users/internal/support-details', { userIds: ['abc'] });
    check('an invalid id is refused', badId.status === 400);

    // ─── support-search ─────────────────────────────────────────────────────
    const ids = async (q: string, limit?: number) => {
        const r = await post('/api/users/internal/support-search', { q, limit });
        return { status: r.status, ids: (r.data.data || []).map((h: any) => h._id) as string[], hits: r.data.data || [] };
    };
    for (const q of ['237677001122', '+237 677 00 11 22', '+237677001122', '677001122', '677 00 11 22', '(+237) 677-001-122', '00237677001122'.replace(/^00/, '+')]) {
        const r = await ids(q);
        check(`phone "${q}" finds the member`, r.ids.length === 1 && r.ids[0] === String(member._id), r.ids.join(','));
    }
    const leg = await ids('+237 677 99 88 77');
    check('a number stored without its dialling code is found from the full format', leg.ids.length === 1 && leg.ids[0] === String(legacy._id));
    const em = await ids('Marie.OLD@Gmail.com');
    check('email in any case', em.ids.length === 1 && em.ids[0] === String(member._id));
    const byId = await ids(String(member._id));
    check('exact _id', byId.ids.length === 1 && byId.ids[0] === String(member._id));
    const byName = await ids('membre m');
    check('name prefix, case-insensitive', byName.ids.length === 1 && byName.ids[0] === String(member._id));
    const noMid = await ids('Marie');
    check('name search is a prefix, not a substring', noMid.ids.length === 0);
    const del = await ids('237611111111');
    check('deleted accounts are findable', del.ids.length === 1);
    const hitKeys = Object.keys(em.hits[0] || {}).sort().join(',');
    check('search hit has only _id, name, country, role, createdAt', hitKeys === ['_id', 'country', 'createdAt', 'name', 'role'].sort().join(','), hitKeys);
    for (let i = 0; i < 25; i++) await mk({ name: `Zed ${i}`, email: `zed${i}@gmail.com`, phoneNumber: `23769000${String(i).padStart(4, '0')}` });
    const capped = await ids('zed', 100);
    check('limit is capped at 20', capped.ids.length === 20, String(capped.ids.length));
    const regexInj = await ids('.*');
    check('regex characters are matched literally', regexInj.status === 200 && regexInj.ids.length === 0);

    // ─── contact-change ─────────────────────────────────────────────────────
    const cc = (body: any) => post('/api/users/internal/support/contact-change', { userId: String(member._id), approvalId: 'appr-1', ...body });
    const noApproval = await post('/api/users/internal/support/contact-change', { userId: String(member._id), field: 'email', newValue: 'x@gmail.com', step: 'send-code' });
    check('approvalId is required', noApproval.status === 400 && noApproval.data.code === 'APPROVAL_REQUIRED');

    const takenEmail = await cc({ field: 'email', newValue: ' Taken@Gmail.com ', step: 'send-code' });
    check('an email used by another account → 400 CONTACT_UNAVAILABLE', takenEmail.status === 400 && takenEmail.data.code === 'CONTACT_UNAVAILABLE');
    check('…with a neutral message (no other account revealed)', !/taken|autre compte|another/i.test(takenEmail.data.message) && !JSON.stringify(takenEmail.data).includes(String(other._id)), takenEmail.data.message);
    const takenPhone = await cc({ field: 'phoneNumber', newValue: '+237 655 44 33 22', step: 'send-code' });
    check('a number used by another account (other format) → CONTACT_UNAVAILABLE', takenPhone.status === 400 && takenPhone.data.code === 'CONTACT_UNAVAILABLE');
    const takenDeleted = await cc({ field: 'phoneNumber', newValue: '611111111', step: 'send-code' });
    check('a number held by a deleted account is unavailable too', takenDeleted.status === 400 && takenDeleted.data.code === 'CONTACT_UNAVAILABLE');
    check('nothing was sent for refused values', otpsSent.length === 0);
    const same = await cc({ field: 'phoneNumber', newValue: '677001122', step: 'send-code' });
    check('the current number (other format) is refused as SAME_VALUE', same.status === 400 && same.data.code === 'SAME_VALUE');

    const phoneOff = await cc({ field: 'phoneNumber', newValue: '237699112233', step: 'send-code' });
    check('phone change while WhatsApp OTP is off → 503 CHANNEL_UNAVAILABLE (no fallback to old contact)', phoneOff.status === 503 && phoneOff.data.code === 'CHANNEL_UNAVAILABLE' && otpsSent.length === 0);

    const send = await cc({ field: 'email', newValue: 'Marie.New@Gmail.com', step: 'send-code' });
    check('send-code answers 200', send.status === 200 && send.data.data?.sent === true, JSON.stringify(send.data));
    const sentOtp = otpsSent[otpsSent.length - 1];
    check('the code goes to the NEW address, by email', sentOtp?.recipient === 'marie.new@gmail.com' && sentOtp?.channel === 'email');
    const supportCode = lastCode();
    const again = await cc({ field: 'email', newValue: 'marie.new@gmail.com', step: 'send-code' });
    check('a second send within a minute → 429 CODE_COOLDOWN', again.status === 429 && again.data.code === 'CODE_COOLDOWN');

    const signIn = await userService.validateOtp(member._id, 'otps', supportCode);
    check('the support code never signs in', signIn.isValid === false);
    const viaMember = await userService.confirmChangeEmail(member._id, 'marie.new@gmail.com', supportCode).then(() => 'ok', (e: any) => e?.statusCode);
    check('the support code does not confirm the member’s own email-change flow', viaMember === 400, String(viaMember));

    const wrong = await cc({ field: 'email', newValue: 'marie.new@gmail.com', step: 'apply', code: 'ZZZZZZ' });
    check('apply with a wrong code → 400 INVALID_CODE', wrong.status === 400 && wrong.data.code === 'INVALID_CODE');
    const otherTarget = await cc({ field: 'email', newValue: 'someone.else@gmail.com', step: 'apply', code: supportCode });
    check('the code does not apply another address', otherTarget.status === 400 && otherTarget.data.code === 'INVALID_CODE');
    const noCode = await cc({ field: 'email', newValue: 'marie.new@gmail.com', step: 'apply' });
    check('apply without a code → 400', noCode.status === 400);

    emails.length = 0; pushes.length = 0;
    const applies = await Promise.all(Array.from({ length: 5 }, () =>
        cc({ field: 'email', newValue: 'marie.new@gmail.com', step: 'apply', code: supportCode.toUpperCase() })));
    const ok = applies.filter(r => r.status === 200);
    check('apply ×5 at once: exactly one applies', ok.length === 1, applies.map(r => `${r.status}:${r.data.code ?? ''}`).join(' '));
    const after = await UserModel.findById(member._id).lean();
    check('the email is changed', after.email === 'marie.new@gmail.com');
    check('withdrawals are locked (email_change)', !!after.withdrawalsLockedUntil && after.withdrawalLockReason === 'email_change' && new Date(after.withdrawalsLockedUntil) > new Date());
    check('every code on the account is cleared (old sign-in code too)', (after.otps || []).length === 0);
    await new Promise(r => setTimeout(r, 50));
    check('the alert goes to the OLD email', emails.length === 1 && emails[0].email === 'marie.old@gmail.com', JSON.stringify(emails.map(e => e.email)));
    check('…plus a push', pushes.length === 1 && pushes[0].userId === String(member._id));
    const replay = await cc({ field: 'email', newValue: 'marie.new@gmail.com', step: 'apply', code: supportCode });
    check('the code cannot be replayed', replay.status === 400);

    // Phone change with WhatsApp on: code to the NEW number
    process.env.WHATSAPP_OTP_ENABLED = 'true';
    otpsSent.length = 0;
    const sendPhone = await cc({ field: 'phoneNumber', newValue: '+237 699 11 22 33', step: 'send-code' });
    check('phone send-code goes to the new number on WhatsApp', sendPhone.status === 200 && otpsSent[0]?.recipient === '237699112233' && otpsSent[0]?.channel === 'whatsapp');
    // The number is taken by another account between send and apply
    await UserModel.updateOne({ _id: other._id }, { $set: { phoneNumber: '237699112233' } });
    const raced = await cc({ field: 'phoneNumber', newValue: '237699112233', step: 'apply', code: lastCode() });
    check('a number taken between send and apply → CONTACT_UNAVAILABLE', raced.status === 400 && raced.data.code === 'CONTACT_UNAVAILABLE');
    process.env.WHATSAPP_OTP_ENABLED = 'false';

    // ─── Subscription activation idempotency ────────────────────────────────
    const buyer = await mk({ name: 'Acheteur', email: 'buyer@gmail.com', phoneNumber: '237670000099' });
    const buyerId = String(buyer._id);
    const meta = (planId: string, extra: any = {}) => ({ userId: buyerId, planId, originatingService: 'user-service', ...extra });
    const countSubs = (type: string) => SubscriptionModel.countDocuments({ user: buyer._id, subscriptionType: type });

    commissionCalls = 0;
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-classique-1', meta('CLASSIQUE'));
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-classique-1', meta('CLASSIQUE'));
    await new Promise(r => setTimeout(r, 20));
    check('same sessionId twice: one CLASSIQUE', (await countSubs('CLASSIQUE')) === 1);
    check('…and one commission run', commissionCalls === 1, String(commissionCalls));
    const rec = await SubscriptionActivationModel.findOne({ sessionId: 'sess-classique-1' }).lean();
    check('the payment is recorded as applied', rec?.status === 'applied' && !!rec.subscriptionId);

    // Concurrent ×5, through the real webhook route
    const buyer2 = await mk({ name: 'Acheteur Deux', email: 'buyer2@gmail.com', phoneNumber: '237670000098' });
    commissionCalls = 0;
    const hooks = await Promise.all(Array.from({ length: 5 }, () =>
        post('/api/subscriptions/webhooks/payment-confirmation', { sessionId: 'sess-cible-1', status: 'SUCCEEDED', metadata: { ...meta('CIBLE'), userId: String(buyer2._id) } })
            .catch((e: any) => ({ status: e?.code }))));
    await new Promise(r => setTimeout(r, 20));
    check('webhook ×5 at once: one CIBLE created', (await SubscriptionModel.countDocuments({ user: buyer2._id })) === 1);
    check('…one commission run', commissionCalls === 1, String(commissionCalls));
    check('…the others answer 200 (already applied) or 409 (in progress), never 500', hooks.every((h: any) => h.status === 200 || h.status === 409), hooks.map((h: any) => h.status).join(','));
    check('…at least one 200', hooks.some((h: any) => h.status === 200));

    // Concurrent ×5 directly on the service (no HTTP)
    const buyer3 = await mk({ name: 'Acheteur Trois', email: 'buyer3@gmail.com', phoneNumber: '237670000097' });
    commissionCalls = 0;
    const direct = await Promise.allSettled(Array.from({ length: 5 }, () =>
        subscriptionService.handleSubscriptionPaymentSuccess('sess-classique-3', { ...meta('CLASSIQUE'), userId: String(buyer3._id) })));
    await new Promise(r => setTimeout(r, 20));
    check('service ×5 at once: one CLASSIQUE, one commission run', (await SubscriptionModel.countDocuments({ user: buyer3._id })) === 1 && commissionCalls === 1, String(commissionCalls));
    check('…the losers are "already applied" or ACTIVATION_IN_PROGRESS', direct.every(r => r.status === 'fulfilled' || (r as any).reason?.code === 'ACTIVATION_IN_PROGRESS'));

    // VISIBILITE_MAX: a replayed callback would extend a month for free
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-vm-1', meta('VISIBILITE_MAX'));
    const vm1 = await SubscriptionModel.findOne({ user: buyer._id, subscriptionType: 'VISIBILITE_MAX' }).lean();
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-vm-1', meta('VISIBILITE_MAX'));
    const vm2 = await SubscriptionModel.findOne({ user: buyer._id, subscriptionType: 'VISIBILITE_MAX' }).lean();
    check('VISIBILITE_MAX replay does not extend again', String(vm1.endDate) === String(vm2.endDate));
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-vm-2', meta('VISIBILITE_MAX'));
    const vm3 = await SubscriptionModel.findOne({ user: buyer._id, subscriptionType: 'VISIBILITE_MAX' }).lean();
    check('control: a NEW payment does extend', new Date(vm3.endDate) > new Date(vm2.endDate));

    // Failure releases the reservation; the next delivery applies
    const buyer4 = await mk({ name: 'Acheteur Quatre', email: 'buyer4@gmail.com', phoneNumber: '237670000096' });
    const realActivate = subscriptionService.activateSubscription.bind(subscriptionService);
    (subscriptionService as any).activateSubscription = async () => { throw new Error('simulated DB failure'); };
    const failed = await subscriptionService.handleSubscriptionPaymentSuccess('sess-fail-1', { ...meta('CIBLE'), userId: String(buyer4._id) }).then(() => 'ok', () => 'threw');
    (subscriptionService as any).activateSubscription = realActivate;
    check('a failed activation throws', failed === 'threw');
    check('…and releases the payment', (await SubscriptionActivationModel.countDocuments({ sessionId: 'sess-fail-1' })) === 0);
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-fail-1', { ...meta('CIBLE'), userId: String(buyer4._id) });
    check('…so the next delivery activates', (await SubscriptionModel.countDocuments({ user: buyer4._id, subscriptionType: 'CIBLE' })) === 1);

    // A reservation left by a crashed process is taken over after the stale delay only
    const buyer5 = await mk({ name: 'Acheteur Cinq', email: 'buyer5@gmail.com', phoneNumber: '237670000095' });
    await SubscriptionActivationModel.create({ sessionId: 'sess-stuck-1', userId: buyer5._id, planId: 'CLASSIQUE', status: 'applying', reservedAt: new Date() });
    const fresh = await subscriptionService.handleSubscriptionPaymentSuccess('sess-stuck-1', { ...meta('CLASSIQUE'), userId: String(buyer5._id) }).then(() => 'ok', (e: any) => e?.code);
    check('a fresh "applying" reservation is not taken over', fresh === 'ACTIVATION_IN_PROGRESS' && (await SubscriptionModel.countDocuments({ user: buyer5._id })) === 0);
    await SubscriptionActivationModel.updateOne({ sessionId: 'sess-stuck-1' }, { $set: { reservedAt: new Date(Date.now() - STALE_RESERVATION_MS - 1000) } });
    await subscriptionService.handleSubscriptionPaymentSuccess('sess-stuck-1', { ...meta('CLASSIQUE'), userId: String(buyer5._id) });
    check('a stale one is taken over and applied', (await SubscriptionModel.countDocuments({ user: buyer5._id })) === 1
        && (await SubscriptionActivationModel.findOne({ sessionId: 'sess-stuck-1' }).lean())?.status === 'applied');

    // Same sessionId delivered with someone else's metadata is never applied
    const intruder = await mk({ name: 'Intrus', email: 'intrus@gmail.com', phoneNumber: '237670000094' });
    const hijack = await subscriptionService.handleSubscriptionPaymentSuccess('sess-classique-1', { ...meta('CLASSIQUE'), userId: String(intruder._id) }).then(() => 'ok', (e: any) => e?.code);
    check('an applied sessionId re-sent for another user activates nothing', (await SubscriptionModel.countDocuments({ user: intruder._id })) === 0, String(hijack));

    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    realLog(`\n${passes} passed, ${failures} failed`);
    process.exit(failures ? 1 : 0);
}

main().catch(async err => {
    realLog(err);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
