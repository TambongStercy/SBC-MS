/**
 * Account suspension (2026-11-23, services/account-ban.service.ts):
 *   - the rule: no filleul + balance above the journal (A > B) or referral commissions → suspicious;
 *     explained money (deposits, views, transfers…) → fine; any filleul → the rule does not apply;
 *     a movement in flight or a member older than the first snapshot without opening → not judged;
 *   - NO_REFERRAL_BAN off (nothing evaluated) / log (reported, never banned) / enforce (banned);
 *   - the ban: blocked + ban, one writer when two withdrawals race, sessions ended, Redis flag,
 *     withdrawal lock `account_banned`, already-banned answer;
 *   - a banned member: sign-in with the right password, the code step, the auth middleware,
 *     GET /me, session refresh and session adopt answer 403 ACCOUNT_BANNED (a wrong password
 *     stays a wrong password);
 *   - unban: back to normal, history kept, flag cleared; a member blocked by an admin before stays blocked;
 *   - the support card carries the ban.
 *
 * Needs a local Mongo (its own database, dropped) and Redis (DB 14, keys under its own prefix).
 *   npx ts-node --transpile-only src/scripts/check-account-ban.ts
 */
process.env.REDIS_URL = process.env.ACCOUNT_BAN_TEST_REDIS || 'redis://127.0.0.1:6379/14';
process.env.REDIS_KEY_PREFIX = 'sbc:user:check-ban:';
process.env.SESSION_COOKIES = 'on';
export {};

const DB = process.env.ACCOUNT_BAN_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_account_ban_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeRes = () => {
    const out: any = { statusCode: 200, body: undefined, jar: {} as Record<string, any> };
    out.status = (c: number) => { out.statusCode = c; return out; };
    out.json = (b: any) => { out.body = b; return out; };
    out.send = (b: any) => { out.body = b; return out; };
    out.setHeader = () => out;
    out.cookie = (n: string, v: string, o: any) => { out.jar[n] = { value: v, opts: o }; return out; };
    out.clearCookie = (n: string) => { out.jar[n] = null; return out; };
    return out;
};
const fakeReq = (opts: { body?: any; headers?: Record<string, string>; cookies?: Record<string, string>; user?: any } = {}) => {
    const h: Record<string, string> = { 'user-agent': 'check', ...(opts.headers ?? {}) };
    const c = Object.entries(opts.cookies ?? {}).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) h.cookie = c;
    return { body: opts.body ?? {}, headers: h, header: (n: string) => h[n.toLowerCase()], ip: '127.0.0.1', user: opts.user, params: {}, query: {} } as any;
};
const isBannedAnswer = (res: any) => res.statusCode === 403 && res.body?.success === false && res.body?.code === 'ACCOUNT_BANNED' && /suspendu/.test(res.body?.message ?? '');

