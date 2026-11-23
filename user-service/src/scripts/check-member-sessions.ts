import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import UserModel from '../database/models/user.model';
import { MemberSessionModel } from '../database/models/member-session.model';
import { SessionKeyModel } from '../database/models/session-key.model';
import config from '../config';
import {
    durationSeconds, endCookieSession, openCookieSession, refreshCookieSession, setSessionPublicKey, wantsCookieSession,
} from '../services/member-session.service';
import { tokenHashOf } from '../services/session-keys.service';

/**
 * Security plan Phase 9: member sessions in HttpOnly cookies, refresh rotation, reuse detection.
 *   - opening sets sbc_at (short JWT with sid, HttpOnly, Path=/), sbc_rt (Path=/api/users/session)
 *     and sbc_csrf (readable), and binds the browser key to the access token;
 *   - refresh rotates the refresh token, keeps the key bound to the new access token;
 *   - the replaced refresh token: accepted within the grace (access only), then = reuse → revoked;
 *   - a blocked member's refresh ends the session; logout revokes; the switch and the header.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *   npx ts-node --transpile-only src/scripts/check-member-sessions.ts
 */
const DB = process.env.MEMBER_SESSION_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_member_session_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

type Jar = Record<string, { value: string; opts: any } | null>;
const fakeRes = () => {
    const jar: Jar = {};
    return {
        jar,
        cookie(name: string, value: string, opts: any) { jar[name] = { value, opts }; return this; },
        clearCookie(name: string) { jar[name] = null; return this; },
    } as any;
};
const fakeReq = (headers: Record<string, string> = {}, cookies: Record<string, string> = {}) => {
    const h: Record<string, string> = { 'user-agent': 'check', ...headers };
    const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) h.cookie = c;
    return { headers: h, header: (n: string) => h[n.toLowerCase()] } as any;
};
const decode = (t: string) => jwt.verify(t, config.jwt.secret) as any;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await MemberSessionModel.syncIndexes();
    await SessionKeyModel.syncIndexes();
    process.env.SESSION_COOKIES = 'on';
    process.env.MEMBER_ACCESS_TTL_MIN = '15';

    const user = await UserModel.create({
        name: 'Membre', email: 'membre.session@gmail.com', phoneNumber: '237677009001', password: 'Secret123!', country: 'CM', isVerified: true,
    } as any);
    const spki = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    // --- switch + header ---
    check('wants cookies: switch on + header', wantsCookieSession(fakeReq({ 'x-sbc-session': 'cookie' })));
    check('no header: Bearer as before', !wantsCookieSession(fakeReq()));
    process.env.SESSION_COOKIES = 'off';
    check('switch off: Bearer even with the header', !wantsCookieSession(fakeReq({ 'x-sbc-session': 'cookie' })));
    process.env.SESSION_COOKIES = 'on';
    check('durations', durationSeconds('1d') === 86400 && durationSeconds('12h') === 43200 && durationSeconds('30m') === 1800 && durationSeconds('3600') === 3600 && durationSeconds('nope', 7) === 7);

    // --- open ---
    const res1 = fakeRes();
    const access1 = await openCookieSession(fakeReq({ 'x-sbc-session': 'cookie', 'x-sbc-device': 'device-abc-123' }), res1, user as any, { publicKey: spki });
    const c1 = decode(access1);
    const at = res1.jar.sbc_at, rt = res1.jar.sbc_rt, csrf = res1.jar.sbc_csrf;
    check('open: three cookies with the right flags',
        !!at && at.opts.httpOnly && at.opts.secure && at.opts.sameSite === 'strict' && at.opts.path === '/'
        && !!rt && rt.opts.httpOnly && rt.opts.path === '/api/users/session'
        && !!csrf && csrf.opts.httpOnly === false && csrf.value.length >= 40,
        JSON.stringify({ at: at?.opts, rt: rt?.opts?.path, csrf: csrf?.opts?.httpOnly }));
    check('open: access token is a member JWT with sid, about 15 min',
        c1.userId === String(user._id) && c1.role === 'user' && !!c1.sid && c1.exp - c1.iat === 900 && at!.value === access1);
    const s1 = await MemberSessionModel.findById(c1.sid).lean();
    check('open: session stored with the refresh hash only (never the token) and a 1-day end',
        !!s1 && s1.refreshHash !== rt!.value && s1.refreshHash.length === 64 && Math.abs(s1.expiresAt.getTime() - Date.now() - 86400_000) < 5000 && s1.publicKey === spki);
    check('open: browser key bound to the access token', !!(await SessionKeyModel.findOne({ tokenHash: tokenHashOf(access1) }).lean()));

    // --- refresh ---
    const res2 = fakeRes();
    const o2 = await refreshCookieSession(fakeReq({}, { sbc_rt: rt!.value }), res2);
    const access2 = res2.jar.sbc_at?.value as string;
    check('refresh: new access + new refresh token, csrf unchanged',
        o2 === 'refreshed' && !!access2 && access2 !== access1 && !!res2.jar.sbc_rt && res2.jar.sbc_rt.value !== rt!.value && !('sbc_csrf' in res2.jar), o2);
    check('refresh: same session id, key bound to the new access token',
        decode(access2).sid === c1.sid && !!(await SessionKeyModel.findOne({ tokenHash: tokenHashOf(access2) }).lean()));

    // --- the replaced token within the grace (another tab) ---
    const res3 = fakeRes();
    const o3 = await refreshCookieSession(fakeReq({}, { sbc_rt: rt!.value }), res3);
    check('old refresh token within the grace: access only, no new refresh cookie', o3 === 'grace' && !!res3.jar.sbc_at && !('sbc_rt' in res3.jar), o3);

    // --- the newest one still works ---
    const rt2 = res2.jar.sbc_rt!.value;
    const res4 = fakeRes();
    check('newest refresh token works', (await refreshCookieSession(fakeReq({}, { sbc_rt: rt2 }), res4)) === 'refreshed');
    const rt3 = res4.jar.sbc_rt!.value;

    // --- reuse after the grace → revoked ---
    await MemberSessionModel.updateOne({ _id: c1.sid }, { $set: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });
    const res5 = fakeRes();
    const o5 = await refreshCookieSession(fakeReq({}, { sbc_rt: rt2 }), res5);
    const s5 = await MemberSessionModel.findById(c1.sid).lean();
    check('replaced token after the grace: reuse → session revoked, cookies cleared',
        o5 === 'reused' && !!s5?.revokedAt && s5?.revokedReason === 'reuse' && res5.jar.sbc_at === null, o5);
    check('…and the newest token is dead too', (await refreshCookieSession(fakeReq({}, { sbc_rt: rt3 }), fakeRes())) !== 'refreshed');
    check('unknown / missing refresh token refused',
        (await refreshCookieSession(fakeReq({}, { sbc_rt: 'x'.repeat(43) }), fakeRes())) === 'unknown'
        && (await refreshCookieSession(fakeReq(), fakeRes())) === 'missing');

    // --- blocked member ---
    const res6 = fakeRes();
    await openCookieSession(fakeReq(), res6, user as any);
    await UserModel.updateOne({ _id: user._id }, { $set: { blocked: true } });
    const o6 = await refreshCookieSession(fakeReq({}, { sbc_rt: res6.jar.sbc_rt.value }), fakeRes());
    check('blocked member: refresh ends the session', o6 === 'inactive', o6);
    await UserModel.updateOne({ _id: user._id }, { $set: { blocked: false } });

    // --- logout ---
    const res7 = fakeRes();
    const a7 = await openCookieSession(fakeReq(), res7, user as any);
    const out = fakeRes();
    const ended = await endCookieSession(fakeReq({}, { sbc_rt: res7.jar.sbc_rt.value }), out, null);
    check('logout: session revoked, cookies cleared, refresh refused',
        ended && out.jar.sbc_at === null && out.jar.sbc_rt === null && out.jar.sbc_csrf === null
        && (await refreshCookieSession(fakeReq({}, { sbc_rt: res7.jar.sbc_rt.value }), fakeRes())) === 'expired'
        && !!(await MemberSessionModel.findById(decode(a7).sid).lean())?.revokedAt);
    const res8 = fakeRes();
    const a8 = await openCookieSession(fakeReq(), res8, user as any);
    check('logout by sid (access token only)', await endCookieSession(fakeReq(), fakeRes(), decode(a8).sid));

    // --- late key ---
    const res9 = fakeRes();
    const a9 = await openCookieSession(fakeReq(), res9, user as any);
    const sid9 = decode(a9).sid;
    check('late key: set once on a session without one', await setSessionPublicKey(sid9, String(user._id), spki) && !(await setSessionPublicKey(sid9, String(user._id), spki)));
    const res10 = fakeRes();
    await refreshCookieSession(fakeReq({}, { sbc_rt: res9.jar.sbc_rt.value }), res10);
    check('late key: bound to the next access token', !!(await SessionKeyModel.findOne({ tokenHash: tokenHashOf(res10.jar.sbc_at.value) }).lean()));
    check('late key: another member cannot set it', !(await setSessionPublicKey(sid9, String(new mongoose.Types.ObjectId()), spki)));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
