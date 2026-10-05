/**
 * Asserts the pushes user-service sends: commissions, new filleuls, and the
 * reminder before a monthly subscription ends.
 *
 * Needs a Mongo instance (for the reminder query); uses its own database.
 * Run under Node 20 (prod's version):
 *   npx -y -p node@20 node -r ts-node/register src/scripts/check-push-notify.ts
 */
import mongoose, { Types } from 'mongoose';
import SubscriptionModel, { SubscriptionCategory, SubscriptionDuration, SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { notificationService } from '../services/clients/notification.service.client';
import { pushCommission, pushNewFilleul } from '../services/push-notify';
import { remindEndingSubscriptions } from '../jobs/subscription-ending-scheduler';

const DB = process.env.PUSH_NOTIFY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_push_notify_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const sent: any[] = [];
(notificationService as any).sendPush = async (p: any) => { sent.push(p); return true; };
const last = () => sent[sent.length - 1];

(async () => {
    // Commissions
    pushCommission({ referrerId: 'r1', amount: 1000, currency: 'XAF', level: 1, filleulName: 'Marie Ngono', plan: "l'abonnement CLASSIQUE", sourceRef: 's1' });
    check('a level-1 commission names the filleul and the amount', last().title.replace(/\s/g, ' ') === '+1 000 FCFA de commission' && last().body === "Marie vient de prendre l'abonnement CLASSIQUE.", JSON.stringify(last()));
    check('it is money: sent at any hour, opens the wallet', last().category === 'money' && last().url === '/wallet');

    pushCommission({ referrerId: 'r2', amount: 250, currency: 'XAF', level: 3, filleulName: 'paul@gmail.com', plan: "l'abonnement CIBLE", sourceRef: 's1' });
    check('a deeper level says so, and an email is never shown as a name', last().body === "Un filleul (filleul de niveau 3) vient de prendre l'abonnement CIBLE.", last().body);

    pushCommission({ referrerId: 'r1', amount: 2, currency: 'USD', level: 1, filleulName: 'Awa', plan: "l'abonnement CLASSIQUE", sourceRef: 's2' });
    check('crypto commissions are in dollars', last().title === '+$2 de commission', last().title);

    // New filleul
    pushNewFilleul('r1', { _id: 'u9', name: 'Paul Biya', phoneNumber: '+237 6 75 12 34 56' });
    check('a new filleul pushes to the parrain and opens the filleuls page', last().category === 'filleuls' && last().url === '/filleuls' && last().body === "Paul vient de s'inscrire avec ton lien.", JSON.stringify(last()));
    const wa = new URL(last().whatsapp);
    check('it carries a WhatsApp chat with the filleul, welcome typed in', wa.origin === 'https://wa.me' && wa.pathname === '/237675123456' && wa.searchParams.get('text')!.startsWith('Bonjour Paul 👋 Bienvenue sur SBC'), last().whatsapp);

    pushNewFilleul('r1', { _id: 'u10', name: 'Grace', phoneNumber: '242061234567' });
    check("Congo's leading 0 is kept", new URL(last().whatsapp).pathname === '/242061234567', last().whatsapp);

    pushNewFilleul('r1', { _id: 'u11', name: 'Awa', phoneNumber: '' });
    check('no number, no WhatsApp button (and still the push)', last().whatsapp === undefined && last().body === "Awa vient de s'inscrire avec ton lien.", JSON.stringify(last()));

    // Subscription ending
    await mongoose.connect(DB, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const now = new Date('2026-10-01T08:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const sub = (over: Record<string, unknown>) => SubscriptionModel.create({
        user: new Types.ObjectId(), subscriptionType: SubscriptionType.VISIBILITE_MAX, category: SubscriptionCategory.FEATURE,
        duration: SubscriptionDuration.MONTHLY, status: SubscriptionStatus.ACTIVE, startDate: new Date(now.getTime() - 27 * day),
        endDate: new Date(now.getTime() + 3.5 * day), ...over,
    });
    const due = await sub({});
    await sub({ endDate: new Date(now.getTime() + 2 * day) });                 // already reminded yesterday
    await sub({ endDate: new Date(now.getTime() + 5 * day) });                 // tomorrow's turn
    await sub({ status: SubscriptionStatus.EXPIRED });                          // over
    await sub({ subscriptionType: SubscriptionType.RELANCE });                  // retired
    await sub({ duration: SubscriptionDuration.LIFETIME, subscriptionType: SubscriptionType.CLASSIQUE, category: SubscriptionCategory.REGISTRATION });

    sent.length = 0;
    const n = await remindEndingSubscriptions(now);
    check('reminds only the active monthly subscription ending in 3 days', n === 1 && sent.length === 1 && sent[0].userId === String(due.user), `n=${n}`);
    check('the reminder names the plan and the day, and opens the subscription page',
        sent[0]?.title === 'Visibilité Max se termine le 4 octobre' && sent[0]?.url === '/abonnement' && sent[0]?.category === 'subscription', sent[0]?.title);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
