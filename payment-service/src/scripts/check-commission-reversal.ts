/**
 * Asserts the commission reversal (support approval `commission_reversal`, 2026-11-23), against a
 * test database, through the real support router (/api/internal/support), with user-service's
 * wallet replaced by an in-memory one that behaves like it (debit only from available money,
 * one movement per {reference, direction}):
 *   - preview: a commission of this member, reversible; another member's → 404;
 *   - reverse: deposit COMPLETED → RECONCILED, wallet −amount once under commission-reversal:<tx>,
 *     one commission_reversal transaction; the same call again → already_reversed, nothing moves;
 *   - ten reversals at once (same approval) → the wallet moves once;
 *   - a deposit that is not a commission, another member's, a pending one → 409 NOT_REVERSIBLE;
 *   - not enough available money → 409 INSUFFICIENT_AVAILABLE_BALANCE, nothing debited, the
 *     commission back to COMPLETED (asked again later, it can succeed);
 *   - user-service down after the claim → 503, claim kept; the same approval resumes and finishes,
 *     another approval is refused;
 *   - USD commissions are taken from the USD balance; no actor header → 400.
 *
 *   npx ts-node --transpile-only src/scripts/check-commission-reversal.ts
 */
process.env.MEMBER_AUTHENTICATOR_REQUIRED = 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '59994';
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

