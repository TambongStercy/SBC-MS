import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { SponsoredActivationModel } from '../database/models/sponsored-activation.model';
import ProductPaymentModel from '../database/models/product-payment.model';
import { paymentService } from '../services/clients/payment.service.client';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import { subscriptionService } from '../services/subscription.service';
import { activationBalanceService } from '../services/activation-balance.service';
import { ACTIVATION_PRICES } from '../config/activation-pricing';

/**
 * Asserts Pack Winner sponsored from the activation balance (2026-11-12):
 * the price follows the filleul's current pack, the filleul gets everything a
 * paid Winner gets, commissions are paid once, and the balance comes back if
 * the activation fails. Also the referral list flags (`canUpgradeToWinner`,
 * the "upgradable" filter).
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-activation-winner.ts
 */

const DB = process.env.ACTIVATION_WINNER_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_activation_winner_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const deposits: any[] = [];
const activationTx: any[] = [];
(paymentService as any).recordInternalDeposit = async (p: any) => { deposits.push(p); return {}; };
(paymentService as any).recordActivationTransaction = async (p: any) => { activationTx.push(p); return { transactionId: `t${activationTx.length}` }; };
(notificationService as any).grantRelanceCredits = async () => true;
(notificationService as any).exitUserFromRelanceLoop = async () => true;
(notificationService as any).sendAccountActivationEmail = async () => true;
(notificationService as any).sendPush = async () => true;
const L1 = new Types.ObjectId().toString(), L2 = new Types.ObjectId().toString(), L3 = new Types.ObjectId().toString();
(userService as any).getReferrerIds = async () => ({ level1: L1, level2: L2, level3: L3 });

