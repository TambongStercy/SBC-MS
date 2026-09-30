/**
 * Asserts an SSO client reaches the contacts API only as the user who authorised
 * it, and only as far as that user's own entitlements go.
 *
 * SBC Contacts (Slade, 2026-09-05) asked for "un endpoint que je peux avoir ça,
 * and updates everytime". The risk in answering that with a bulk feed is that a
 * partner app becomes a way around the paywall the contact list exists behind —
 * a CLASSIQUE member could get CIBLE data, or a lapsed member could keep pulling
 * it forever. This proves the middleware refuses each of those.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-sso-contacts.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from '../config';
import { ssoBearer } from '../api/middleware/sso-bearer.middleware';
import UserModel from '../database/models/user.model';

const DB = process.env.SSO_CONTACTS_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_users_sso_contacts_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const sign = (payload: Record<string, unknown>) =>
    jwt.sign({ ...payload, iss: 'sbc' }, config.sso.jwtSecret as jwt.Secret, { expiresIn: '5m' });

/** Runs the middleware and reports what it did, without an HTTP server. */
const run = async (token: string | null, scope = 'contacts.read') => {
    const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    let status = 0;
    let body: any = null;
    let passed = false;
    const res: any = {
        status(code: number) { status = code; return this; },
        json(payload: any) { body = payload; return this; },
    };
    await ssoBearer(scope)(req, res, () => { passed = true; });
    return { passed, status, code: body?.code, user: req.user };
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const user = await UserModel.create({
        name: 'Membre', email: `sso${Date.now()}@test.cm`, password: 'x',
        phoneNumber: '237600000001', country: 'CM', referralCode: `R${Date.now()}`,
    });
    const sub = String(user._id);

    const ok = await run(sign({ sub, client_id: 'sbc-contacts', scopes: ['contacts.read'], type: 'access' }));
    check('a scoped access token is accepted', ok.passed, `status ${ok.status || 'next()'}`);
    check(
        'and it acts as the authorising user, not the client',
        ok.user?.userId === sub && ok.user?.role === user.role,
        `userId ${ok.user?.userId}, role ${ok.user?.role}`,
    );

    const noScope = await run(sign({ sub, client_id: 'sbc-contacts', scopes: ['profile.read'], type: 'access' }));
    check('a token without contacts.read is refused', !noScope.passed && noScope.status === 403,
        `status ${noScope.status}, code ${noScope.code}`);

    const refresh = await run(sign({ sub, client_id: 'sbc-contacts', scopes: ['contacts.read'], type: 'refresh' }));
    check('a refresh token cannot be used as an access token', !refresh.passed && refresh.status === 401,
        'refresh tokens are long-lived by design');

    // The whole point of the separate secret: the two token families must not be
    // interchangeable in either direction.
    const wrongSecret = jwt.sign(
        { sub, client_id: 'x', scopes: ['contacts.read'], type: 'access' },
        config.jwt.secret as jwt.Secret,
        { expiresIn: '5m' },
    );
    const foreign = await run(wrongSecret);
    check('a token signed with the SBC user secret is refused', !foreign.passed && foreign.status === 401,
        'SSO uses a separate secret on purpose');

    check('no token at all is refused', !(await run(null)).passed);

    const blocked = await UserModel.create({
        name: 'Bloqué', email: `b${Date.now()}@test.cm`, password: 'x',
        phoneNumber: '237600000002', country: 'CM', referralCode: `B${Date.now()}`, blocked: true,
    });
    const blockedRes = await run(sign({ sub: String(blocked._id), client_id: 'sbc-contacts', scopes: ['contacts.read'], type: 'access' }));
    check(
        'a blocked account is refused even with a valid token',
        !blockedRes.passed && blockedRes.status === 401,
        'the role and account state are read live, never trusted from the token',
    );

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err.message);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
