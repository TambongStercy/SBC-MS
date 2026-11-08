import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { recordConsents, exportUserData, deleteOwnAccount } from '../services/privacy.service';
import { PRIVACY_POLICY_VERSION } from '../config/privacy';

/**
 * Asserts the APDP (Benin) data-protection routes: consent recording, the
 * member's data download (no secrets), and deleting one's own account.
 *   npx ts-node src/scripts/check-privacy.ts   (needs a local Mongo)
 */
const DB = process.env.PRIVACY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_privacy_check';
let failures = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

(async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const u = await UserModel.create({
        name: 'Test', email: 't@x.test', phoneNumber: '237677000099', region: 'Centre', country: 'CM',
        password: 'Secret-123', otps: [{ code: 'ABC123', expiration: new Date() }],
    } as any);
    const id = u._id.toString();

    check('consent refused unless both accords are given', (await refusal(() => recordConsents(id, { privacy: true })))?.status === 400);
    const c = await recordConsents(id, { privacy: true, dataTransfer: true }, '1.2.3.4');
    check('both consents recorded with date, version and IP',
        c.consents?.privacy?.version === PRIVACY_POLICY_VERSION && !!c.consents?.dataTransfer?.acceptedAt && c.consents?.privacy?.ip === '1.2.3.4');

    const data = await exportUserData(id);
    const text = JSON.stringify(data);
    check('export has the profile and consents', data.profile.email === 't@x.test' && !!data.profile.consents);
    check('export never contains the password or codes', !('password' in data.profile) && !('otps' in data.profile) && !text.includes('ABC123'));

    check('deletion refused with a wrong password', (await refusal(() => deleteOwnAccount(id, 'nope')))?.status === 400);
    await deleteOwnAccount(id, 'Secret-123');
    const raw = await mongoose.connection.collection('users').findOne({ _id: u._id });
    check('account deleted: hidden, out of the contacts file', raw?.deleted === true && raw?.deletionReason === 'member_request' && raw?.shareContactInfo === false);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
})().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
