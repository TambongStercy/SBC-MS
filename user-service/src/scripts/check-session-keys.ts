/**
 * Asserts Security plan Phase 9 (user-service side) on a test database
 * (dropped before and after): a sign-in key is bound to its token once; a
 * later binding for the same token is refused (first wins); unusable keys are
 * refused; logout revokes; lookups by token hash; the gateway's log-only
 * counts merge with $inc and keep no member id.
 *
 *   npx ts-node --transpile-only src/scripts/check-session-keys.ts
 */
import { generateKeyPairSync } from 'crypto';
import mongoose, { Types } from 'mongoose';

const DB = process.env.SESSION_KEYS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_session_keys_test';
if (!/_test$/.test(new URL(DB).pathname.slice(1))) { console.error('The database name must end in _test'); process.exit(2); }

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const spki = (curve = 'prime256v1') => generateKeyPairSync('ec', { namedCurve: curve }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const jwtLike = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;

const main = async () => {
    const s = await import('../services/session-keys.service');
    const { SessionKeyModel, BrowserCheckDayModel } = await import('../database/models/session-key.model');
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([SessionKeyModel.syncIndexes(), BrowserCheckDayModel.syncIndexes()]);

    const user = String(new Types.ObjectId());
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const tok = jwtLike(exp);
    const k1 = spki();
    await s.bindAtSignIn(tok, user, k1, 'dev-12345678');
    const row = await SessionKeyModel.findOne({}).lean();
    check('sign-in binds the key to the token hash (not the token), expiring with the token', row?.tokenHash === s.tokenHashOf(tok) && !JSON.stringify(row).includes(tok)
        && row?.late === false && Math.abs(row!.expiresAt.getTime() - exp * 1000) < 1000 && row?.deviceId === 'dev-12345678');
    check('a second binding for the same token is refused (first wins)', (await s.bindSessionKey({ token: tok, userId: user, publicKey: spki(), late: true })) === 'exists'
        && (await s.sessionKeyFor(s.tokenHashOf(tok)))?.publicKey === k1);
    check('unusable keys are refused: garbage, P-384, RSA', (await s.bindSessionKey({ token: jwtLike(exp), userId: user, publicKey: 'abc', late: true })) === 'invalid'
        && (await s.bindSessionKey({ token: jwtLike(exp + 1), userId: user, publicKey: spki('secp384r1'), late: true })) === 'invalid'
        && (await s.bindSessionKey({ token: jwtLike(exp + 2), userId: user, publicKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), late: true })) === 'invalid');
    const old = jwtLike(exp + 3);
    check('an older token binds once, marked late', (await s.bindSessionKey({ token: old, userId: user, publicKey: spki(), late: true })) === 'bound' && (await s.sessionKeyFor(s.tokenHashOf(old)))?.late === true);
    await s.bindAtSignIn(jwtLike(exp + 4), user, 'not-a-key', null);
    check('a sign-in with an unusable key still succeeds (nothing stored, no throw)', (await SessionKeyModel.countDocuments()) === 2);
    await s.revokeSessionKey(tok);
    check('logout revokes: the gateway no longer gets the key', (await s.sessionKeyFor(s.tokenHashOf(tok))) === null && (await SessionKeyModel.countDocuments({ revokedAt: { $ne: null } })) === 1);
    check('bad hash → null', (await s.sessionKeyFor('nothex')) === null);

    const rows = [
        { day: '2026-11-21', group: 'users', client: 'web', role: 'member', browser: 'chrome', android: '10', signature: 'valid', origin: 'sbc', fetchSite: 'same-origin', tool: false, count: 7 },
        { day: '2026-11-21', group: 'users', client: 'none', role: 'member', browser: 'tool', android: 'none', signature: 'missing', origin: 'none', fetchSite: 'absent', tool: true, count: 2 },
        { day: 'bad', count: 5 }, { day: '2026-11-21', group: '$where', count: 1 },
    ];
    await s.ingestBrowserChecks(rows);
    await s.ingestBrowserChecks([rows[0]]);
    // Phase 9 part 2: the body outcome is one more dimension; rows from an older gateway count as 'na'
    await s.ingestBrowserChecks([{ ...rows[0], body: 'mismatch', count: 1 }]);
    const days = await BrowserCheckDayModel.find({}).lean();
    check('body outcome kept apart: mismatch row separate; older rows stored as na',
        (days as any[]).find(d => d.body === 'mismatch')?.count === 1 && (days as any[]).find(d => d.signature === 'valid' && d.body === 'na')?.count === 14);
    check('gateway counts merge with $inc; bad rows dropped; odd values become "other"',
        (days as any[]).find(d => d.signature === 'valid' && d.body === 'na')?.count === 14 && days.find(d => d.tool)?.count === 2 && days.some(d => d.group === 'other') && days.length === 4, JSON.stringify(days.map(d => [d.signature, d.count])));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