let n = 0;
const member = async (types: SubscriptionType[] = [], activationBalance = 0) => {
    const u = await UserModel.create({ name: `M${n}`, email: `m${n}@x.test`, phoneNumber: `23767710${String(n++).padStart(4, '0')}`, password: 'x', region: 'Centre', country: 'CM', activationBalance } as any);
    for (const t of types) await SubscriptionModel.create({ user: u._id, subscriptionType: t, endDate: new Date('9999-12-31'), status: SubscriptionStatus.ACTIVE });
    return u._id.toString();
};
const balanceOf = async (id: string) => ((await UserModel.findById(id).select('activationBalance').lean()) as any)?.activationBalance;
const has = (id: string, t: SubscriptionType) => SubscriptionModel.exists({ user: new Types.ObjectId(id), subscriptionType: t, status: SubscriptionStatus.ACTIVE });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const sponsor = await member([SubscriptionType.CIBLE], 50000);
    const fresh = await member();
    const classique = await member([SubscriptionType.CLASSIQUE]);
    const cible = await member([SubscriptionType.CIBLE]);
    const winner = await member([SubscriptionType.CIBLE, SubscriptionType.WINNER]);
    const stranger = await member();
    for (const f of [fresh, classique, cible, winner]) {
        await ReferralModel.create({ referrer: sponsor, referredUser: f, referralLevel: 1 });
    }

    // Referral list flags, both code paths
    const all = await activationBalanceService.getReferralsForActivation(sponsor, 1, 20, 'all');
    const byId = (list: any[], id: string) => list.find(r => String(r._id) === id);
    check('list: Classique filleul can go Ciblé or Winner', byId(all.referrals, classique)?.canUpgrade === true && byId(all.referrals, classique)?.canUpgradeToWinner === true);
    check('list: Ciblé filleul can go Winner only', byId(all.referrals, cible)?.canUpgrade === false && byId(all.referrals, cible)?.canUpgradeToWinner === true);
    check('list: Winner filleul shown as WINNER, nothing to upgrade', byId(all.referrals, winner)?.currentSubscriptionType === 'WINNER' && byId(all.referrals, winner)?.canUpgradeToWinner === false);
    check('list: filleul without a pack is activatable', byId(all.referrals, fresh)?.hasActiveSubscription === false);
    const up = await activationBalanceService.getReferralsForActivation(sponsor, 1, 20, 'upgradable');
    check('"À upgrader" holds Classique and Ciblé filleuls, not Winner', up.total === 2 && !!byId(up.referrals, classique) && !!byId(up.referrals, cible), `total ${up.total}`);
    const act = await activationBalanceService.getReferralsForActivation(sponsor, 1, 20, 'activatable');
    check('"À activer" holds only the filleul without a pack', act.total === 1 && !!byId(act.referrals, fresh), `total ${act.total}`);
    check('filtered list carries the Winner flag', byId(up.referrals, cible)?.canUpgradeToWinner === true);

    // Prices by current pack
    let before = await balanceOf(sponsor);
    deposits.length = 0;
    const r1 = await activationBalanceService.sponsorReferralActivation(sponsor, cible, 'WINNER');
    check('Ciblé filleul: 10 600 F taken', before - (await balanceOf(sponsor)) === ACTIVATION_PRICES.WINNER_FROM_CIBLE && r1.newActivationBalance === before - 10600);
    check('Ciblé filleul now has Winner, PRO and MISE_EN_AVANT', !!(await has(cible, SubscriptionType.WINNER)) && !!(await has(cible, SubscriptionType.PRO)) && !!(await has(cible, SubscriptionType.MISE_EN_AVANT)));
    check('3 extra-number slots granted', ((await UserModel.findById(cible).lean()) as any)?.extraNumberSlots === 3);
    check('commissions from Ciblé: 2 500 / 1 250 / 625', JSON.stringify(deposits.map(d => d.amount)) === JSON.stringify([2500, 1250, 625]), JSON.stringify(deposits.map(d => d.amount)));
    const tx = activationTx[activationTx.length - 1];
    check('sponsor_activation recorded with WINNER and the price', tx?.type === 'sponsor_activation' && tx.amount === 10600 && tx.metadata?.subscriptionType === 'WINNER' && tx.metadata?.winnerFrom === 'CIBLE');
    check('SponsoredActivation row is WINNER', !!(await SponsoredActivationModel.exists({ beneficiary: new Types.ObjectId(cible), subscriptionType: SubscriptionType.WINNER, amount: 10600 })));

    before = await balanceOf(sponsor);
    deposits.length = 0;
    await activationBalanceService.sponsorReferralActivation(sponsor, classique, 'WINNER');
    check('Classique filleul: 13 650 F taken', before - (await balanceOf(sponsor)) === ACTIVATION_PRICES.WINNER_FROM_CLASSIQUE);
    check('Classique filleul upgraded to Ciblé in place', !!(await has(classique, SubscriptionType.CIBLE)) && !(await has(classique, SubscriptionType.CLASSIQUE)));
    check('commissions from Classique: 4 000 / 2 000 / 1 000', JSON.stringify(deposits.map(d => d.amount)) === JSON.stringify([4000, 2000, 1000]), JSON.stringify(deposits.map(d => d.amount)));

    // Refusals
    before = await balanceOf(sponsor);
    check('filleul who already has Winner refused (400)', (await refusal(() => activationBalanceService.sponsorReferralActivation(sponsor, winner, 'WINNER')))?.statusCode === 400);
    check('someone outside the network refused (403)', (await refusal(() => activationBalanceService.sponsorReferralActivation(sponsor, stranger, 'WINNER')))?.statusCode === 403);
    check('refusals take nothing', (await balanceOf(sponsor)) === before);
    const poor = await member([], 15000);
    await ReferralModel.create({ referrer: poor, referredUser: stranger, referralLevel: 1 });
    check('balance too low refused (400), nothing taken', (await refusal(() => activationBalanceService.sponsorReferralActivation(poor, stranger, 'WINNER')))?.statusCode === 400 && (await balanceOf(poor)) === 15000);

    // A failed activation gives the balance back
    const real = (subscriptionService as any).activateSubscription;
    (subscriptionService as any).activateSubscription = async () => null;
    before = await balanceOf(sponsor);
    const err = await refusal(() => activationBalanceService.sponsorReferralActivation(sponsor, fresh, 'WINNER'));
    (subscriptionService as any).activateSubscription = real;
    check('failed activation: error and balance given back', err?.statusCode === 500 && (await balanceOf(sponsor)) === before);

    deposits.length = 0;
    await activationBalanceService.sponsorReferralActivation(sponsor, fresh, 'WINNER');
    check('filleul without a pack: 15 900 F taken', before - (await balanceOf(sponsor)) === ACTIVATION_PRICES.WINNER);
    check('commissions from nothing: 5 000 / 2 500 / 1 250', JSON.stringify(deposits.map(d => d.amount)) === JSON.stringify([5000, 2500, 1250]), JSON.stringify(deposits.map(d => d.amount)));
    check('each sponsored Winner applied once (one productpayment each)', (await ProductPaymentModel.countDocuments({ sessionId: /^sponsored_winner_/ })) === 3);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
