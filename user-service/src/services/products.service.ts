import { Types } from 'mongoose';
import config from '../config';
import SubscriptionModel, {
    ISubscription, SubscriptionCategory, SubscriptionDuration, SubscriptionStatus, SubscriptionType,
} from '../database/models/subscription.model';
import UserModel from '../database/models/user.model';
import ProductPaymentModel from '../database/models/product-payment.model';
import {
    ADDON_OFFERS, ADDON_COMMISSION_RATE_L1, AddonOffer, EXTRA_NUMBER, PACK_FEATURES, WINNER, WinnerFrom,
    addonCommissionBase, findAddonOffer,
} from '../config/subscription-products';
import { CRYPTO_SUBSCRIPTION_PRICING } from '../config/crypto-pricing';
import { paymentService } from './clients/payment.service.client';
import { notificationService } from './clients/notification.service.client';
import { emitContactsEvent } from './contacts-webhook.service';
import { pushCommission } from './push-notify';
import { isSamePhoneNumber } from '../utils/phone.utils';
import logger from '../utils/logger';

const log = logger.getLogger('ProductsService');

type PaymentMethod = 'crypto' | 'traditional';
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const MEMBERSHIP = [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE];
const NOT_A_MEMBER = 'Activez d\'abord votre pack (Classique, Ciblé ou Winner) pour ajouter cette option.';

/** Plan ids the purchase route sends here rather than to the CLASSIQUE/CIBLE flow. */
export const PRODUCT_PLAN_IDS = ['WINNER', 'PRO', 'PRO_YEARLY', 'MISE_EN_AVANT'];

const addMonths = (from: Date, months: number) => {
    const d = new Date(from);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
};

async function activeSubs(userId: string, now = new Date()) {
    return SubscriptionModel.find({ user: new Types.ObjectId(userId), status: SubscriptionStatus.ACTIVE, endDate: { $gt: now } })
        .select('subscriptionType endDate').lean();
}

function ownership(subs: { subscriptionType: string; endDate: Date }[]) {
    const has = (t: SubscriptionType) => subs.some(s => s.subscriptionType === t);
    const endOf = (t: SubscriptionType) => subs.filter(s => s.subscriptionType === t)
        .reduce<Date | null>((max, s) => (!max || s.endDate > max ? s.endDate : max), null);
    const winnerFrom: WinnerFrom = has(SubscriptionType.CIBLE) ? 'CIBLE' : has(SubscriptionType.CLASSIQUE) ? 'CLASSIQUE' : 'NONE';
    return {
        has, endOf, winnerFrom,
        member: MEMBERSHIP.some(has),
        types: Array.from(new Set(subs.map(s => String(s.subscriptionType)))),
    };
}

