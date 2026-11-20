import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import { normalizeCryptoAddress } from '../utils/crypto-wallet';
import { withdrawalLockStatus } from '../utils/withdrawal-lock';

/**
 * Asserts the crypto wallet lock (Security plan Phase 0, same rule as the
 * Mobile Money number): the wallet that receives crypto withdrawals changes
 * only with the password and a code sent to the account email; replacing a
 * wallet locks withdrawals and alerts the account email; the old one-step
 * PUT /users/crypto/wallet cannot change it; addresses that cannot belong to
 * the chosen network are refused.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-crypto-wallet-lock.ts
 */

const DB = process.env.CRYPTO_LOCK_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_crypto_lock_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const sent: any[] = [];
const alerts: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p); return true; };
(notificationService as any).sendAccountEmail = async (p: any) => { alerts.push(p); return true; };
(notificationService as any).sendPush = async () => true;
const lastCode = () => sent[sent.length - 1]?.code as string;
const fresh = async (id: string) => (await UserModel.findById(id).lean()) as any;

const OLD_BSC = '0x52908400098527886E0F7030069857D2E4169EE7';
const NEW_BSC = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const TRX = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- address formats ---
    check('a BSC address is accepted for USDTBSC', normalizeCryptoAddress(NEW_BSC, 'USDTBSC') === NEW_BSC);
    check('a TRON address is refused for USDTBSC', normalizeCryptoAddress(TRX, 'USDTBSC') === null);
    check('a BSC address is refused for TRX', normalizeCryptoAddress(NEW_BSC, 'TRX') === null);
    check('a bech32 BTC address typed in capitals is stored lower-case', normalizeCryptoAddress(BTC.toUpperCase(), 'BTC') === BTC);
    check('an address with a typo character (0 in base58) is refused', normalizeCryptoAddress('T0RabPrwbZy45sbavfcjinPJC18kjpRTv8', 'TRX') === null);

    const u = await UserModel.create({
        name: 'Membre', email: 'owner@gmail.com', phoneNumber: '237677001122', password: 'Secret123!', country: 'CM',
        referralCode: 'CRYP1', cryptoWalletAddress: OLD_BSC, cryptoWalletCurrency: 'USDTBSC',
    } as any);
    const n = await UserModel.create({
        name: 'Nouveau', email: 'newbie@gmail.com', phoneNumber: '237677005566', password: 'Secret123!', country: 'CM', referralCode: 'CRYP2',
    } as any);
    const id = String(u._id);
    const newId = String(n._id);

    // --- old one-step PUT ---
    const samePut = await userService.updateUserCryptoWallet(id, OLD_BSC.toLowerCase(), 'USDTBSC');
    check('PUT with the wallet already saved (any case for 0x) still succeeds', samePut.success === true);
    const viaPut = await refusal(() => userService.updateUserCryptoWallet(id, NEW_BSC, 'USDTBSC'));
    let doc = await fresh(id);
    check('PUT with another address is refused (409 CRYPTO_CHANGE_NEEDS_CODE), nothing saved',
        viaPut?.statusCode === 409 && viaPut?.code === 'CRYPTO_CHANGE_NEEDS_CODE' && doc.cryptoWalletAddress === OLD_BSC, viaPut?.message);
    const curPut = await refusal(() => userService.updateUserCryptoWallet(id, OLD_BSC, 'BNBBSC'));
    check('PUT with the same address on another currency is refused too', curPut?.code === 'CRYPTO_CHANGE_NEEDS_CODE');
    const firstPut = await refusal(() => userService.updateUserCryptoWallet(newId, TRX, 'TRX'));
    check('PUT cannot set a first wallet either', firstPut?.code === 'CRYPTO_CHANGE_NEEDS_CODE');

    // --- request ---
    const wrongNet = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'USDTBSC', password: 'Secret123!' }));
    check('an address of another network is refused, nothing sent', wrongNet?.statusCode === 400 && sent.length === 0, wrongNet?.message);
    const badCur = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'DOGE', password: 'Secret123!' }));
    check('an unsupported currency is refused', badCur?.statusCode === 400);
    const noPass = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC' }));
    check('request without the password is refused, nothing sent', noPass?.statusCode === 400 && sent.length === 0, noPass?.message);
    const badPass = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC', password: 'nope' }));
    check('request with a wrong password is refused, nothing sent', badPass?.statusCode === 400 && sent.length === 0);
    const same = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: OLD_BSC, cryptoWalletCurrency: 'usdtbsc', password: 'Secret123!' }));
    check('requesting the current wallet is refused', same?.statusCode === 400, same?.message);

    const res = await userService.requestCryptoWalletChange(id, { cryptoWalletAddress: ` ${NEW_BSC} `, cryptoWalletCurrency: 'usdtbsc', password: 'Secret123!' });
    const mail = sent[sent.length - 1];
    check('the code goes to the account email, masked in the answer', mail?.recipient === 'owner@gmail.com' && res.sentTo !== 'owner@gmail.com' && res.sentTo.includes('@'), res.sentTo);
    let stored = (await fresh(id)).otps?.find((o: any) => o.purpose === 'changeCrypto');
    check('the code is bound to changeCrypto and to this currency + address', stored?.target === `USDTBSC|${NEW_BSC}`, stored?.target);

    const resend = await userService.requestCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC' });
    check('a resend without password works while a code is live for the same wallet', !!resend.sentTo && sent.length === 2);
    const resendOther = await refusal(() => userService.requestCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'BNBBSC' }));
    check('a resend for another wallet still needs the password', resendOther?.statusCode === 400 && sent.length === 2);

    // --- confirm ---
    const code = lastCode();
    const other = await refusal(() => userService.confirmCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'BNBBSC', code }));
    check('the code does not confirm another wallet', other?.statusCode === 400 && (await fresh(id)).cryptoWalletAddress === OLD_BSC);
    const wrong = await refusal(() => userService.confirmCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC', code: 'ZZZZZZ' }));
    check('a wrong code is refused', wrong?.statusCode === 400 && (await fresh(id)).cryptoWalletAddress === OLD_BSC);

    const done = await userService.confirmCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC', code });
    doc = await fresh(id);
    check('the right code saves the new wallet', doc.cryptoWalletAddress === NEW_BSC && doc.cryptoWalletCurrency === 'USDTBSC');
    const status = withdrawalLockStatus(doc);
    check('replacing a wallet locks withdrawals with reason crypto_change',
        status.locked && status.reason === 'crypto_change' && done.withdrawalsLockedUntil === doc.withdrawalsLockedUntil.toISOString(), status.until);
    const alert = alerts[alerts.length - 1];
    check('the owner is alerted at the account email, with only the end of the address',
        alert?.email === 'owner@gmail.com' && /portefeuille crypto/.test(alert?.subject) && alert?.body.includes(NEW_BSC.slice(-4)) && !alert?.body.includes(NEW_BSC), alert?.subject);
    check('the code is used up', !(doc.otps || []).some((o: any) => o.purpose === 'changeCrypto'));
    const replay = await refusal(() => userService.confirmCryptoWalletChange(id, { cryptoWalletAddress: NEW_BSC, cryptoWalletCurrency: 'USDTBSC', code }));
    check('the same code cannot be used twice', replay?.statusCode === 400);

    // --- first wallet ---
    const alertsBefore = alerts.length;
    await userService.requestCryptoWalletChange(newId, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'TRX', password: 'Secret123!' });
    const first = await userService.confirmCryptoWalletChange(newId, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'TRX', code: lastCode() });
    const nDoc = await fresh(newId);
    check('a first wallet needs the code but locks nothing and sends no alert',
        nDoc.cryptoWalletAddress === TRX && first.withdrawalsLockedUntil === null && !withdrawalLockStatus(nDoc).locked && alerts.length === alertsBefore);

    // --- the MoMo code cannot be used for the wallet ---
    await UserModel.updateOne({ _id: n._id }, { $push: { otps: { code: 'MOMO12', expiration: new Date(Date.now() + 600000), purpose: 'changeMomo', target: `TRX|${TRX}` } } });
    const cross = await refusal(() => userService.confirmCryptoWalletChange(newId, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'TRX', code: 'MOMO12' }));
    check('a code issued for another purpose is refused', cross?.statusCode === 400);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