const main = async () => {
    const mongoose = (await import('mongoose')).default;
    const { Types } = mongoose;
    const UserModel = (await import('../database/models/user.model')).default;
    const ReferralModel = (await import('../database/models/referral.model')).default;
    const { WalletMovementModel } = await import('../database/models/wallet-movement.model');
    const { WalletOpeningBalanceModel } = await import('../database/models/wallet-opening-balance.model');
    const { MemberSessionModel } = await import('../database/models/member-session.model');
    const ban = await import('../services/account-ban.service');
    const { withdrawalLockStatus } = await import('../utils/withdrawal-lock');
    const { signToken } = await import('../utils/jwt');
    const { authenticate } = await import('../api/middleware/auth.middleware');
    const { userController } = await import('../api/controllers/user.controller');
    const { openCookieSession, refreshCookieSession } = await import('../services/member-session.service');
    const { getSupportDetails } = await import('../services/support.service');
    const { withRedis, rkey, closeRedis } = await import('../utils/redis');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await WalletMovementModel.syncIndexes();
    await MemberSessionModel.syncIndexes();
    // Wait for Redis (the client connects lazily on first use).
    for (let i = 0; i < 20 && !(await withRedis('check', false, async (r) => (await r.ping()) === 'PONG')); i++) await sleep(100);
    check('Redis reachable for the flag', await withRedis('check', false, async (r) => (await r.ping()) === 'PONG'));

    // The first opening snapshot was taken yesterday: members created since have no opening row.
    const snapAt = new Date(Date.now() - 86400_000);
    const old = await UserModel.create({ name: 'Ancien', email: 'ancien.ban@gmail.com', phoneNumber: '237677199999', password: 'Secret123!', country: 'CM', isVerified: true, createdAt: new Date(Date.now() - 30 * 86400_000) } as any);
    await WalletOpeningBalanceModel.create({ userId: old._id, currency: 'XAF', amount: 0, snapshotAt: snapAt });
    await WalletOpeningBalanceModel.create({ userId: old._id, currency: 'USD', amount: 0, snapshotAt: snapAt });
    ban._resetSnapshotCache();

    let seq = 0;
    const mkUser = async (name: string, extra: Record<string, unknown> = {}) => {
        seq++;
        return UserModel.create({
            name, email: `ban.${seq}.${name.toLowerCase().replace(/\W/g, '')}@gmail.com`, phoneNumber: `23767710${String(seq).padStart(4, '0')}`,
            password: 'Secret123!', country: 'CM', isVerified: true, ...extra,
        } as any);
    };
    let mv = 0;
    const credit = async (userId: any, amount: number, source: string, currency = 'XAF', status = 'APPLIED') => {
        mv++;
        await WalletMovementModel.create({
            reference: `check:${mv}`, direction: 'CREDIT', userId, currency, amount, requestedAmount: amount, source, status,
            appliedAt: status === 'APPLIED' ? new Date() : undefined,
        } as any);
        if (status === 'APPLIED') await UserModel.updateOne({ _id: userId }, { $inc: { [currency === 'USD' ? 'usdBalance' : 'balance']: amount } });
    };

    // Explained money from legitimate sources, no filleul.
    const clean = await mkUser('Propre');
    await credit(clean._id, 5000, 'deposit');
    await credit(clean._id, 1200, 'advertising-earnings');
    await credit(clean._id, 800, 'member-transfer');
    await credit(clean._id, 300, 'leaderboard-bonus');
    await credit(clean._id, 2, 'deposit', 'USD');
    // A > B: money that no movement explains.
    const unexplained = await mkUser('Inexpliqué');
    await credit(unexplained._id, 1000, 'deposit');
    await UserModel.updateOne({ _id: unexplained._id }, { $inc: { balance: 50_000 } });
    // A > B in USD only.
    const usdOnly = await mkUser('Usd');
    await UserModel.updateOne({ _id: usdOnly._id }, { $inc: { usdBalance: 25 } });
    // Referral commission without any filleul (balance itself explained).
    const commission = await mkUser('Commission');
    await credit(commission._id, 1500, 'commission');
    // Commission fully taken back by support: not counted.
    const reversed = await mkUser('Reprise');
    await credit(reversed._id, 1500, 'commission');
    mv++;
    await WalletMovementModel.create({ reference: `commission-reversal:tx${mv}`, direction: 'DEBIT', userId: reversed._id, currency: 'XAF', amount: 1500, requestedAmount: -1500, source: 'commission-reversal', status: 'APPLIED', appliedAt: new Date() } as any);
    await UserModel.updateOne({ _id: reversed._id }, { $inc: { balance: -1500 } });
    // Has a filleul (archived counts) + A > B: not this rule.
    const sponsor = await mkUser('Parrain');
    await UserModel.updateOne({ _id: sponsor._id }, { $inc: { balance: 90_000 } });
    await ReferralModel.create({ referrer: sponsor._id, referredUser: old._id, referralLevel: 1, archived: true });
    // Not a member.
    const admin = await mkUser('Admin', { role: 'admin' });
    await UserModel.updateOne({ _id: admin._id }, { $inc: { balance: 90_000 } });
    // A movement in flight: not judged.
    const pending = await mkUser('EnCours');
    await credit(pending._id, 700, 'deposit', 'XAF', 'PENDING');
    await UserModel.updateOne({ _id: pending._id }, { $inc: { balance: 700 } });
    // Created before the first snapshot and no opening row: not judged.
    const noSnap = await mkUser('SansOuverture', { createdAt: new Date(Date.now() - 40 * 86400_000) });
    await UserModel.updateOne({ _id: noSnap._id }, { $inc: { balance: 10_000 } });

    // --- evaluation ---
    const ev = async (u: any) => (await ban.evaluateNoReferralRule(String(u._id)))!;
    let e = await ev(clean);
    check('no filleul, money explained (deposit, views, transfer, bonus) → not suspicious', e.applicable && !e.suspicious && e.reasons.length === 0, JSON.stringify(e.details.balances));
    e = await ev(unexplained);
    check('no filleul, A > B → unexplained_balance with A and B', e.suspicious && e.reasons.includes('unexplained_balance') && e.details.a === 51000 && e.details.b === 1000, JSON.stringify(e.details));
    e = await ev(usdOnly);
    check('no filleul, A > B in USD only → unexplained_balance (USD)', e.suspicious && e.details.currency === 'USD' && e.details.a === 25 && e.details.b === 0);
    e = await ev(commission);
    check('no filleul, commission credit → commission_without_referrals', e.suspicious && e.reasons.join() === 'commission_without_referrals' && e.details.commissionCredits === 1500);
    e = await ev(reversed);
    check('commission fully taken back → not suspicious', !e.suspicious && e.details.commissionReversed === 1500);
    e = await ev(sponsor);
    check('has a filleul (archived row) + A > B → rule does not apply', !e.applicable && e.skipped === 'has_referrals' && !e.suspicious);
    e = await ev(admin);
    check('not role user → rule does not apply', !e.applicable && e.skipped === 'not_member');
    e = await ev(pending);
    check('movement in flight → not judged', !e.suspicious && e.details.balances[0].note === 'pending_movement');
    e = await ev(noSnap);
    check('older than the first snapshot, no opening row → not judged', !e.suspicious && e.details.balances[0].note === 'no_snapshot');

    // --- modes ---
    process.env.NO_REFERRAL_BAN = 'off';
    let r = (await ban.withdrawalBanCheck(String(unexplained._id)))!;
    check('off: nothing evaluated, nothing banned', r.mode === 'off' && !r.suspicious && !r.banned && r.details === null);
    process.env.NO_REFERRAL_BAN = 'log';
    r = (await ban.withdrawalBanCheck(String(unexplained._id), { amount: 20000, currency: 'XAF' }))!;
    let u: any = await UserModel.findById(unexplained._id).lean();
    check('log: reported suspicious, never banned', r.mode === 'log' && r.suspicious && !r.banned && !u.blocked && !u.ban);
    process.env.NO_REFERRAL_BAN = 'enforce';
    r = (await ban.withdrawalBanCheck(String(unexplained._id), { amount: 20000, currency: 'XAF', dryRun: true }))!;
    u = await UserModel.findById(unexplained._id).lean();
    check('enforce + dryRun (drills): never banned', r.suspicious && !r.banned && !u.ban);
    r = (await ban.withdrawalBanCheck(String(clean._id)))!;
    check('enforce: explained money → not banned', !r.suspicious && !r.banned && !(await UserModel.findById(clean._id).lean() as any).blocked);
    r = (await ban.withdrawalBanCheck(String(sponsor._id)))!;
    check('enforce: has filleuls + A > B → not banned by this rule', !r.banned && !(await UserModel.findById(sponsor._id).lean() as any).blocked);

    // A cookie session open before the ban.
    const sres = fakeRes();
    await openCookieSession(fakeReq(), sres, (await UserModel.findById(unexplained._id).lean()) as any);
    const refreshCookie = sres.jar.sbc_rt.value as string;

    // Two withdrawals at once: banned once.
    const [r1, r2] = await Promise.all([
        ban.withdrawalBanCheck(String(unexplained._id), { amount: 20000, currency: 'XAF', transactionId: 'TXA' }),
        ban.withdrawalBanCheck(String(unexplained._id), { amount: 20000, currency: 'XAF', transactionId: 'TXB' }),
    ]);
    u = await UserModel.findById(unexplained._id).lean();
    check('enforce: A > B → banned (blocked + ban with reasons and figures)',
        r1!.banned && r2!.banned && u.blocked === true && u.ban?.reason === 'no_referral_withdrawal' && u.ban?.by === 'system:no-referral-rule'
        && (u.ban?.details as any)?.reasons?.includes('unexplained_balance') && (u.ban?.details as any)?.evaluation?.a === 51000 && (u.ban?.details as any)?.attempt?.amount === 20000);
    check('two withdrawals at once: one ban set, the other sees it', [r1!.alreadyBanned, r2!.alreadyBanned].filter(Boolean).length === 1 && r1!.ban!.at === r2!.ban!.at);
    const sess: any = await MemberSessionModel.findOne({ userId: unexplained._id }).lean();
    check('ban ends every session', !!sess?.revokedAt && sess?.revokedReason === 'banned');
    check('ban sets the Redis flag', await ban.hasBanFlag(String(unexplained._id)));
    check('withdrawal lock: account_banned (admin paths too)', withdrawalLockStatus(u).reason === 'account_banned' && withdrawalLockStatus(u).locked === true && !!withdrawalLockStatus(u).until);
    r = (await ban.withdrawalBanCheck(String(unexplained._id)))!;
    check('banned member asking again → alreadyBanned', r.banned && r.alreadyBanned);

    r = (await ban.withdrawalBanCheck(String(commission._id)))!;
    check('enforce: commission without filleuls → banned', r.banned && !!(await UserModel.findById(commission._id).lean() as any).ban);

    // --- the banned member everywhere ---
    const login = async (password: string) => { const res = fakeRes(); await userController.login(fakeReq({ body: { email: u.email, password } }), res); return res; };
    let res = await login('Wrong-password-1');
    check('banned + wrong password → still a wrong password (no enumeration)', res.statusCode === 401 && res.body?.errorType === 'WRONG_PASSWORD');
    res = await login('Secret123!');
    check('banned + right password → 403 ACCOUNT_BANNED', isBannedAnswer(res), JSON.stringify(res.body));

    const token = signToken({ userId: String(unexplained._id), id: String(unexplained._id), email: u.email, role: 'user' });
    res = fakeRes();
    let nextCalled = false;
    await authenticate(fakeReq({ headers: { authorization: `Bearer ${token}` } }), res, () => { nextCalled = true; });
    check('auth middleware (every member route) → 403 ACCOUNT_BANNED', !nextCalled && isBannedAnswer(res));

    // Redis down / flag missing: GET /me still reads the database.
    await withRedis('check', 0, (rr) => rr.del(rkey(`ban:${unexplained._id}`)));
    res = fakeRes();
    nextCalled = false;
    await authenticate(fakeReq({ headers: { authorization: `Bearer ${token}` } }), res, () => { nextCalled = true; });
    check('flag missing: middleware lets it through (fail open)…', nextCalled);
    res = fakeRes();
    await userController.getMe(fakeReq({ user: { userId: String(unexplained._id), role: 'user' } }), res);
    check('…and GET /users/me answers 403 ACCOUNT_BANNED from the database', isBannedAnswer(res), JSON.stringify(res.body));

    // Session refresh (a session still open, e.g. revoked before the ban landed).
    await MemberSessionModel.updateOne({ userId: unexplained._id }, { $set: { revokedAt: null, revokedReason: null } });
    const rres = fakeRes();
    const outcome = await refreshCookieSession(fakeReq({ cookies: { sbc_rt: refreshCookie } }), rres);
    check('session refresh → banned (route answers 403 ACCOUNT_BANNED), cookies cleared, session revoked',
        outcome === 'banned' && rres.jar.sbc_at === null && !!(await MemberSessionModel.findOne({ userId: unexplained._id }).lean() as any)?.revokedAt);

    // The code step: a code asked before the ban.
    await UserModel.updateOne({ _id: unexplained._id }, { $push: { otps: { code: 'ABCDEF', expiration: new Date(Date.now() + 600_000) } } });
    res = fakeRes();
    await userController.verifyOtp(fakeReq({ body: { userId: String(unexplained._id), otpCode: 'abcdef' } }), res);
    check('verify-otp with a valid code → 403 ACCOUNT_BANNED, no session', isBannedAnswer(res) && !res.body?.data);

    // --- support card ---
    const [card] = await getSupportDetails([String(unexplained._id)]);
    check('support card carries the ban (date, reason, details)', !!card?.ban && card.ban.reason === 'no_referral_withdrawal' && !!card.ban.at && !!(card.ban.details as any)?.evaluation);

    // --- unban ---
    let err: any = null;
    try { await ban.unbanAccount(String(unexplained._id), { by: 'support:agent1', reason: '' }); } catch (x) { err = x; }
    check('unban needs a reason', err?.code === 'REASON_REQUIRED');
    await ban.setBanFlag(String(unexplained._id));
    const un = await ban.unbanAccount(String(unexplained._id), { by: 'support:agent1|finance_manager', reason: 'Solde vérifié avec la finance : dépôt manuel légitime.' });
    u = await UserModel.findById(unexplained._id).lean();
    check('unban: blocked false, ban gone, history kept', un.unbanned && u.blocked === false && !u.ban && u.banHistory?.length === 1 && u.banHistory[0].liftedBy === 'support:agent1|finance_manager' && u.banHistory[0].reason === 'no_referral_withdrawal');
    check('unban clears the Redis flag', !(await ban.hasBanFlag(String(unexplained._id))));
    check('unban: withdrawal lock lifted', !withdrawalLockStatus(u).locked);
    res = fakeRes();
    nextCalled = false;
    await authenticate(fakeReq({ headers: { authorization: `Bearer ${token}` } }), res, () => { nextCalled = true; });
    check('unban: member routes open again', nextCalled);
    res = fakeRes();
    await userController.getMe(fakeReq({ user: { userId: String(unexplained._id), role: 'user' } }), res);
    check('unban: GET /me 200', res.statusCode === 200 && res.body?.success === true);
    err = null;
    try { await ban.unbanAccount(String(unexplained._id), { by: 'x', reason: 'encore une fois' }); } catch (x) { err = x; }
    check('unban twice → 409 NOT_BANNED', err?.statusCode === 409 && err?.code === 'NOT_BANNED');
    const [card2] = await getSupportDetails([String(unexplained._id)]);
    check('support card: no ban, one lifted entry', card2.ban === null && card2.banHistory.length === 1 && !!card2.banHistory[0].liftedAt);

    // Blocked by an admin before the ban: still blocked once the ban is lifted.
    const blockedFirst = await mkUser('DejaBloque');
    await UserModel.updateOne({ _id: blockedFirst._id }, { $set: { blocked: true }, $inc: { balance: 5000 } });
    r = (await ban.withdrawalBanCheck(String(blockedFirst._id)))!;
    check('already blocked by an admin → ban still recorded', r.banned && (await UserModel.findById(blockedFirst._id).lean() as any).ban?.blockedBefore === true);
    await ban.unbanAccount(String(blockedFirst._id), { by: 'support:x', reason: 'Vérifié, suspension levée.' });
    check('…and lifting the ban keeps the admin block', (await UserModel.findById(blockedFirst._id).lean() as any).blocked === true);

    check('unknown member → null', (await ban.withdrawalBanCheck(String(new Types.ObjectId()))) === null);

    await mongoose.connection.dropDatabase();
    await withRedis('check', 0, async (rr) => { const keys = await rr.keys('sbc:user:check-ban:*'); return keys.length ? rr.del(...keys) : 0; });
    await mongoose.disconnect();
    await closeRedis();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
