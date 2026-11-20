/**
 * Asserts that an approved crypto withdrawal is paid only to the wallet the
 * member asked to be paid on (the address recorded on the transaction when
 * it was requested). A wallet changed in between (Security plan Phase 0:
 * changes need a code and lock withdrawals 48 h) must not receive it.
 *
 * No database: the user service, NOWPayments and the transaction writes are
 * stubbed.
 *
 *   npx ts-node src/scripts/check-crypto-payout-wallet.ts
 */

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

const REQUESTED = '0x52908400098527886E0F7030069857D2E4169EE7';
const OTHER = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';

let wallet = { cryptoWalletAddress: REQUESTED, cryptoWalletCurrency: 'USDTBSC' };
const payouts: any[] = [];
const updates: any[] = [];
const tx = (metadata: any) => ({ _id: 't1', transactionId: 'TX1', userId: 'u1', amount: 50, fee: 2, metadata });

const main = async () => {
    // Imported here: the env above must be set before config loads.
    const paymentService = (await import('../services/payment.service')).default;
    const nowPaymentsService = (await import('../services/nowpayments.service')).default;
    const { userServiceClient } = await import('../services/clients/user.service.client');
    const transactionRepository = (await import('../database/repositories/transaction.repository')).default;
    (userServiceClient as any).getUserDetails = async () => ({ _id: 'u1', ...wallet });
    (nowPaymentsService as any).createPayout = async (p: any) => { payouts.push(p); return { id: `po_${payouts.length}` }; };
    (transactionRepository as any).update = async (_id: any, u: any) => { updates.push(u); return u; };
    // Support phase 2: status changes go through withdrawal-lifecycle (one conditional write)
    // and the payout reference is written with named keys; record them instead of a database.
    const TransactionModel = (await import('../database/models/transaction.model')).default;
    (TransactionModel as any).updateOne = async (_f: any, u: any) => { updates.push(u.$set ?? u); return { modifiedCount: 1 }; };
    (TransactionModel as any).findOneAndUpdate = (_f: any, u: any) => {
        updates.push(u.$set ?? u);
        return { lean: () => ({ exec: async () => ({ transactionId: 'TX1', metadata: {}, ...(u.$set ?? {}) }) }) };
    };
    (userServiceClient as any).releaseWithdrawalFunds = async () => 'released';
    const pay = async (t: any) => { try { await (paymentService as any).processCryptoWithdrawalPayout(t); return null; } catch (e: any) { return e; } };

    let err = await pay(tx({ cryptoAddress: REQUESTED.toLowerCase(), cryptoCurrency: 'USDTBSC' }));
    check('same wallet as requested (0x in another case): paid to it', !err && payouts.length === 1 && payouts[0].address === REQUESTED, err?.message);

    wallet = { cryptoWalletAddress: OTHER, cryptoWalletCurrency: 'USDTBSC' };
    err = await pay(tx({ cryptoAddress: REQUESTED, cryptoCurrency: 'USDTBSC' }));
    check('wallet changed since the request: no payout, transaction failed', !!err && payouts.length === 1 && updates.slice(-3).some(u => u?.status === 'failed'), err?.message);

    wallet = { cryptoWalletAddress: REQUESTED, cryptoWalletCurrency: 'BNBBSC' };
    err = await pay(tx({ cryptoAddress: REQUESTED, cryptoCurrency: 'USDTBSC' }));
    check('currency changed since the request: no payout', !!err && payouts.length === 1);

    wallet = { cryptoWalletAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', cryptoWalletCurrency: 'TRX' };
    err = await pay(tx({ cryptoAddress: 'tjrabprwbzy45sbavfcjinpjc18kjprtv8', cryptoCurrency: 'TRX' }));
    check('base58 addresses compare with case (a case change is another address)', !!err && payouts.length === 1);

    err = await pay(tx({}));
    check('an old transaction without a recorded address is still paid to the current wallet', !err && payouts.length === 2);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
