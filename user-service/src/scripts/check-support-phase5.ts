/**
 * Asserts the user-service side of Security plan Phase 5 (support integration):
 *   - freeze / unfreeze (conditional, idempotent refusals), the lock check reads
 *     the freeze first, and a later MoMo or email lock can never lift it;
 *   - Mobile Money change by support: locks withdrawals, refuses the same value
 *     and a number invalid for the country;
 *   - authenticator reset refused when the member has none;
 *   - related: same account or referral tree (levels 1–3, up or down), not siblings;
 *   - member card: declared / usual / last country, frozen, balance A vs B;
 *   - case outbox: a case that support refuses on the network is queued and sent
 *     once support answers; one queued row per dedupKey; a 4xx is not retried.
 *
 * Needs local Mongo; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-support-phase5.ts
 */
import http from 'http';
import { AddressInfo } from 'net';
import mongoose, { Types } from 'mongoose';

const DB = process.env.PHASE5_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_phase5_check';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check-secret';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refused = async (fn: () => Promise<unknown>, code: string) => {
    try { await fn(); return false; } catch (e: any) { return e?.code === code; }
};

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const ReferralModel = (await import('../database/models/referral.model')).default;
    const WalletOpeningBalanceModel = (await import('../database/models/wallet-opening-balance.model')).default;
    const sup = await import('../services/support.service');
    const { withdrawalLockStatus, withdrawalLockFields, FROZEN_UNTIL } = await import('../utils/withdrawal-lock');
    const outbox = await import('../services/clients/support.service.client');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await outbox.SupportCaseOutbox.syncIndexes();

    const mk = (n: number, extra: Record<string, unknown> = {}) => UserModel.create({
        name: `P5 ${n}`, email: `p5.${n}@e2e.test`, phoneNumber: `23767700${String(n).padStart(4, '0')}`, password: 'Secret123!',
        country: 'CM', referralCode: `P5REF${n}`, ...extra,
    } as any);
    const a = await mk(1, { momoNumber: '237677001111', momoOperator: 'MTN_MOMO_CMR', geo: { lastCountry: 'BJ', lastCountryAt: new Date(), usualCountry: 'CM', usualShare: 0.8 } });
    const approvalId = String(new Types.ObjectId());

    // ---- freeze ----
    await sup.supportFreeze({ userId: String(a._id), action: 'freeze', reason: 'Fraude suspectée', approvalId });
    let u: any = await UserModel.findById(a._id).lean();
    check('freeze sets frozen', !!u.frozen?.at && u.frozen.approvalId === approvalId);
    let lock = withdrawalLockStatus(u);
    check('lock check: frozen comes first, with no end date', lock.locked && lock.reason === 'account_frozen' && lock.until === FROZEN_UNTIL);
    check('freezing twice is refused', await refused(() => sup.supportFreeze({ userId: String(a._id), action: 'freeze', reason: 'x', approvalId }), 'ALREADY_FROZEN'));
    await UserModel.updateOne({ _id: a._id }, { $set: withdrawalLockFields('email_change') });
    u = await UserModel.findById(a._id).lean();
    check('a later email-change lock does not lift the freeze', withdrawalLockStatus(u).reason === 'account_frozen');
    await sup.supportFreeze({ userId: String(a._id), action: 'unfreeze', reason: 'Vérifié', approvalId });
    u = await UserModel.findById(a._id).lean();
    lock = withdrawalLockStatus(u);
    check('unfreeze removes it; the timed lock still applies', !u.frozen && lock.locked && lock.reason === 'email_change');
    check('unfreezing twice is refused', await refused(() => sup.supportFreeze({ userId: String(a._id), action: 'unfreeze', reason: 'x', approvalId }), 'NOT_FROZEN'));
    check('freeze needs an approval id', await refused(() => sup.supportFreeze({ userId: String(a._id), action: 'freeze', reason: 'x', approvalId: '' }), 'INVALID_INPUT'));

    // ---- MoMo change ----
    await UserModel.updateOne({ _id: a._id }, { $unset: { withdrawalsLockedUntil: 1, withdrawalLockReason: 1 } });
    const r = await sup.supportMomoChange({ userId: String(a._id), momoNumber: '699112233', momoOperator: 'orange_cmr', approvalId });
    u = await UserModel.findById(a._id).lean();
    check('MoMo change stores the number with the dialling code and the operator', u.momoNumber === '237699112233' && u.momoOperator === 'ORANGE_CMR', `${u.momoNumber} ${u.momoOperator}`);
    check('replacing a number locks withdrawals (momo_change)', withdrawalLockStatus(u).reason === 'momo_change' && !!r.withdrawalsLockedUntil);
    check('the same number again is refused', await refused(() => sup.supportMomoChange({ userId: String(a._id), momoNumber: '237699112233', momoOperator: 'ORANGE_CMR', approvalId }), 'SAME_VALUE'));
    check('a bad operator is refused', await refused(() => sup.supportMomoChange({ userId: String(a._id), momoNumber: '699112244', momoOperator: 'x', approvalId }), 'INVALID_VALUE'));

    // ---- authenticator ----
    check('authenticator reset refused when the member has none', await refused(() => sup.supportAuthenticatorReset({ userId: String(a._id), reason: 'Téléphone perdu', approvalId }), 'NO_AUTHENTICATOR'));

    // ---- related ----
    const [p1, p2, child, sibling, stranger] = await Promise.all([mk(2), mk(3), mk(4), mk(5), mk(6)]);
    await ReferralModel.insertMany([
        { referrer: p1._id, referredUser: a._id, referralLevel: 1 },
        { referrer: p2._id, referredUser: a._id, referralLevel: 2 },
        { referrer: a._id, referredUser: child._id, referralLevel: 1 },
        { referrer: p1._id, referredUser: sibling._id, referralLevel: 1 },
    ] as any[]);
    check('related: same account', await sup.areRelatedMembers(String(a._id), String(a._id)));
    check('related: parrain (level 1) and level 2, both ways', await sup.areRelatedMembers(String(a._id), String(p1._id)) && await sup.areRelatedMembers(String(p2._id), String(a._id)));
    check('related: filleul', await sup.areRelatedMembers(String(a._id), String(child._id)));
    check('not related: a sibling (same parrain) or a stranger', !(await sup.areRelatedMembers(String(a._id), String(sibling._id))) && !(await sup.areRelatedMembers(String(a._id), String(stranger._id))));

    // ---- member card ----
    await UserModel.updateOne({ _id: a._id }, { $set: { balance: 1500 } });
    await WalletOpeningBalanceModel.create({ userId: a._id, currency: 'XAF', amount: 1000, snapshotAt: new Date(Date.now() - 60_000) } as any);
    await sup.supportFreeze({ userId: String(a._id), action: 'freeze', reason: 'Contrôle', approvalId });
    const [card] = await sup.getSupportDetails([String(a._id)]);
    check('card: declared / usual / last country', card.geo.declared === 'CM' && card.geo.usual === 'CM' && card.geo.last === 'BJ' && card.geo.usualShare === 0.8);
    check('card: frozen with its reason', card.frozen?.reason === 'Contrôle');
    const xaf = card.ledger?.find(l => l.currency === 'XAF');
    check('card: balance A (1500) against B (opening 1000, no movement) → mismatch shown', xaf?.actual === 1500 && xaf?.expected === 1000 && xaf?.matches === false, JSON.stringify(card.ledger));
    const [plain] = await sup.getSupportDetails([String(stranger._id)]);
    check('card: no opening snapshot → ledger null', plain.ledger === null && plain.frozen === null);

    // ---- case outbox ----
    let mode: 'down' | 'up' | 'bad' = 'down';
    const received: string[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            if (mode === 'down') { res.writeHead(503); res.end('{}'); return; }
            if (mode === 'bad') { res.writeHead(400); res.end('{"success":false}'); return; }
            received.push(JSON.parse(body).dedupKey);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: { caseId: 'c1', created: true } }));
        });
    });
    await new Promise<void>(ok => server.listen(0, '127.0.0.1', () => ok()));
    process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const input = { type: 'ledger_mismatch' as const, dedupKey: 'p5:outbox:1', severity: 'warning' as const, subject: { userId: String(a._id) }, summary: 'test' };
    for (let i = 0; i < 5; i++) await outbox.openSupportCase(input);
    check('support down: the case is queued once, whatever the repeats', await outbox.SupportCaseOutbox.countDocuments({ deliveredAt: null }) === 1);
    check('support down: nothing delivered while it is down', (await outbox.flushSupportCaseOutbox(new Date(Date.now() + 120_000))) === 0 && !received.length);
    mode = 'up';
    const delivered = await outbox.flushSupportCaseOutbox(new Date(Date.now() + 3600_000));
    check('support back: the queued case arrives once', delivered === 1 && received.length === 1 && received[0] === 'p5:outbox:1');
    check('…and is marked delivered', await outbox.SupportCaseOutbox.countDocuments({ deliveredAt: null }) === 0);
    mode = 'bad';
    await outbox.openSupportCase({ ...input, dedupKey: 'p5:outbox:bad' });
    check('a 4xx (bad input) is not queued', !(await outbox.SupportCaseOutbox.exists({ dedupKey: 'p5:outbox:bad' })));
    server.close();

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
