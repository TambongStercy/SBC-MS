/**
 * Asserts the claim that guards an admin reversal of a transfer to the activation balance
 * (2026-11-22), against a test database, through the real internal router:
 *   - only this member's own `activation_transfer_in`, completed, never reversed, for at most its
 *     amount, can be claimed; each refusal says why (409 NOT_REVERSIBLE) and changes nothing;
 *   - a claim is one conditional write: ten claims at once → exactly one wins;
 *   - release puts it back only for the same reference;
 *   - admin adjustments of the activation balance are recorded with `balance: activation`.
 *
 *   npx ts-node --transpile-only src/scripts/check-activation-reversal.ts
 */
process.env.MEMBER_AUTHENTICATOR_REQUIRED = 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '59993';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'check-jwt';
process.env.FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY || 'check';
process.env.FEEXPAY_SHOP_ID = process.env.FEEXPAY_SHOP_ID || 'check';
process.env.NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'check';
process.env.NOWPAYMENTS_IPN_SECRET = 'ipn-test-secret';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check-secret';
process.env.MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 'mongodb://127.0.0.1:27017/sbc_unused_test';
process.env.MONGODB_URI_DEV = process.env.MONGODB_URI_DEV || 'mongodb://127.0.0.1:27017/sbc_unused_test';
for (const v of ['USER_SERVICE_URL', 'PAYMENT_SERVICE_URL', 'NOTIFICATION_SERVICE_URL', 'SETTINGS_SERVICE_URL', 'PRODUCT_SERVICE_URL',
    'ADVERTISING_SERVICE_URL', 'TOMBOLA_SERVICE_URL', 'PAYMENT_SERVICE_BASE_URL', 'MONEYFUSION_API_URL', 'CINETPAY_BASE_URL', 'FEEXPAY_BASE_URL']) {
    process.env[v] = process.env[v] || 'http://127.0.0.1:1';
}
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
delete process.env.PAYMENT_SANDBOX_ENABLED;
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { AddressInfo } from 'net';

const DB = process.env.REVERSAL_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_reversal_test';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    if (!/_test$/.test(new URL(DB).pathname.slice(1))) throw new Error('test databases only');
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const { default: TransactionModel, TransactionType, TransactionStatus } = await import('../database/models/transaction.model');
    const app = express();
    app.use(express.json());
    app.use('/api/internal', (await import('../api/routes/internal.routes')).default);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/internal`;
    const post = async (path: string, body: object) => {
        const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_SECRET}` }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() as any };
    };
    const alice = new Types.ObjectId(), bob = new Types.ObjectId();
    const mk = (id: string, over: object = {}) => TransactionModel.create({ transactionId: id, userId: alice, type: TransactionType.ACTIVATION_TRANSFER_IN, amount: 10_000, currency: 'XAF', status: TransactionStatus.COMPLETED, description: 'Transfert', ...over } as any);
    await mk('t-ok');
    await mk('t-bob', { userId: bob });
    await mk('t-dep', { type: TransactionType.DEPOSIT });
    await mk('t-pend', { status: TransactionStatus.PENDING });
    await mk('t-race');
    const claim = (id: string, over: object = {}) => post(`/transactions/${id}/claim-activation-reversal`, { userId: String(alice), amount: 6000, reason: 'Transfert fait par erreur', by: 'admin1', reference: `activation-reversal:${id}`, ...over });

    let r = await claim('t-ok', { amount: 12_000 });
    check('more than the transfer → 409 with the amount', r.status === 409 && r.body.code === 'NOT_REVERSIBLE' && /10000/.test(r.body.message), r.body.message);
    r = await claim('t-bob');
    check('another member’s transfer → 409, untouched', r.status === 409 && /autre membre/.test(r.body.message) && (await TransactionModel.findOne({ transactionId: 't-bob' }).lean() as any).status === 'completed');
    r = await claim('t-dep');
    check('not a transfer to the activation balance → 409', r.status === 409 && /activation/.test(r.body.message));
    r = await claim('t-pend');
    check('not completed → 409', r.status === 409 && /statut/.test(r.body.message));
    r = await claim('nope');
    check('unknown transaction → 404', r.status === 404);
    r = await post('/transactions/t-ok/claim-activation-reversal', { userId: String(alice), amount: 6000 });
    check('reason and reference required → 400', r.status === 400);

    r = await claim('t-ok');
    const t1: any = await TransactionModel.findOne({ transactionId: 't-ok' }).lean();
    check('claimed: RECONCILED with the reference, the reason, who and how much', r.status === 200 && t1.status === 'reconciled' && t1.metadata.reversalRef === 'activation-reversal:t-ok' && t1.metadata.reconciledBy === 'admin1' && t1.metadata.reversedAmount === 6000);
    r = await claim('t-ok');
    check('the same transfer again → 409 already reversed', r.status === 409 && /déjà été annulée/.test(r.body.message));

    r = await post('/transactions/t-ok/release-activation-reversal', { reference: 'activation-reversal:other' });
    check('release with another reference → nothing released', r.body.data.released === false && (await TransactionModel.findOne({ transactionId: 't-ok' }).lean() as any).status === 'reconciled');
    r = await post('/transactions/t-ok/release-activation-reversal', { reference: 'activation-reversal:t-ok', why: 'balance move failed' });
    const t2: any = await TransactionModel.findOne({ transactionId: 't-ok' }).lean();
    check('release with its reference → back to completed, the attempt noted', r.body.data.released === true && t2.status === 'completed' && !t2.metadata.reversalRef && t2.metadata.reversalReleaseWhy === 'balance move failed');

    const results = await Promise.all(Array.from({ length: 10 }, () => claim('t-race')));
    check('ten claims at once → exactly one wins', results.filter(x => x.status === 200).length === 1 && results.filter(x => x.status === 409).length === 9);

    r = await post('/adjustment-transaction', { userId: String(alice), amount: -500, reason: 'Correction du solde d’activation', adminId: 'admin1', reference: 'admin-adjust-activation:1', status: 'pending', balance: 'activation' });
    await post('/adjustment-transaction', { userId: String(alice), amount: -500, reason: 'x', adminId: 'admin1', reference: 'admin-adjust-activation:1', status: 'completed', balance: 'activation' });
    const adj: any = await TransactionModel.findOne({ 'metadata.adjustmentRef': 'admin-adjust-activation:1' }).lean();
    check('activation adjustment recorded, marked activation, closed once', adj?.metadata.balance === 'activation' && /d’activation/.test(adj.description) && adj.status === 'completed');

    srv.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