/** What the member sees on the membership page, priced for the payment method they chose. */
export async function getOffers(userId: string, paymentMethod: PaymentMethod = 'traditional') {
    const crypto = paymentMethod === 'crypto';
    const currency = crypto ? 'USD' : 'XAF';
    const p = (xaf: number, usd: number) => (crypto ? usd : xaf);
    const own = ownership(await activeSubs(userId));
    const hasWinner = own.has(SubscriptionType.WINNER);
    const hasCible = own.has(SubscriptionType.CIBLE);
    const hasClassique = own.has(SubscriptionType.CLASSIQUE);

    // payment-service charges crypto CLASSIQUE/CIBLE/upgrade as the USD price plus the XAF fee margin / 615.
    const withMargin = (usd: number, marginXaf: number) => Math.round((usd + marginXaf / 615) * 100) / 100;
    const classiquePrice = p(2150, withMargin(CRYPTO_SUBSCRIPTION_PRICING.classique.inscription, 150));
    const ciblePrice = p(5300, withMargin(CRYPTO_SUBSCRIPTION_PRICING.cible.inscription, 300));
    const winnerFull = WINNER.price.NONE;
    const winnerNow = WINNER.price[own.winnerFrom];

    const packs = [
        {
            id: 'CLASSIQUE', name: 'Pack Classique', price: classiquePrice, currency,
            ...(hasCible || hasWinner ? { state: 'included', payPrice: null }
                : hasClassique ? { state: 'owned', payPrice: null }
                    : { state: 'available', payPrice: classiquePrice }),
            features: PACK_FEATURES.CLASSIQUE,
        },
        {
            id: 'CIBLE', name: 'Pack Ciblé', price: ciblePrice, currency,
            ...(hasWinner ? { state: 'included', payPrice: null }
                : hasCible ? { state: 'owned', payPrice: null }
                    : hasClassique ? { state: 'upgrade', payPrice: p(3150, withMargin(CRYPTO_SUBSCRIPTION_PRICING.upgrade.inscription, 150)) }
                        : { state: 'available', payPrice: ciblePrice }),
            features: PACK_FEATURES.CIBLE,
        },
        {
            id: 'WINNER', name: WINNER.name, price: p(winnerFull.xaf, winnerFull.usd), currency,
            ...(hasWinner ? { state: 'owned', payPrice: null }
                : own.winnerFrom !== 'NONE' ? { state: 'upgrade', payPrice: p(winnerNow.xaf, winnerNow.usd) }
                    : { state: 'available', payPrice: p(winnerFull.xaf, winnerFull.usd) }),
            features: WINNER.features,
        },
    ];

    const addons = ADDON_OFFERS.map(o => {
        const end = own.endOf(o.type as SubscriptionType);
        return {
            id: o.id, type: o.type, name: o.name, price: p(o.xaf, o.usd),
            listPrice: crypto ? o.listUsd : o.listXaf, currency, period: o.period,
            activeUntil: end ? end.toISOString() : null,
            canBuy: own.member, reason: own.member ? null : NOT_A_MEMBER,
            features: o.features,
        };
    });

    const user = await UserModel.findById(userId).select('extraNumberSlots').lean();
    return {
        paymentMethod, currency, active: own.types, packs, addons,
        winner: {
            owned: hasWinner,
            vipGroupLink: hasWinner ? (config.winnerVipGroupLink || null) : null,
            extraNumberSlots: (user as any)?.extraNumberSlots ?? 0,
        },
    };
}

const callbackPath = () => `${config.selfBaseUrl}/api/subscriptions/webhooks/payment-confirmation`;

/** Starts the payment of Pack Winner or an add-on. Returns the same shape as a CLASSIQUE/CIBLE purchase. */
export async function initiateProductPurchase(userId: string, planType: string, paymentMethod: PaymentMethod = 'traditional') {
    const own = ownership(await activeSubs(userId));
    let xaf: number, usd: number, name: string, planId: SubscriptionType;
    let extra: Record<string, unknown>;

    if (planType === 'WINNER') {
        if (own.has(SubscriptionType.WINNER)) throw httpError(409, 'Vous avez déjà le Pack Winner.');
        ({ xaf, usd } = WINNER.price[own.winnerFrom]);
        name = WINNER.name;
        planId = SubscriptionType.WINNER;
        extra = { product: 'WINNER', offerId: 'WINNER', winnerFrom: own.winnerFrom };
    } else {
        const offer = findAddonOffer(planType);
        if (!offer) throw httpError(400, 'Offre inconnue.');
        if (!own.member) throw httpError(403, NOT_A_MEMBER);
        ({ xaf, usd, name } = offer);
        planId = offer.type as SubscriptionType;
        extra = { product: 'ADDON', offerId: offer.id };
    }

    const metadata = {
        userId, planId, planName: name, planType: planId, isUpgrade: false,
        paymentMethod, originatingService: 'user-service', callbackPath: callbackPath(),
        cryptoUsdAmount: usd, ...extra,
    };
    const paymentDetails = await paymentService.createIntent({ userId, amount: xaf, currency: 'XAF', paymentType: 'SUBSCRIPTION', metadata });
    log.info(`Payment intent ${paymentDetails.sessionId} for ${planType} (${xaf} XAF / $${usd}) by user ${userId}`);
    return {
        message: 'Payment required to activate subscription.',
        planDetails: { id: planType, name, price: paymentMethod === 'crypto' ? usd : xaf, currency: paymentMethod === 'crypto' ? 'USD' : 'XAF' },
        paymentDetails,
    };
}

/**
 * Adds `months` to a PRO / MISE_EN_AVANT period: from its current end when it
 * is still running (renewal), from now otherwise.
 */
