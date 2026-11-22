/**
 * Asserts the guards on the admin actions that create or move a member's money (2026-11-22):
 *   - both routes need the admin's own code (step-up): a token without an admin session is refused,
 *     the code is removed from the body, the kill switch works;
 *   - adjust-balance: a real reason (≥ 10 characters), no zero amount; activation-balance
 *     adjustments are recorded (pending → completed / failed, `balance: activation`); two debits
 *     at once never take the activation balance below zero;
 *   - reversal of a transfer to the activation balance: the cited transfer is claimed in
 *     payment-service first (refused → nothing moves); the balance moves under
 *     `activation-reversal:<transfer>`, so even a second claim cannot move it twice (the claim
 *     is then released); a failed move releases the claim.
 * payment-service is stubbed. Its own database; dropped before and after.
 *
 *   npx ts-node --transpile-only src/scripts/check-admin-balance-guard.ts
 */
import mongoose, { Types } from 'mongoose';

const DB = process.env.SUPPORT_USERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_balance_guard_test';
if (!/_test$/.test(new URL(DB).pathname.slice(1))) { console.error('test databases only'); process.exit(2); }
delete process.env.SUPPORT_SERVICE_URL;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const main = async () => {
    const { default: UserModel } = await import('../database/models/user.model');
    const { default: WalletMovementModel } = await import('../database/models/wallet-movement.model');
    const { paymentService } = await import('../services/clients/payment.service.client');
    const { userService } = await import('../services/user.service');
    const { activationBalanceService } = await import('../services/activation-balance.service');
    const { requireAdminStepUp } = await import('../api/middleware/admin-step-up.middleware');
    const { AppError } = await import('../utils/errors');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await WalletMovementModel.syncIndexes();
    const user = async (fields: Record<string, unknown>) => {
        const _id = new Types.ObjectId();
        await UserModel.collection.insertOne({ _id, name: 'Membre test', email: `${_id}@test.local`, phoneNumber: `2376${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, referralCode: `t${_id}`, balance: 0, usdBalance: 0, debt: 0, activationBalance: 0, ...fields });
        return _id;
    };
    const doc = async (id: Types.ObjectId) => (await UserModel.collection.findOne({ _id: id })) as any;
    const admin = new Types.ObjectId();

    // ---- step-up middleware ----
    const asked: any[] = [];
    const fakeStepUp: any = async (input: any) => { asked.push(input); if (input.code === '123456') return { until: 'x', method: 'totp' }; throw Object.assign(new AppError('Confirmez avec le code de votre application d’authentification.', 403), { code: 'ADMIN_CODE_REQUIRED' }); };
    const run = async (req: any) => {
        let status = 0, body: any = null, passed = false;
        const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { body = b; return res; } };
        await requireAdminStepUp('balance_adjust', fakeStepUp)(req, res, () => { passed = true; });
        return { status, body, passed };
    };
    let m = await run({ user: { userId: String(admin), role: 'admin' }, body: { amount: 5, adminCode: '123456' }, headers: {} });
    check('token without an admin session (no asid) → 403, step-up not even asked', m.status === 403 && m.body.code === 'ADMIN_CODE_REQUIRED' && asked.length === 0);
    const reqOk: any = { user: { userId: String(admin), asid: 'sess1', role: 'admin' }, body: { amount: 5, reason: 'x', adminCode: '123456' }, headers: {} };
    m = await run(reqOk);
    check('admin session + good code → passes, the code removed from the body', m.passed && !('adminCode' in reqOk.body) && asked[0].sid === 'sess1' && asked[0].action === 'balance_adjust');
    m = await run({ user: { userId: String(admin), asid: 'sess1' }, body: {}, headers: {} });
    check('no code (no window) → 403 ADMIN_CODE_REQUIRED', m.status === 403 && m.body.code === 'ADMIN_CODE_REQUIRED' && !m.passed);
    process.env.ADMIN_STEPUP_REQUIRED = 'false';
    m = await run({ user: {}, body: {}, headers: {} });
    check('ADMIN_STEPUP_REQUIRED=false → passes', m.passed);
    delete process.env.ADMIN_STEPUP_REQUIRED;

    // ---- adjust-balance ----
    const recorded: any[] = [];
    (paymentService as any).recordAdjustmentTransaction = async (p: any) => { recorded.push(p); return { transactionId: 'adj' }; };
    const u1 = await user({ balance: 1000, activationBalance: 100 });
    let e = await refusal(() => userService.adminAdjustBalance(u1, 500, 'ok', admin, 'main'));
    check('reason under 10 characters → refused, nothing recorded', /at least 10/.test(e?.message ?? '') && recorded.length === 0 && (await doc(u1)).balance === 1000);
    e = await refusal(() => userService.adminAdjustBalance(u1, 0, 'Correction du solde', admin, 'main'));
    check('zero amount → refused', /Invalid amount/.test(e?.message ?? ''));
    const nb = await userService.adminAdjustBalance(u1, 50, 'Bonus de parrainage oublié', admin, 'activation');
    check('activation adjustment applied and recorded (pending → completed, balance: activation)', nb === 150 && recorded.map(r => `${r.status}:${r.balance}`).join() === 'pending:activation,completed:activation');
    recorded.length = 0;
    const two = await Promise.all([1, 2].map(() => refusal(() => userService.adminAdjustBalance(u1, -100, 'Retrait d’un bonus en double', admin, 'activation'))));
    check('two debits of 100 at once on 150 → one applied, one refused, never below zero', two.filter(x => x === null).length === 1 && (await doc(u1)).activationBalance === 50, `${(await doc(u1)).activationBalance}`);
    check('…and the refused one is recorded as failed', recorded.filter(r => r.status === 'failed').length === 1 && recorded.filter(r => r.status === 'completed').length === 1);
    (paymentService as any).recordAdjustmentTransaction = async () => { throw new Error('payment-service down'); };
    e = await refusal(() => userService.adminAdjustBalance(u1, 10, 'Correction du solde', admin, 'activation'));
    check('payment-service cannot record it → no activation adjustment', !!e && (await doc(u1)).activationBalance === 50);
    (paymentService as any).recordAdjustmentTransaction = async (p: any) => { recorded.push(p); return { transactionId: 'adj' }; };

    // ---- reversal of a transfer to the activation balance ----
    const claims = new Set<string>();
    let permissive = false;
    const released: string[] = [];
    (paymentService as any).claimActivationReversal = async (id: string, p: any) => {
        if (id === 'bob-transfer') throw new AppError('Cette transaction ne peut pas être annulée : elle appartient à un autre membre.', 409);
        if (claims.has(id) && !permissive) throw new AppError('Cette transaction ne peut pas être annulée : elle a déjà été annulée.', 409);
        claims.add(id);
        return { amount: p.amount };
    };
    (paymentService as any).releaseActivationReversal = async (id: string) => { released.push(id); claims.delete(id); };
    (paymentService as any).recordActivationTransaction = async () => ({ transactionId: 'rev' });
    const u2 = await user({ balance: 0, activationBalance: 10_000 });
    e = await refusal(() => activationBalanceService.cancelActivationTransfer(String(u2), 't1', 4000, 'court', String(admin)));
    check('reason under 10 characters → 400', e?.statusCode === 400);
    e = await refusal(() => activationBalanceService.cancelActivationTransfer(String(u2), 'bob-transfer', 4000, 'Transfert fait par erreur', String(admin)));
    check('claim refused (another member’s transfer) → 409, nothing moved', e?.statusCode === 409 && (await doc(u2)).balance === 0 && (await doc(u2)).activationBalance === 10_000);
    const ok1 = await activationBalanceService.cancelActivationTransfer(String(u2), 't1', 4000, 'Transfert fait par erreur', String(admin));
    const mv = await WalletMovementModel.findOne({ reference: 'activation-reversal:t1' }).lean() as any;
    check('claimed → balances moved once, ledger reference activation-reversal:t1', ok1.newBalance === 4000 && ok1.newActivationBalance === 6000 && mv?.amount === 4000);
    e = await refusal(() => activationBalanceService.cancelActivationTransfer(String(u2), 't1', 4000, 'Transfert fait par erreur', String(admin)));
    check('the same transfer again → refused by the claim, nothing moved', e?.statusCode === 409 && (await doc(u2)).balance === 4000);
    permissive = true; // as if a claim had been granted twice
    e = await refusal(() => activationBalanceService.cancelActivationTransfer(String(u2), 't1', 4000, 'Transfert fait par erreur', String(admin)));
    check('even with a second claim, the ledger reference stops a second move; the claim is released', e?.statusCode === 409 && (await doc(u2)).balance === 4000 && (await doc(u2)).activationBalance === 6000 && released.includes('t1'));
    permissive = false;
    e = await refusal(() => activationBalanceService.cancelActivationTransfer(String(u2), 't2', 50_000, 'Transfert fait par erreur', String(admin)));
    check('more than the activation balance → refused before any claim', e?.statusCode === 400 && !claims.has('t2'));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
