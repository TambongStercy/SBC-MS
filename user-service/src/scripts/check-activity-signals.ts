import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { UserGeoDayModel } from '../database/models/user-geo-day.model';
import { doualaDay, ingestActivityBatch, ipRange, recomputeUsualCountries } from '../services/activity-signals.service';

/**
 * Asserts the user-service side of Security plan Phase 1 (signals): batches
 * from the gateway are stored only for members who accepted the policy version
 * that announces them, counts add up across batches, lists stay capped, the
 * 180-day expiry is set, the member's last activity/country follow, and the
 * nightly usual country needs 15 distinct active days.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-activity-signals.ts
 */
const DB = process.env.SIGNALS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_signals_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    process.env.SIGNALS_POLICY_VERSION = '2026-12';
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await UserGeoDayModel.syncIndexes();

    const consent = (version: string) => ({ privacy: { acceptedAt: new Date(), version }, dataTransfer: { acceptedAt: new Date(), version } });
    const yes = await UserModel.create({ name: 'Oui', email: 'oui@gmail.com', phoneNumber: '237677000001', password: 'Secret123!', country: 'CM', referralCode: 'SIG1', consents: consent('2026-12') } as any);
    const old = await UserModel.create({ name: 'Ancien', email: 'old@gmail.com', phoneNumber: '237677000002', password: 'Secret123!', country: 'CM', referralCode: 'SIG2', consents: consent('2026-11') } as any);
    const none = await UserModel.create({ name: 'Rien', email: 'none@gmail.com', phoneNumber: '237677000003', password: 'Secret123!', country: 'CM', referralCode: 'SIG3' } as any);
    const Y = String(yes._id);

    const rec = (userId: string, extra: object = {}) => ({
        userId, day: '2026-11-21', country: 'CM', requests: 3, sources: { web: 2, app: 1 },
        asns: [30992], ipRanges: ['102.244.33.0/24'], devices: ['dev-1234-abcd'],
        firstAt: '2026-11-21T08:00:00Z', lastAt: '2026-11-21T09:00:00Z', ...extra,
    });

    const r1 = await ingestActivityBatch([rec(Y), rec(String(old._id)), rec(String(none._id))]);
    check('only the member who accepted the 2026-12 policy is stored', r1.stored === 1 && r1.skippedNoConsent === 2 && await UserGeoDayModel.countDocuments() === 1, JSON.stringify(r1));
    check('a member on the older policy gets no lastActiveAt either', !(await UserModel.findById(old._id).lean())!.lastActiveAt);

    await ingestActivityBatch([rec(Y, { requests: 2, sources: { api: 2 }, devices: ['dev-5678-efgh'], ipRanges: ['102.244.34.0/24'], lastAt: '2026-11-21T18:00:00Z', firstAt: '2026-11-21T17:00:00Z' })]);
    const d = (await UserGeoDayModel.findOne({ userId: yes._id }).lean())!;
    check('a second batch adds up (one document per member/day/country)',
        await UserGeoDayModel.countDocuments() === 1 && d.requests === 5 && d.sources.web === 2 && d.sources.app === 1 && d.sources.api === 2, JSON.stringify(d.sources));
    check('device and range lists merge without duplicates',
        d.devices.length === 2 && d.ipRanges.length === 2 && d.asns.length === 1);
    check('first/last seen widen correctly',
        d.firstAt.toISOString() === '2026-11-21T08:00:00.000Z' && d.lastAt.toISOString() === '2026-11-21T18:00:00.000Z');
    const days = (d.expiresAt.getTime() - Date.UTC(2026, 10, 21)) / 86400000;
    check('the record expires 180 days after its day (TTL index)', days === 180, String(days));
    const ttl = (await UserGeoDayModel.collection.indexes()).find(i => i.key.expiresAt === 1);
    check('the TTL index exists', ttl?.expireAfterSeconds === 0);

    const many = Array.from({ length: 12 }, (_, i) => `device-${i}-abcdef`);
    await ingestActivityBatch([rec(Y, { devices: many, ipRanges: many.map((_, i) => `41.82.${i}.0/24`) })]);
    const capped = (await UserGeoDayModel.findOne({ userId: yes._id }).lean())!;
    check('lists stay capped at 5', capped.devices.length === 5 && capped.ipRanges.length === 5);

    await ingestActivityBatch([rec(Y, { requests: 'x', devices: ['<script>'], ipRanges: ['not a range!'], country: 'zz9', userId: 'nope' }), { userId: Y } as any]);
    check('malformed rows are ignored', (await UserGeoDayModel.countDocuments()) === 1);

    let u = (await UserModel.findById(yes._id).lean())!;
    check('lastActiveAt and geo.lastCountry follow the latest activity',
        u.lastActiveAt?.toISOString() === '2026-11-21T18:00:00.000Z' && u.geo?.lastCountry === 'CM');
    await ingestActivityBatch([rec(Y, { country: 'FR', lastAt: '2026-11-21T07:00:00Z', firstAt: '2026-11-21T07:00:00Z' })]);
    u = (await UserModel.findById(yes._id).lean())!;
    check('an older batch arriving late moves neither lastActiveAt nor the last country back',
        u.lastActiveAt?.toISOString() === '2026-11-21T18:00:00.000Z' && u.geo?.lastCountry === 'CM', u.geo?.lastCountry);

    await ingestActivityBatch([rec(Y, { requests: 0, logins: 1, sources: {}, lastAt: '2026-11-21T19:00:00Z', firstAt: '2026-11-21T19:00:00Z' })]);
    u = (await UserModel.findById(yes._id).lean())!;
    check('a sign-in counts in the day and sets lastLoginAt',
        (await UserGeoDayModel.findOne({ userId: yes._id }).lean())!.logins === 1 && u.lastLoginAt?.toISOString() === '2026-11-21T19:00:00.000Z');

    // --- usual country ---
    const now = new Date('2026-11-25T03:30:00Z');
    const day = (n: number) => doualaDay(new Date(now.getTime() - n * 86400000));
    await UserGeoDayModel.deleteMany({});
    await ingestActivityBatch([
        ...Array.from({ length: 12 }, (_, i) => rec(Y, { day: day(i + 1), country: 'CM' })),
        ...[2, 13, 14, 15].map(n => rec(Y, { day: day(n), country: 'FR' })), // day 2 in both: counted once
        rec(Y, { day: day(40), country: 'US' }), // older than 30 days: ignored
    ]);
    await recomputeUsualCountries(now);
    u = (await UserModel.findById(yes._id).lean())!;
    check('15 distinct active days: usual country = most active, share of active days', u.geo?.usualCountry === 'CM' && u.geo?.usualShare === 0.8, `${u.geo?.usualCountry} ${u.geo?.usualShare}`);
    await UserGeoDayModel.deleteMany({});
    await ingestActivityBatch([...Array.from({ length: 13 }, (_, i) => rec(Y, { day: day(i + 1), country: 'SN' })), rec(Y, { day: day(1), country: 'CM' }), rec(Y, { day: day(14), country: 'CM' })]);
    await recomputeUsualCountries(now);
    u = (await UserModel.findById(yes._id).lean())!;
    check('14 distinct active days (even with 15 country-days): no usual country', u.geo?.usualCountry === null, String(u.geo?.usualCountry));

    check('ipRange: /24 for IPv4, /48 for IPv6, mapped IPv4 handled',
        ipRange('102.244.33.7') === '102.244.33.0/24' && ipRange('2a02:c207:2054:1234::1') === '2a02:c207:2054::/48' && ipRange('::ffff:41.82.1.9') === '41.82.1.0/24' && ipRange('junk') === null);
    check('Douala day: 23:30 UTC is already the next day', doualaDay(new Date('2026-11-20T23:30:00Z')) === '2026-11-21');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