async function extendFeature(userId: string, type: SubscriptionType, months: number, sessionId: string, duration: SubscriptionDuration) {
    const now = new Date();
    const user = new Types.ObjectId(userId);
    const current = await SubscriptionModel.findOne({ user, subscriptionType: type, status: SubscriptionStatus.ACTIVE, endDate: { $gt: now } }).sort({ endDate: -1 });
    if (current) {
        const endDate = addMonths(current.endDate, months);
        await SubscriptionModel.updateOne({ _id: current._id }, {
            $set: { endDate, nextRenewalDate: endDate, ...(duration === SubscriptionDuration.YEARLY ? { duration } : {}) },
            $push: { 'metadata.paymentSessionIds': sessionId },
        });
        log.info(`${type} of user ${userId} extended to ${endDate.toISOString()} (${sessionId})`);
        return { renewed: true, endDate };
    }
    const endDate = addMonths(now, months);
    await SubscriptionModel.create({
        user, subscriptionType: type, category: SubscriptionCategory.FEATURE, duration,
        startDate: now, endDate, nextRenewalDate: endDate, autoRenew: false, status: SubscriptionStatus.ACTIVE,
        metadata: { paymentSessionIds: [sessionId] },
    } as Partial<ISubscription>);
    log.info(`${type} of user ${userId} started, ends ${endDate.toISOString()} (${sessionId})`);
    return { renewed: false, endDate };
}

const isCryptoPayment = (sessionId: string, metadata: any) =>
    metadata?.paymentMethod === 'crypto' || metadata?.paymentMethod === 'nowpayments' ||
    metadata?.provider === 'nowpayments' || /crypto|nowpayments|np_/i.test(sessionId ?? '');

/** `planLabel` is used in the wallet line, `pushLabel` completes "X vient de prendre …". */
async function payCommissions(buyerId: string, sessionId: string, amounts: number[], currency: 'XAF' | 'USD', planLabel: string, pushLabel: string, planType: string) {
    const { userService } = await import('./user.service');
    const referrers = await userService.getReferrerIds(buyerId);
    if (!referrers) return;
    const buyer = await UserModel.findById(buyerId).select('name email').lean();
    const buyerName = (buyer as any)?.name || (buyer as any)?.email || buyerId;
    const levels = [referrers.level1, referrers.level2, referrers.level3];
    const jobs = levels.map(async (referrerId, i) => {
        const amount = amounts[i] ?? 0;
        if (!referrerId || !(amount > 0)) return;
        const level = i + 1;
        await paymentService.recordInternalDeposit({
            userId: referrerId, amount, currency,
            description: `Level ${level} commission from ${planLabel} purchase by ${buyerName}`,
            metadata: { commissionLevel: level, sourceUserId: buyerId, sourcePaymentSessionId: sessionId, sourcePlanType: planType, sourceIsUpgrade: false },
        });
        pushCommission({ referrerId, amount, currency, level, filleulName: (buyer as any)?.name, plan: pushLabel, sourceRef: sessionId });
    });
    const results = await Promise.allSettled(jobs);
    results.forEach((r, i) => { if (r.status === 'rejected') log.error(`L${i + 1} commission for ${planType} ${sessionId} failed: ${r.reason?.message ?? r.reason}`); });
}

