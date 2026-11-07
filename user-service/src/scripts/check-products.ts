import mongoose, { Types } from 'mongoose';
import http from 'http';
import config from '../config';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import ContactsWebhookEventModel from '../database/models/contacts-webhook-event.model';
import { paymentService } from '../services/clients/payment.service.client';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import {
    getOffers, initiateProductPurchase, handleProductPayment, addExtraNumber, removeExtraNumber, getExtraNumbers,
} from '../services/products.service';
import { getSubscriptionState } from '../services/subscription-state.service';
import { deliverDueContactsEvents, expireEndedAddons, signContactsBody } from '../services/contacts-webhook.service';

/**
 * Asserts Pack Winner, the PRO / MISE_EN_AVANT add-ons, extra WhatsApp
 * numbers and the SBC Contacts webhook (2026-11-07).
 *
 * Needs a Mongo instance; uses its own database and drops it. Payment,
 * notification and referral calls are replaced by recorders, and the Contacts
 * app by a local HTTP server.
 *
 *   npx ts-node src/scripts/check-products.ts
 */

const DB = process.env.PRODUCTS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_products_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

// --- recorders in place of the other services ---
const intents: any[] = [];
const deposits: any[] = [];
const grants: any[] = [];
(paymentService as any).createIntent = async (p: any) => { intents.push(p); return { sessionId: `s${intents.length}` }; };
(paymentService as any).recordInternalDeposit = async (p: any) => { deposits.push(p); return {}; };
(notificationService as any).grantRelanceCredits = async (...a: any[]) => { grants.push(a); return true; };
(notificationService as any).exitUserFromRelanceLoop = async () => true;
(notificationService as any).sendAccountActivationEmail = async () => true;
(notificationService as any).sendPush = async () => true;
const L1 = new Types.ObjectId().toString(), L2 = new Types.ObjectId().toString(), L3 = new Types.ObjectId().toString();
(userService as any).getReferrerIds = async () => ({ level1: L1, level2: L2, level3: L3 });

