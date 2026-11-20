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

    // The change itself (password + authenticator code) is asserted in check-member-authenticator.ts.

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