async function applyWinner(userId: string, sessionId: string, metadata: any) {
    const { subscriptionService } = await import('./subscription.service');
    // 1. Pack Ciblé, for life (upgrades a CLASSIQUE in place, keeps an existing CIBLE).
    const cible = await subscriptionService.activateSubscription(userId, SubscriptionType.CIBLE);
    if (!cible) throw new Error('CIBLE activation failed');
    // Steps 2-3 skip what an earlier, interrupted delivery of this payment already did.
    // 2. The Winner marker.
    const now = new Date();
    const user = new Types.ObjectId(userId);
    if (!await SubscriptionModel.exists({ user, subscriptionType: SubscriptionType.WINNER, status: SubscriptionStatus.ACTIVE })) await SubscriptionModel.create({
        user: new Types.ObjectId(userId), subscriptionType: SubscriptionType.WINNER,
        category: SubscriptionCategory.REGISTRATION, duration: SubscriptionDuration.LIFETIME,
        startDate: now, endDate: new Date('9999-12-31T23:59:59.999Z'), status: SubscriptionStatus.ACTIVE,
        metadata: { paymentSessionId: sessionId, from: metadata?.winnerFrom ?? 'NONE' },
    } as Partial<ISubscription>);
    // 3. A year of PRO (client requests in the SBC Network app).
    if (!await SubscriptionModel.exists({ user, subscriptionType: SubscriptionType.PRO, 'metadata.paymentSessionIds': sessionId })) {
        await extendFeature(userId, SubscriptionType.PRO, WINNER.proMonths, sessionId, SubscriptionDuration.YEARLY);
    }
    // 3b. A month of MISE_EN_AVANT on SBC Network.
    if (!await SubscriptionModel.exists({ user, subscriptionType: SubscriptionType.MISE_EN_AVANT, 'metadata.paymentSessionIds': sessionId })) {
        await extendFeature(userId, SubscriptionType.MISE_EN_AVANT, WINNER.miseEnAvantMonths, sessionId, SubscriptionDuration.MONTHLY);
    }
    // 4. Three extra WhatsApp numbers.
    await UserModel.updateOne({ _id: userId }, { $inc: { extraNumberSlots: WINNER.extraNumberSlots } });
    // 5. Relance credits (credited once per payment by notification-service).
    const granted = await notificationService.grantRelanceCredits(userId, `winner:${sessionId}`, WINNER.relancePackId);
    if (!granted) log.error(`ACTION NEEDED: ${WINNER.relanceCredits} relance credits for Winner ${sessionId} (user ${userId}) were not credited; re-run the grant`);
}

/**
 * Applies a paid product once per payment, then pays commissions and tells the
 * Contacts app. Throws when the product could not be applied, so the payment
 * callback answers 500 and the claim is released for a retry.
 */
export async function handleProductPayment(sessionId: string, metadata: any): Promise<void> {
    const userId = String(metadata?.userId ?? '');
    const product = metadata?.product as 'WINNER' | 'ADDON' | 'EXTRA_NUMBER';
    if (!Types.ObjectId.isValid(userId) || !['WINNER', 'ADDON', 'EXTRA_NUMBER'].includes(product)) {
        throw httpError(400, 'Invalid product payment metadata');
    }
    try {
        await ProductPaymentModel.create({ sessionId, userId: new Types.ObjectId(userId), product, offerId: metadata?.offerId });
    } catch (err: any) {
        if (err?.code === 11000) { log.warn(`Product payment ${sessionId} already applied; ignoring repeat`); return; }
        throw err;
    }

    const currency: 'XAF' | 'USD' = isCryptoPayment(sessionId, metadata) ? 'USD' : 'XAF';
    let after: () => Promise<void> = async () => undefined;
    try {
        if (product === 'EXTRA_NUMBER') {
            await UserModel.updateOne({ _id: userId }, { $inc: { extraNumberSlots: 1 } });
            log.info(`Extra number slot added for user ${userId} (${sessionId})`);
            return;
        }
        if (product === 'WINNER') {
            await applyWinner(userId, sessionId, metadata);
            const from: WinnerFrom = ['CLASSIQUE', 'CIBLE'].includes(metadata?.winnerFrom) ? metadata.winnerFrom : 'NONE';
            const c = WINNER.commissions[from];
            after = async () => {
                await payCommissions(userId, sessionId, currency === 'USD' ? c.usd : c.xaf, currency, 'Pack Winner', 'le Pack Winner', 'WINNER');
                notificationService.exitUserFromRelanceLoop(userId).catch(() => undefined);
                const user = await UserModel.findById(userId).select('email name language').lean() as any;
                if (user?.email) {
                    notificationService.sendAccountActivationEmail({
                        email: user.email, name: user.name || user.email, subscriptionType: 'WINNER',
                        language: (user.language?.[0] as 'fr' | 'en') || 'fr',
                    }).catch(() => undefined);
                }
                const { vcfCacheService } = await import('./vcf-cache.service');
                vcfCacheService.generateVCFFile().catch(() => undefined);
                await emitContactsEvent(userId, 'subscription.activated');
            };
        } else {
            const offer = findAddonOffer(metadata?.offerId) as AddonOffer | undefined;
            if (!offer) throw new Error(`Unknown add-on offer ${metadata?.offerId}`);
            const duration = offer.period === 'yearly' ? SubscriptionDuration.YEARLY : SubscriptionDuration.MONTHLY;
            const { renewed } = await extendFeature(userId, offer.type as SubscriptionType, offer.months, sessionId, duration);
            const l1 = Math.round(addonCommissionBase(offer, currency) * ADDON_COMMISSION_RATE_L1 * 100) / 100;
            after = async () => {
                await payCommissions(userId, sessionId, [l1], currency, offer.name, `l'option ${offer.name}`, offer.type);
                await emitContactsEvent(userId, renewed ? 'subscription.renewed' : 'subscription.activated');
            };
        }
    } catch (err) {
        // Not applied: release the claim so the next delivery of this payment can apply it.
        await ProductPaymentModel.deleteOne({ sessionId }).catch(() => undefined);
        throw err;
    }
    // The product is applied; what follows must not make the callback fail.
    await after().catch(err => log.error(`Post-activation step for ${product} ${sessionId} failed: ${err?.message ?? err}`));
}