const DB = process.env.COMMISSION_REVERSAL_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_commission_reversal_test';
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
    const { userServiceClient } = await import('../services/clients/user.service.client');
    const { AppError } = await import('../utils/errors');
    await TransactionModel.syncIndexes();

    // In-memory wallet with user-service's rules.
    const wallet = new Map<string, { xaf: number; usd: number; reserved: number }>();
    const moves = new Map<string, { reference: string; direction: string; amount: number; currency: string }>();
    let down = false;
    let debitCalls = 0;
    const move = async (userId: string, amount: number, movement: any, usd: boolean) => {
        if (down) throw new AppError('Failed to communicate with user service for balance update.', 503);
        debitCalls++;
        const key = `${movement.reference}:${amount < 0 ? 'DEBIT' : 'CREDIT'}`;
        if (moves.has(key)) return; // replay: no-op success
        const w = wallet.get(userId);
        if (!w) throw new AppError('User not found', 404);
        const avail = usd ? w.usd : w.xaf - w.reserved;
        if (amount < 0 && avail < -amount) throw new AppError('Solde disponible insuffisant.', 409);
        if (usd) w.usd += amount; else w.xaf += amount;
        moves.set(key, { reference: movement.reference, direction: amount < 0 ? 'DEBIT' : 'CREDIT', amount: Math.abs(amount), currency: usd ? 'USD' : 'XAF' });
    };
    (userServiceClient as any).updateUserBalance = (u: string, a: number, m: any) => move(u, a, m, false);
    (userServiceClient as any).updateUserUsdBalance = (u: string, a: number, m: any) => move(u, a, m, true);
    (userServiceClient as any).lookupWalletMovements = async (refs: string[]) => [...moves.values()].filter(m => refs.includes(m.reference));
    (userServiceClient as any).getAvailableBalance = async (u: string) => {
        const w = wallet.get(u)!;
        return { balance: w.xaf, debt: 0, reservedBalance: w.reserved, available: w.xaf - w.reserved, usdBalance: w.usd, reservedUsdBalance: 0, availableUsd: w.usd };
    };

    const app = express();
    app.use(express.json());
    app.use('/api/internal/support', (await import('../api/routes/support.routes')).default);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/internal/support`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_SECRET}`, 'x-support-actor': 'agent:Fin Manager' };
    const post = async (path: string, body: object, h: Record<string, string> = headers) => {
        const r = await fetch(`${base}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() as any };
    };
    const get = async (path: string) => {
        const r = await fetch(`${base}${path}`, { headers });
        return { status: r.status, body: await r.json() as any };
    };

    const alice = new Types.ObjectId(), bob = new Types.ObjectId();
    wallet.set(String(alice), { xaf: 10_000, usd: 20, reserved: 0 });
    wallet.set(String(bob), { xaf: 300, usd: 0, reserved: 0 });
    const mk = (id: string, over: object = {}) => TransactionModel.create({
        transactionId: id, userId: alice, type: TransactionType.DEPOSIT, amount: 2500, currency: 'XAF', status: TransactionStatus.COMPLETED,
        description: 'Commission', paymentProvider: { provider: 'internal', transactionId: id, status: 'completed', metadata: { commissionLevel: 1, sourceUserId: String(bob) } }, ...over,
    } as any);
    await mk('c-ok');
    await mk('c-ten');
    await mk('c-bob', { userId: bob, amount: 1000 });
    await mk('c-dep', { paymentProvider: { provider: 'mf', transactionId: 'x', status: 'completed', metadata: {} } });
    await mk('c-pend', { status: TransactionStatus.PENDING });
    await mk('c-down', { amount: 500 });
    await mk('c-usd', { amount: 5, currency: 'USD' });
    const tx = async (id: string) => (await TransactionModel.findOne({ transactionId: id }).lean()) as any;
    const A = () => wallet.get(String(alice))!;

    // preview
    const p1 = await get(`/commissions/c-ok?userId=${alice}`);
    const p2 = await get(`/commissions/c-ok?userId=${bob}`);
    check('preview: a reversible commission of this member; another member gets 404',
        p1.status === 200 && p1.body.data.isCommission && p1.body.data.reversible && p1.body.data.level === 1 && p2.status === 404);

    // reverse
    const r1 = await post('/commissions/c-ok/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-1' });
    const t1 = await tx('c-ok');
    const rec = await TransactionModel.find({ type: TransactionType.COMMISSION_REVERSAL }).lean();
    check('reverse: commission RECONCILED, wallet −2500 once, one commission_reversal record',
        r1.status === 200 && r1.body.data.status === 'reversed' && t1.status === TransactionStatus.RECONCILED && !!t1.metadata.reversalDoneAt
        && A().xaf === 7500 && moves.has('commission-reversal:c-ok:DEBIT') && rec.length === 1 && rec[0].amount === 2500,
        JSON.stringify({ s: r1.status, b: r1.body, xaf: A().xaf }));
    const r2 = await post('/commissions/c-ok/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-1' });
    check('the same call again: already_reversed, nothing moves, still one record',
        r2.status === 200 && r2.body.data.status === 'already_reversed' && A().xaf === 7500
        && (await TransactionModel.countDocuments({ type: TransactionType.COMMISSION_REVERSAL })) === 1);
    const r2b = await post('/commissions/c-ok/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-other' });
    check('another approval on a reversed commission: already reversed, nothing moves', r2b.status === 200 && r2b.body.data.status === 'already_reversed' && A().xaf === 7500);

    // concurrency
    const ten = await Promise.all(Array.from({ length: 10 }, () => post('/commissions/c-ten/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-ten' })));
    check('ten reversals at once: the wallet moves once, one record', A().xaf === 5000 && ten.every(r => r.status === 200)
        && (await TransactionModel.countDocuments({ type: TransactionType.COMMISSION_REVERSAL, 'metadata.reversalOf': 'c-ten' })) === 1,
        JSON.stringify(ten.map(r => r.status)));

    // refusals
    const nb = await post('/commissions/c-bob/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-2' });
    const nd = await post('/commissions/c-dep/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-3' });
    const np = await post('/commissions/c-pend/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-4' });
    check('another member’s, not a commission, pending → 409 NOT_REVERSIBLE, nothing moved',
        [nb, nd, np].every(r => r.status === 409 && r.body.code === 'NOT_REVERSIBLE') && /autre membre/.test(nb.body.message)
        && /pas une commission/.test(nd.body.message) && A().xaf === 5000 && (await tx('c-pend')).status === TransactionStatus.PENDING);
    const noActor = await post('/commissions/c-down/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'x' },
        { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SERVICE_SECRET}` });
    check('no x-support-actor → 400', noActor.status === 400 && noActor.body.code === 'ACTOR_REQUIRED');

    // not enough available money (bob spent it)
    const ni = await post('/commissions/c-bob/reverse', { userId: String(bob), reason: 'Commission versée par erreur', approvalId: 'appr-5' });
    const tb = await tx('c-bob');
    check('not enough available money → 409 INSUFFICIENT_AVAILABLE_BALANCE, nothing debited, back to COMPLETED',
        ni.status === 409 && ni.body.code === 'INSUFFICIENT_AVAILABLE_BALANCE' && /disponible : 300/.test(ni.body.message)
        && wallet.get(String(bob))!.xaf === 300 && tb.status === TransactionStatus.COMPLETED && !tb.metadata?.reversalRef
        && tb.metadata?.reversalAttempts?.length === 1, ni.body.message);
    wallet.get(String(bob))!.xaf = 1500;
    const nOk = await post('/commissions/c-bob/reverse', { userId: String(bob), reason: 'Commission versée par erreur', approvalId: 'appr-6' });
    check('asked again once the money is there: reversed', nOk.status === 200 && wallet.get(String(bob))!.xaf === 500);

    // reserved money is not available
    A().reserved = 4800;
    const nr = await post('/commissions/c-down/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-r' });
    check('money held by a withdrawal in flight is not taken (409)', nr.status === 409 && A().xaf === 5000);
    A().reserved = 0;

    // user-service down after the claim
    down = true;
    const d1 = await post('/commissions/c-down/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-7' });
    const td = await tx('c-down');
    check('user-service down → 503, claim kept (RECONCILED, approval recorded)', d1.status === 503 && td.status === TransactionStatus.RECONCILED
        && td.metadata.reversalApprovalId === 'appr-7' && !td.metadata.reversalDoneAt && A().xaf === 5000);
    down = false;
    const dOther = await post('/commissions/c-down/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-8' });
    const d2 = await post('/commissions/c-down/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-7' });
    check('another approval refused meanwhile; the same approval resumes and finishes once',
        dOther.status === 409 && d2.status === 200 && d2.body.data.status === 'reversed' && A().xaf === 4500 && !!(await tx('c-down')).metadata.reversalDoneAt);

    // USD
    const u = await post('/commissions/c-usd/reverse', { userId: String(alice), reason: 'Commission versée par erreur', approvalId: 'appr-9' });
    check('a USD commission is taken from the USD balance', u.status === 200 && A().usd === 15 && A().xaf === 4500 && moves.get('commission-reversal:c-usd:DEBIT')?.currency === 'USD');
    check('debits were only ever asked with the reversal reference', [...moves.keys()].every(k => k.startsWith('commission-reversal:')) && debitCalls > 0);

    srv.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
