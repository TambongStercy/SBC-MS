/**
 * Asserts Security plan Phase 10 (payment conversion), first part:
 * reuse of an open payment and the 5-per-10-min limit, no re-submit of a paid
 * payment, the reconciler's 72 h expiry, and the conversion figures/failure
 * list the admin dashboard reads.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-payment-conversion.ts
 */
export {};

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3003';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 'mongodb://127.0.0.1:27017/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'check';
process.env.FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY || 'check';
process.env.FEEXPAY_SHOP_ID = process.env.FEEXPAY_SHOP_ID || 'check';
process.env.MONEYFUSION_API_URL = process.env.MONEYFUSION_API_URL || 'http://localhost/unused';
process.env.NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'check';
process.env.PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL || 'http://localhost:3003';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check';
process.env.USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost/unused';
process.env.ADVERTISING_SERVICE_URL = process.env.ADVERTISING_SERVICE_URL || 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = process.env.TOMBOLA_SERVICE_URL || 'http://localhost/unused';
process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost/unused';
process.env.PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost/unused';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };
const DB = process.env.CONVERSION_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_conversion_check';

const main = async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const paymentService = (await import('../services/payment.service')).default;
    const PI = (await import('../database/models/PaymentIntent')).default;
    const { PaymentStatus } = await import('../database/interfaces/IPaymentIntent');
    const { payinReconciler } = await import('../jobs/payin-reconciler.job');
    const { conversionSummary, failureList } = await import('../services/payment-conversion.service');
    await PI.syncIndexes();

    const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const base = { userId: U, amount: 2070, currency: 'XAF', paymentType: 'SUBSCRIPTION', metadata: { originatingService: 'user-service', callbackPath: 'http://x/subscriptions/webhooks/payment-confirmation', planType: 'CLASSIQUE', planId: 'CLASSIQUE' } };

    // --- reuse ---
    const a = await paymentService.createPaymentIntent(base as any);
    const b = await paymentService.createPaymentIntent({ ...base, metadata: { planId: 'CLASSIQUE', planType: 'CLASSIQUE', callbackPath: base.metadata.callbackPath, originatingService: 'user-service' } } as any);
    check('the same payment tapped again (metadata in another order) reuses the open one', a.sessionId === b.sessionId && await PI.countDocuments() === 1);
    const c = await paymentService.createPaymentIntent({ ...base, amount: 5220, metadata: { ...base.metadata, planType: 'CIBLE', planId: 'CIBLE' } } as any);
    check('a different payment gets its own record', c.sessionId !== a.sessionId);
    await PI.updateOne({ sessionId: a.sessionId }, { $set: { gateway: 'moneyfusion', status: PaymentStatus.PENDING_PROVIDER } });
    const d = await paymentService.createPaymentIntent(base as any);
    check('once a method was chosen, a new tap creates a new payment', d.sessionId !== a.sessionId);
    const e = await paymentService.createPaymentIntent({ ...base, amount: 4100, metadata: { ...base.metadata, clientSource: 'app' } } as any);
    const f = await paymentService.createPaymentIntent({ ...base, amount: 4100, metadata: { ...base.metadata, clientSource: 'web' } } as any);
    check('web/app split: source stored, not part of "the same payment"', e.sessionId === f.sessionId && (e as any).metadata?.clientSource === 'app' && (d as any).metadata?.clientSource === 'unknown');
    await PI.deleteOne({ sessionId: e.sessionId });

    // --- limit ---
    for (let i = 0; i < 2; i++) await paymentService.createPaymentIntent({ ...base, amount: 100 + i } as any);
    const over = await refusal(() => paymentService.createPaymentIntent({ ...base, amount: 999 } as any));
    check('a 6th new payment in 10 minutes is refused (429)', over?.statusCode === 429, over?.message);
    const reused = await refusal(() => paymentService.createPaymentIntent({ ...base, amount: 100 } as any));
    check('reusing an open one is still allowed at the limit', reused === null);
    const admin = await paymentService.createPaymentIntent({ ...base, amount: 777 } as any, { reuseAndLimit: false });
    check('admin manual intents skip the limit', !!admin.sessionId);

    // --- no re-submit of a paid payment ---
    await PI.updateOne({ sessionId: c.sessionId }, { $set: { status: PaymentStatus.SUCCEEDED, gateway: 'feexpay' } });
    const resubmit = await refusal(() => paymentService.submitPaymentDetails(c.sessionId, { countryCode: 'BJ', paymentCurrency: 'XOF', phoneNumber: '97000000', operator: 'mtn' }));
    check('a paid payment cannot be sent to a provider again (409)', resubmit?.statusCode === 409, resubmit?.message);
    check('…and stays paid', (await PI.findOne({ sessionId: c.sessionId }).lean())!.status === PaymentStatus.SUCCEEDED);

    // --- 72 h expiry ---
    const old = new Date(Date.now() - 73 * 3600_000);
    const mk = (attempts: number, status = PaymentStatus.PENDING_PROVIDER) => PI.collection.insertOne({ sessionId: `old${attempts}-${status === PaymentStatus.SUCCEEDED ? 'paid' : 'wait'}`, userId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 1000, currency: 'XAF', status, gateway: 'moneyfusion', gatewayPaymentId: `tok${attempts}-${status}`, reconcileAttempts: attempts, metadata: {}, createdAt: old, updatedAt: old } as any);
    await mk(4); await mk(0); await mk(4, PaymentStatus.SUCCEEDED);
    await PI.collection.insertOne({ sessionId: 'young', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 1000, currency: 'XAF', status: PaymentStatus.PENDING_PROVIDER, gateway: 'moneyfusion', gatewayPaymentId: 'tokyoung', reconcileAttempts: 9, metadata: {}, createdAt: new Date(Date.now() - 70 * 3600_000), updatedAt: new Date() } as any);
    const n = await (payinReconciler as any).expireStale(Date.now());
    const s4 = (await PI.findOne({ sessionId: 'old4-wait' }).lean()) as any;
    check('a payment still waiting after 72 h, asked at least once, is expired with a reason',
        n === 1 && s4.status === PaymentStatus.EXPIRED && s4.failure?.code === 'no_final_answer_72h', `${n} ${s4?.status}`);
    check('never answered, younger than 72 h, or already paid: left alone',
        (await PI.findOne({ sessionId: 'old0-wait' }).lean() as any).status === PaymentStatus.PENDING_PROVIDER
        && (await PI.findOne({ sessionId: 'young' }).lean() as any).status === PaymentStatus.PENDING_PROVIDER
        && (await PI.findOne({ sessionId: 'old4-paid' }).lean() as any).status === PaymentStatus.SUCCEEDED);

    // --- figures ---
    await PI.deleteMany({});
    const now = new Date();
    const doc = (o: any) => ({ sessionId: Math.random().toString(36).slice(2), amount: 2070, currency: 'XAF', gateway: 'none', status: PaymentStatus.PENDING_USER_INPUT, metadata: { planType: 'CLASSIQUE' }, createdAt: now, updatedAt: now, ...o });
    await PI.collection.insertMany([
        doc({ userId: 'u1' }),
        doc({ userId: 'u1', metadata: { planType: 'CLASSIQUE', pageOpenedAt: now } }),
        doc({ userId: 'u1', countryCode: 'CM', gateway: 'moneyfusion', gatewayPaymentId: 't1', status: PaymentStatus.SUCCEEDED, metadata: { planType: 'CLASSIQUE', pageOpenedAt: now, creditedAt: now }, updatedAt: new Date(now.getTime() + 120_000) }),
        doc({ userId: 'u2', countryCode: 'BJ', gateway: 'feexpay', gatewayPaymentId: 't2', status: PaymentStatus.FAILED, failure: { group: 'member', code: 'low_balance', providerMessage: 'Solde insuffisant', at: now, step: 'provider_result' } }),
        doc({ userId: 'u3', countryCode: 'CM', gateway: 'moneyfusion', status: PaymentStatus.ERROR, failure: { group: 'sbc_code', code: 'exception', at: now, step: 'initiate' } }),
        doc({ userId: 'u4', countryCode: 'CD', gateway: 'moneyfusion', status: PaymentStatus.FAILED }),
        doc({ userId: 'u5', metadata: { callbackPath: 'http://n/api/relance/internal/credit-pack' } }),
    ] as any);
    const sum: any = await conversionSummary({});
    const t = sum.totals;
    check('totals: attempts, page opened, method chosen, provider reached, paid, failed, credited',
        t.attempts === 7 && t.opened === 2 && t.chosen === 4 && t.reached === 2 && t.succeeded === 1 && t.failed === 3 && t.credited === 1, JSON.stringify(t));
    check('member conversion (1 of 5) and attempt conversion (1 of 7)', t.members === 5 && t.payingMembers === 1 && t.memberConversion === 20 && t.attemptConversion === 14.3, `${t.memberConversion} ${t.attemptConversion}`);
    const mf = sum.byGateway.find((g: any) => g.gateway === 'moneyfusion');
    check('per provider', mf?.attempts === 3 && mf.succeeded === 1 && mf.successRate === 33.3);
    check('per country, unknown country counted as "none"', sum.byCountry.find((x: any) => x.country === 'none')?.attempts === 3);
    check('what was being paid', sum.byProduct.find((x: any) => x.product === 'relance')?.attempts === 1 && sum.byProduct.find((x: any) => x.product === 'abonnement-classique')?.attempts === 6);
    check('failure groups, unrecorded ones as unknown', sum.failureGroups.member === 1 && sum.failureGroups.sbc_code === 1 && sum.failureGroups.unknown === 1, JSON.stringify(sum.failureGroups));
    check('time to success', sum.medianSecondsToSuccess === 120);
    check('web/app split: payments without a source counted as unknown', sum.bySource.length === 1 && sum.bySource[0].source === 'unknown' && sum.bySource[0].attempts === 7, JSON.stringify(sum.bySource));

    const p1: any = await failureList({ limit: 2 });
    const p2: any = await failureList({ limit: 2, cursor: p1.nextCursor });
    check('failure list pages with a cursor, no overlap', p1.items.length === 2 && p2.items.length === 1 && !p2.nextCursor && !p2.items.some((x: any) => p1.items.find((y: any) => y.sessionId === x.sessionId)));
    const onlyMember: any = await failureList({ group: 'member' });
    check('filtered by group', onlyMember.items.length === 1 && onlyMember.items[0].code === 'low_balance' && onlyMember.items[0].message === 'Solde insuffisant');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