// ─── Extra WhatsApp numbers ─────────────────────────────────────────────────

export async function getExtraNumbers(userId: string) {
    const user = await UserModel.findById(userId).select('extraWhatsappNumbers extraNumberSlots').lean() as any;
    if (!user) throw httpError(404, 'Utilisateur introuvable.');
    return {
        slots: user.extraNumberSlots ?? 0,
        numbers: (user.extraWhatsappNumbers ?? []).map((n: any) => ({ _id: String(n._id), number: n.number, addedAt: n.addedAt })),
        pricePerSlot: EXTRA_NUMBER.xaf,
        currency: 'XAF',
    };
}

export async function initiateExtraNumberPurchase(userId: string, paymentMethod: PaymentMethod = 'traditional') {
    const own = ownership(await activeSubs(userId));
    if (!own.member) throw httpError(403, NOT_A_MEMBER);
    const metadata = {
        userId, product: 'EXTRA_NUMBER', offerId: 'EXTRA_NUMBER', planName: 'Numéro WhatsApp supplémentaire',
        paymentMethod, originatingService: 'user-service', callbackPath: callbackPath(), cryptoUsdAmount: EXTRA_NUMBER.usd,
    };
    const intent = await paymentService.createIntent({ userId, amount: EXTRA_NUMBER.xaf, currency: 'XAF', paymentType: 'EXTRA_NUMBER', metadata });
    return { sessionId: intent.sessionId };
}

export async function addExtraNumber(userId: string, raw: string) {
    const number = String(raw ?? '').replace(/\D/g, '');
    if (number.length < 8 || number.length > 15) throw httpError(400, 'Numéro invalide : saisissez-le avec l\'indicatif du pays.');
    const user = await UserModel.findById(userId).select('phoneNumber extraWhatsappNumbers extraNumberSlots').lean() as any;
    if (!user) throw httpError(404, 'Utilisateur introuvable.');
    if (isSamePhoneNumber(user.phoneNumber, number)) throw httpError(400, 'C\'est déjà votre numéro principal.');
    const list: { number: string }[] = user.extraWhatsappNumbers ?? [];
    if (list.some(n => isSamePhoneNumber(n.number, number))) throw httpError(400, 'Ce numéro est déjà ajouté.');
    if (list.length >= (user.extraNumberSlots ?? 0)) throw httpError(400, 'Aucun emplacement libre : achetez un emplacement pour ajouter ce numéro.');

    // Checked again in the write, so two taps cannot both use the last slot.
    const res = await UserModel.updateOne(
        { _id: userId, $expr: { $lt: [{ $size: { $ifNull: ['$extraWhatsappNumbers', []] } }, { $ifNull: ['$extraNumberSlots', 0] }] } },
        { $push: { extraWhatsappNumbers: { number, addedAt: new Date() } } },
    );
    if (!res.modifiedCount) throw httpError(400, 'Aucun emplacement libre : achetez un emplacement pour ajouter ce numéro.');
    return getExtraNumbers(userId);
}

export async function removeExtraNumber(userId: string, numberId: string) {
    if (!Types.ObjectId.isValid(numberId)) throw httpError(400, 'Numéro introuvable.');
    await UserModel.updateOne({ _id: userId }, { $pull: { extraWhatsappNumbers: { _id: new Types.ObjectId(numberId) } } });
    return getExtraNumbers(userId);
}
