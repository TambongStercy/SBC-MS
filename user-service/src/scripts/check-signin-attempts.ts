import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';

/**
 * Security plan Phase 1 item 3: sign-in attempts (local Mongo, own database, dropped).
 *   - password step: code_sent / unknown_account / wrong_password / blocked, masked identifier + HMAC;
 *   - code step recorded only after a password step (sign-up codes are not sign-ins);
 *   - the 10th wrong password within an hour goes to risk-service once (fake risk-service);
 *   - the rollup and the board count them per country and source.
 *
 *   npx ts-node --transpile-only src/scripts/check-signin-attempts.ts
 */
process.env.MONGODB_URI_TEST = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/sbc_users_signin_check';
delete process.env.REDIS_URL;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const main = async () => {
    const events: any[] = [];
    const risk = http.createServer((rq, rs) => { let raw = ''; rq.on('data', c => { raw += c; }); rq.on('end', () => { events.push(JSON.parse(raw)); rs.writeHead(202).end('{}'); }); }).listen(0, '127.0.0.1');
    await new Promise(r => risk.once('listening', r));
    process.env.RISK_SERVICE_URL = `http://127.0.0.1:${(risk.address() as AddressInfo).port}`;

    const UserModel = (await import('../database/models/user.model')).default;
    const { SigninAttemptModel } = await import('../database/models/signin-attempt.model');
    const s = await import('../services/signin-attempts.service');
    const { rollupDay, activityBoard } = await import('../services/activity-dashboard.service');
    const { doualaDay } = await import('../services/activity-signals.service');

    await mongoose.connect(process.env.MONGODB_URI_TEST!);
    await mongoose.connection.dropDatabase();
    const a = await UserModel.create({ name: 'A', email: 'alice@gmail.com', phoneNumber: '237670000001', password: 'x', country: 'CM', referralCode: 'SIA1' } as any);
    const c = await UserModel.create({ name: 'C', email: 'carol@gmail.com', phoneNumber: '237670000003', password: 'x', country: 'CM', referralCode: 'SIC1' } as any);
    const ctx = (extra: Record<string, string> = {}) => s.signinContext({ headers: { 'x-sbc-geo': 'CM', 'x-sbc-client': 'web', ...extra } } as any);

    s.recordPasswordStep(ctx(), 'alice@gmail.com', 'code_sent', String(a._id));
    await wait(50);
    s.recordCodeStep(ctx(), String(a._id), false);
    s.recordCodeStep(ctx(), String(a._id), true);
    s.recordCodeStep(ctx(), '6e2e00000000000000000099', true); // a sign-up code: no password step before
    s.recordPasswordStep(ctx({ 'x-sbc-geo': 'BJ', 'x-sbc-client': 'app' }), 'nobody@gmail.com', 'unknown_account');
    s.recordPasswordStep(ctx(), null, 'invalid');
    for (let i = 0; i < 11; i++) s.recordPasswordStep(ctx(), '+237 670 000 003', 'wrong_password');
    await wait(400);
    await s.flushSigninAttempts();

    const rows = await SigninAttemptModel.find().lean() as any[];
    check('14 password steps + 2 code steps recorded (the sign-up code is not)', rows.filter(r => r.step === 'password').length === 14 && rows.filter(r => r.step === 'code').length === 2, `${rows.length}`);
    const unknown = rows.find(r => r.outcome === 'unknown_account');
    check('unknown account: identifier masked + HMAC, never in clear; country BJ, source app', !!unknown && !JSON.stringify(rows).includes('nobody@') && /^[a-f0-9]{32}$/.test(unknown.identifierKey) && unknown.country === 'BJ' && unknown.source === 'app', unknown?.identifierMasked);
    const wrong = rows.filter(r => r.outcome === 'wrong_password');
    check('wrong passwords are tied to the account found from the typed number', wrong.length === 11 && wrong.every(r => String(r.userId) === String(c._id)) && !JSON.stringify(wrong).includes('670000003'));
    await wait(200);
    const guess = events.filter(e => e.type === 'signin_failures');
    check('the 10th wrong password within an hour → one signin_failures event to risk-service', guess.length === 1 && guess[0].userId === String(c._id) && guess[0].count === 10, JSON.stringify(guess));

    await rollupDay(doualaDay(), { signups: true });
    const b = await activityBoard({ range: 'today' });
    const t: any = b.total.signins;
    check('board: 14 attempts, 1 signed in, 13 refused (11 wrong passwords, 1 unknown, 1 invalid) + 1 wrong code',
        t.attempts === 14 && t.signedIn === 1 && t.reasons.wrong_password === 11 && t.reasons.unknown_account === 1 && t.reasons.invalid === 1 && t.reasons.wrong_code === 1 && t.failed === 14, JSON.stringify(t));
    const bj: any = b.rows.find((r: any) => r.country === 'BJ');
    check('board per country (BJ: 1 unknown account) and reason labels', bj?.signins.failed === 1 && (b as any).signinReasons.some((x: any) => x.code === 'wrong_password'));
    const app = await activityBoard({ range: 'today', source: 'app' });
    check('source filter: app shows only the BJ attempt', (app.total as any).signins.attempts === 1);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    risk.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
