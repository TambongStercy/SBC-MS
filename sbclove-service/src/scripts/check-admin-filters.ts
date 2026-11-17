/**
 * Asserts the admin filters ?country, ?from, ?to (admin plan, phase 3) on the
 * SBC Love admin endpoints:
 *  - profiles / members: profile createdAt; the member's country;
 *  - reports: report createdAt; the REPORTED member's country;
 *  - stats: every figure (profiles by createdAt + owner's country, matches and
 *    interests involving a member of the country, open reports by reported
 *    member).
 *
 * user-service is replaced by a stubbed country resolver. Uses its own
 * database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import LoveProfileModel from '../database/models/love-profile.model';
import MatchModel from '../database/models/match.model';
import InterestModel from '../database/models/interest.model';
import ReportModel from '../database/models/report.model';
import { Intention, ProfileStatus, ContactChoice, ReportStatus } from '../types/sbclove.enums';
import { userServiceClient } from '../services/clients/user.service.client';
import { setCountryResolverForTests } from '../utils/country-members';
import { parseAdminFilters } from '../utils/admin-filters';
import { adminService } from '../services/admin.service';
import { adminController } from '../api/controllers/admin.controller';

const DB = process.env.FILTERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_sbclove_filters_check';

const cm1 = new Types.ObjectId();
const cm2 = new Types.ObjectId();
const bj1 = new Types.ObjectId();

setCountryResolverForTests(async (code) => {
    if (code === 'GA') throw new Error('user-service down');
    if (code === 'CM') return [cm1.toString(), cm2.toString(), new Types.ObjectId().toString()];
    if (code === 'BJ') return [bj1.toString()];
    return [];
});
// No network in this check.
(userServiceClient as any).getUsersByIds = async () => [];
(userServiceClient as any).searchMemberIds = async () => [cm1.toString(), bj1.toString()];

const f = (q: Record<string, string>) => parseAdminFilters(q);
const setCreatedAt = (model: mongoose.Model<any>, _id: Types.ObjectId, at: string) =>
    model.collection.updateOne({ _id }, { $set: { createdAt: new Date(at) } });

async function call(handler: (req: any, res: any, next: any) => Promise<void>, query: Record<string, string>) {
    const out: { status?: number; body?: any; error?: any } = {};
    const res: any = {
        status(code: number) { out.status = code; return res; },
        json(body: any) { out.body = body; return res; },
    };
    await handler({ params: {}, query, body: {} }, res, (err: any) => { out.error = err; });
    return out;
}

async function main() {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    // Let the index builds finish now, or one lands after the final drop.
    await Promise.all([LoveProfileModel, MatchModel, InterestModel, ReportModel].map(m => (m as mongoose.Model<any>).init()));

    const profile = async (userId: Types.ObjectId, status: ProfileStatus, at: string) => {
        const p = await LoveProfileModel.create({ userId, displayName: `p${userId.toString().slice(-4)}`, intention: Intention.GET_ACQUAINTED, description: 'Bonjour', status });
        await setCreatedAt(LoveProfileModel, p._id, at);
        return p;
    };
    const pCm1 = await profile(cm1, ProfileStatus.APPROVED, '2026-01-10T00:00:00Z');
    await profile(cm2, ProfileStatus.PENDING, '2026-02-10T00:00:00Z');
    const pBj1 = await profile(bj1, ProfileStatus.APPROVED, '2026-01-15T00:00:00Z');

    const match = async (a: Types.ObjectId, b: Types.ObjectId, at: string, conversationId?: string) => {
        const m = await MatchModel.create({
            userA: a, userB: b, conversationId,
            participants: [{ userId: a, choice: ContactChoice.PENDING }, { userId: b, choice: ContactChoice.PENDING }],
        });
        await setCreatedAt(MatchModel, m._id, at);
    };
    await match(cm1, bj1, '2026-01-20T00:00:00Z');
    await match(cm1, cm2, '2026-02-20T00:00:00Z', 'conv1');

    const interest = async (from: Types.ObjectId, to: Types.ObjectId, at: string) => {
        const i = await InterestModel.create({ fromUserId: from, toUserId: to, sessionDate: at.slice(0, 10) });
        await setCreatedAt(InterestModel, i._id, at);
    };
    await interest(bj1, cm1, '2026-01-18T00:00:00Z');
    await interest(cm2, cm1, '2026-02-18T00:00:00Z');

    const report = async (reporter: Types.ObjectId, reportedProfile: typeof pCm1, at: string) => {
        const r = await ReportModel.create({ reporterId: reporter, reportedUserId: reportedProfile.userId, reportedProfileId: reportedProfile._id, reason: 'x', status: ReportStatus.OPEN });
        await setCreatedAt(ReportModel, r._id, at);
    };
    await report(bj1, pCm1, '2026-01-25T00:00:00Z');
    await report(cm1, pBj1, '2026-02-25T00:00:00Z');

    // Profiles and members: member's country, profile createdAt.
    const profiles = async (q: Record<string, string>, search?: string) => (await adminService.listProfiles(undefined, 50, 0, search, f(q))).total;
    const members = async (q: Record<string, string>) => (await adminService.listMembers(undefined, 50, 0, undefined, f(q))).total;
    assert.strictEqual(await profiles({}), 3);
    assert.strictEqual(await profiles({ country: 'cm' }), 2);
    assert.strictEqual(await profiles({ country: 'BJ' }), 1);
    assert.strictEqual(await profiles({ country: 'SN' }), 0);
    assert.strictEqual(await profiles({ from: '2026-02-01' }), 1);
    assert.strictEqual(await profiles({ country: 'CM', to: '2026-01-31' }), 1);
    assert.strictEqual(await profiles({ country: 'CM' }, 'zzz'), 1, 'search ∩ country');
    assert.strictEqual(await members({ country: 'CM' }), 2);
    assert.strictEqual(await members({ to: '2026-01-15' }), 2);

    // Reports: reported member's country, report createdAt.
    const reports = async (q: Record<string, string>) => (await adminService.listReports(undefined, 50, 0, f(q))).total;
    assert.strictEqual(await reports({}), 2);
    assert.strictEqual(await reports({ country: 'CM' }), 1);
    assert.strictEqual(await reports({ country: 'BJ' }), 1);
    assert.strictEqual(await reports({ from: '2026-02-01' }), 1);

    // Stats: every figure.
    const all = await adminService.getStats({});
    assert.deepStrictEqual([all.profiles.total, all.matches.total, all.interests.total, all.reports.open], [3, 2, 2, 2]);
    const cm = await adminService.getStats(f({ country: 'CM' }));
    assert.deepStrictEqual([cm.profiles.total, cm.profiles.pending, cm.matches.total, cm.interests.total, cm.reports.open], [2, 1, 2, 2, 1]);
    const bj = await adminService.getStats(f({ country: 'BJ' }));
    assert.deepStrictEqual([bj.profiles.total, bj.matches.total, bj.matches.conversations, bj.interests.total, bj.reports.open], [1, 1, 0, 1, 1]);
    const feb = await adminService.getStats(f({ from: '2026-02-01', to: '2026-02-28' }));
    assert.deepStrictEqual([feb.profiles.total, feb.matches.total, feb.matches.conversations, feb.interests.total, feb.reports.open], [1, 1, 1, 1, 1]);
    const none = await adminService.getStats(f({ country: 'SN' }));
    assert.deepStrictEqual([none.profiles.total, none.matches.total, none.interests.total, none.reports.open], [0, 0, 0, 0]);

    // Controllers: 400 on bad input, 502 when user-service fails, shape unchanged.
    let r = await call(adminController.listProfiles.bind(adminController), { country: 'zz9' });
    assert.strictEqual(r.status, 400);
    r = await call(adminController.getStats.bind(adminController), { from: '16/11/2026' });
    assert.strictEqual(r.status, 400);
    r = await call(adminController.listMembers.bind(adminController), { country: 'GA' });
    assert.strictEqual(r.status, 502);
    assert.match(r.body.message, /Filtre pays indisponible/);
    r = await call(adminController.listReports.bind(adminController), { country: 'BJ' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pagination.total, 1);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('OK sbclove admin filters (profiles, members, reports, stats)');
}

main().catch(async (error) => {
    console.error('FAIL', error);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