let n = 0;
const member = async (types: SubscriptionType[] = []) => {
    const u = await UserModel.create({ name: `M${n}`, email: `m${n}@x.test`, phoneNumber: `23767700${String(n++).padStart(4, '0')}`, password: 'x', region: 'Centre', country: 'CM' } as any);
    for (const t of types) await SubscriptionModel.create({ user: u._id, subscriptionType: t, endDate: new Date('9999-12-31'), status: SubscriptionStatus.ACTIVE });
    return u._id.toString();
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // Offers and prices
    const fresh = await member();
    let o = await getOffers(fresh);
    check('new member: Winner costs 15 900 F', o.packs[2].payPrice === 15900 && o.packs[2].state === 'available');
    check('new member: add-ons need a pack first', o.addons.every(a => !a.canBuy && !!a.reason));
    check('PRO yearly shows 24 000 crossed out', o.addons.find(a => a.id === 'PRO_YEARLY')?.listPrice === 24000);
    check('add-on purchase refused to a non-member (403)', (await refusal(() => initiateProductPurchase(fresh, 'PRO')))?.status === 403);

    const classique = await member([SubscriptionType.CLASSIQUE]);
    o = await getOffers(classique);
    check('Classique member: Winner upgrade 13 650 F', o.packs[2].state === 'upgrade' && o.packs[2].payPrice === 13650);
    check('Classique member: Ciblé upgrade 3 150 F', o.packs[1].state === 'upgrade' && o.packs[1].payPrice === 3150);
    const cible = await member([SubscriptionType.CIBLE]);
    o = await getOffers(cible);
    check('Ciblé member: Winner upgrade 10 600 F', o.packs[2].payPrice === 10600 && o.packs[0].state === 'included');
    const oc = await getOffers(cible, 'crypto');
    check('crypto prices in USD', oc.currency === 'USD' && oc.packs[2].payPrice === 25.5 && oc.addons[0].price === 4.8);

    // PRO monthly: purchase, apply once, renew from the end date
    const r = await initiateProductPurchase(cible, 'PRO');
    const proMeta = intents[intents.length - 1].metadata;
    check('PRO intent: 2 000 XAF, USD price for crypto, product metadata', intents[intents.length - 1].amount === 2000 && proMeta.cryptoUsdAmount === 4.8 && proMeta.product === 'ADDON');
    await handleProductPayment(r.paymentDetails.sessionId, proMeta);
    await handleProductPayment(r.paymentDetails.sessionId, proMeta); // repeated callback
    let pro = await SubscriptionModel.find({ user: cible, subscriptionType: SubscriptionType.PRO }).lean();
    const days = (d: Date) => Math.round((d.getTime() - Date.now()) / 86400000);
    check('PRO applied once on a repeated callback', pro.length === 1 && days(pro[0].endDate) >= 28 && days(pro[0].endDate) <= 31, `${days(pro[0].endDate)} days`);
    check('PRO commission: 20% (400 F) to the direct parrain only', deposits.length === 1 && deposits[0].userId === L1 && deposits[0].amount === 400);
    const r2 = await initiateProductPurchase(cible, 'PRO_YEARLY');
    await handleProductPayment(r2.paymentDetails.sessionId, intents[intents.length - 1].metadata);
    pro = await SubscriptionModel.find({ user: cible, subscriptionType: SubscriptionType.PRO }).lean();
    check('yearly renewal extends the running period by 12 months', pro.length === 1 && days(pro[0].endDate) >= 390, `${days(pro[0].endDate)} days`);
    check('yearly commission 2 400 F', deposits[deposits.length - 1].amount === 2400);

    // Pack Winner from Classique
    deposits.length = 0;
    const w = await initiateProductPurchase(classique, 'WINNER');
    const wMeta = intents[intents.length - 1].metadata;
    check('Winner from Classique charges 13 650 F', intents[intents.length - 1].amount === 13650 && wMeta.winnerFrom === 'CLASSIQUE');
    await handleProductPayment(w.paymentDetails.sessionId, wMeta);
    await handleProductPayment(w.paymentDetails.sessionId, wMeta);
    const subs = await SubscriptionModel.find({ user: classique, status: SubscriptionStatus.ACTIVE }).lean();
    const has = (t: string) => subs.filter(s => s.subscriptionType === t);
    check('Winner: Classique became Ciblé, one Winner marker', has('CIBLE').length === 1 && has('CLASSIQUE').length === 0 && has('WINNER').length === 1);
    check('Winner: one year of PRO', has('PRO').length === 1 && days(has('PRO')[0].endDate) >= 360);
    const wu = await UserModel.findById(classique).lean() as any;
    check('Winner: 3 extra number slots, once', wu.extraNumberSlots === 3);
    check('Winner: 1 000 relance credits granted once, by payment reference', grants.length === 1 && grants[0][1] === `winner:${w.paymentDetails.sessionId}` && grants[0][2] === 'winner_email_1k');
    check('Winner from Classique commissions 4000 / 2000 / 1000', JSON.stringify(deposits.map(d => d.amount)) === '[4000,2000,1000]');
    check('Winner bought twice is refused (409)', (await refusal(() => initiateProductPurchase(classique, 'WINNER')))?.status === 409);
    o = await getOffers(classique);
    check('Winner member sees Winner owned, Ciblé and Classique included', o.packs[2].state === 'owned' && o.packs[1].state === 'included' && o.packs[0].state === 'included');

    // Extra numbers
    const own = await UserModel.findById(classique).lean() as any;
    check('own main number refused', (await refusal(() => addExtraNumber(classique, own.phoneNumber)))?.status === 400);
    await addExtraNumber(classique, '+33 6 11 22 33 44');
    check('duplicate refused', (await refusal(() => addExtraNumber(classique, '33611223344')))?.status === 400);
    await addExtraNumber(classique, '22997000001');
    const three = await addExtraNumber(classique, '22997000002');
    check('3 numbers fill 3 slots', three.numbers.length === 3);
    check('4th number refused without a free slot', (await refusal(() => addExtraNumber(classique, '22997000003')))?.status === 400);
    const after = await removeExtraNumber(classique, three.numbers[0]._id);
    check('removing frees a slot', after.numbers.length === 2 && after.slots === 3);
    const e = intents.length;
    const { initiateExtraNumberPurchase } = await import('../services/products.service');
    const buy = await initiateExtraNumberPurchase(classique);
    await handleProductPayment(buy.sessionId, intents[e].metadata);
    await handleProductPayment(buy.sessionId, intents[e].metadata);
    check('a bought slot is added once (500 F)', intents[e].amount === 500 && (await getExtraNumbers(classique)).slots === 4);

    // SSO state
    const st = await getSubscriptionState(classique);
    check('SSO: subscriptionTypes lists active types incl. WINNER and PRO', ['CIBLE', 'WINNER', 'PRO'].every(t => st.subscriptionTypes.includes(t)));
    check('SSO: subscriptions has dates, no WINNER entry, lifetime expiresAt null',
        st.subscriptions.some(s => s.type === 'PRO' && s.status === 'active' && !!s.expiresAt) &&
        !st.subscriptions.some(s => s.type === 'WINNER') &&
        st.subscriptions.some(s => s.type === 'CIBLE' && s.expiresAt === null));

    // Expiry and the Contacts webhook (local server standing in for the app)
    const received: { body: string; sig: string }[] = [];
    let answer = 500;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => { received.push({ body, sig: String(req.headers['x-sbc-signature']) }); res.statusCode = answer; res.end('{}'); });
    }).listen(0);
    await new Promise(r => server.once('listening', r));
    (config as any).contactsApp = { webhookUrl: `http://127.0.0.1:${(server.address() as any).port}/hook`, webhookSecret: 'test-secret' };
    await SubscriptionModel.updateOne({ user: cible, subscriptionType: SubscriptionType.PRO }, { $set: { endDate: new Date(Date.now() - 1000) } });
    check('ended PRO period marked expired', (await expireEndedAddons()) === 1);
    await new Promise(r => setTimeout(r, 500));
    const ev = await ContactsWebhookEventModel.findOne({ userId: cible }).lean();
    check('expired event queued and sent, refused once, retry scheduled', ev?.type === 'subscription.expired' && ev?.status === 'pending' && ev?.attempts === 1 && received.length === 1);
    check('signature is HMAC-SHA256 of the raw body', received[0]?.sig === signContactsBody(received[0]?.body ?? '', 'test-secret'));
    const sent = JSON.parse(received[0].body);
    check('body carries the full state', sent.data.user.id === cible && Array.isArray(sent.data.user.subscriptions) && sent.id.startsWith('evt_'));
    answer = 202;
    await ContactsWebhookEventModel.updateOne({ _id: ev!._id }, { $set: { nextAttemptAt: new Date() } });
    await deliverDueContactsEvents();
    const ev2 = await ContactsWebhookEventModel.findById(ev!._id).lean();
    check('retry with the same id and body is delivered', ev2?.status === 'delivered' && received[1]?.body === received[0].body);
    server.close();

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
