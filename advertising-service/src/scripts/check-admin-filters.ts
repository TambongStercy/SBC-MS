/**
 * Asserts the admin filters `?country=`, `?from=`, `?to=` (admin plan, phase 3)
 * on every admin list / dashboard figure of the Ads network.
 *
 * Country is the ANNONCEUR's for campaigns (and what hangs off them: paid out,
 * media changes, in flight), the DIFFUSEUR's for diffuseur profiles and video
 * proofs. user-service is stubbed (setCountryMembersResolver).
 *
 * Own database, dropped at the end. Profile lookups go to USER_SERVICE_URL; point
 * it nowhere so they fail fast (they are best-effort in every handler):
 *
 *   USER_SERVICE_URL=http://127.0.0.1:9 npx ts-node src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import ManualVerificationModel, { ManualVerificationStatus } from '../database/models/manual-verification.model';
import { overview, monthlySeries, inFlight } from '../services/analytics.service';
import { listForReview, listDiffuseurs, listMediaChanges, getAnalytics } from '../api/controllers/admin.controller';
import { listPending } from '../api/controllers/manual-verification.controller';
import { setCountryMembersResolver } from '../utils/country-members';
import { AuthenticatedRequest } from '../api/middleware/auth.middleware';
import { Response } from 'express';

const DB = process.env.FILTERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_filters_check';

const A = new Types.ObjectId();   // annonceur, CM
const B = new Types.ObjectId();   // annonceur, BJ
const D1 = new Types.ObjectId();  // diffuseur, CM
const D2 = new Types.ObjectId();  // diffuseur, BJ
const MEMBERS: Record<string, Types.ObjectId[]> = { CM: [A, D1], BJ: [B, D2] };

const now = new Date();
const y2025 = { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-12-31T23:59:59.999Z') };

type Captured = { statusCode: number; body: any };
const call = async (
    handler: (req: AuthenticatedRequest, res: Response) => unknown,
    query: Record<string, string> = {},
): Promise<Captured> => {
    const out: Captured = { statusCode: 200, body: undefined };
    const res = {
        status(code: number) { out.statusCode = code; return this; },
        json(body: unknown) { out.body = body; return this; },
    } as unknown as Response;
    const req = { query, user: { userId: String(new Types.ObjectId()), role: 'admin' } } as unknown as AuthenticatedRequest;
    await handler(req, res);
    return out;
};

let n = 0;
const campaign = async (advertiserUserId: Types.ObjectId, status: CampaignStatus, amountPaid: number,
    createdAt: Date, over: Record<string, unknown> = {}) => {
    const c = await CampaignModel.create({
        advertiserUserId, title: `C${n}`, mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `af${n++}${Date.now()}`,
        amountPaid, pricePerUniqueView: 3, targetUniqueViews: 1000,
        uniqueViewsDelivered: 10, repeatViewsDelivered: 0, clicksTotal: 1,
        status, ...over,
    });
    await CampaignModel.collection.updateOne({ _id: c._id }, { $set: { createdAt } });
    return c;
};

const participation = (campaignId: Types.ObjectId, diffuseurUserId: Types.ObjectId, status: ParticipationStatus,
    over: Record<string, unknown> = {}) =>
    CampaignParticipationModel.create({
        campaignId, diffuseurUserId, diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `fc${n++}${Date.now()}`, status, ...over,
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    setCountryMembersResolver(async c => (MEMBERS[c] ?? []).map(String));

    const c1 = await campaign(A, CampaignStatus.ACTIVE, 6000, now, {
        activatedAt: now, pendingMedia: { fileId: 'n1', type: 'image', submittedAt: now },
    });
    await campaign(A, CampaignStatus.COMPLETED, 4000, new Date('2025-03-01'), { activatedAt: new Date('2025-03-10') });
    const c3 = await campaign(B, CampaignStatus.BANKED, 9000, now, { activatedAt: now });
    await campaign(A, CampaignStatus.PAID, 3000, now);
    await campaign(B, CampaignStatus.PENDING_REVIEW, 0, new Date('2025-02-01'));
    await campaign(B, CampaignStatus.ACTIVE, 1000, new Date('2025-02-01'), {
        activatedAt: new Date('2025-02-05'),
        pendingMedia: { fileId: 'n2', type: 'image', submittedAt: new Date('2025-02-05') },
    });

    const d1 = await DiffuseurProfileModel.create({ userId: D1, declaredAverageViews: 100 });
    const d2 = await DiffuseurProfileModel.create({ userId: D2, declaredAverageViews: 200 });
    await DiffuseurProfileModel.collection.updateOne({ _id: d2._id }, { $set: { createdAt: new Date('2025-01-15') } });
    void d1;

    const p1 = await participation(c1._id, D1, ParticipationStatus.COMPLETED, { totalEarned: 1000, creditedAt: now });
    await participation(c3._id, D2, ParticipationStatus.COMPLETED, { totalEarned: 2000, creditedAt: new Date('2025-03-20') });
    await participation(c1._id, D2, ParticipationStatus.IN_PROGRESS);
    await participation(c3._id, D1, ParticipationStatus.OFFERED);

    const mv = (diffuseurUserId: Types.ObjectId, uploadedAt: Date) => ManualVerificationModel.create({
        participationId: p1._id, campaignId: c1._id, diffuseurUserId, day: 1, code: '123456',
        codeIssuedAt: uploadedAt, expiresAt: new Date(uploadedAt.getTime() + 3600_000),
        status: ManualVerificationStatus.PENDING_REVIEW, uploadedAt,
    });
    await mv(D1, now);
    await mv(D2, new Date('2025-02-10'));

    // --- Dashboard figures (services) ---
    const all = await overview();
    assert.strictEqual(all.money.revenue, 20000);
    assert.strictEqual(all.money.paidToDiffuseurs, 3000);
    assert.strictEqual(all.diffuseurs.total, 2);

    const cm = await overview({ country: 'CM' });
    assert.strictEqual(cm.money.revenue, 10000, 'CM revenue = annonceur A only');
    assert.strictEqual(cm.annonceurs.total, 1);
    assert.strictEqual(cm.money.paidToDiffuseurs, 1000, 'paid out on CM annonceurs\' campaigns');
    assert.strictEqual(cm.money.grossMargin, 9000);
    assert.strictEqual(cm.diffuseurs.total, 1, 'diffuseurs by the diffuseur\'s country');
    assert.deepStrictEqual(cm.campaigns.byStatus, { active: 1, completed: 1, paid: 1 });

    const bj = await overview({ country: 'BJ' });
    assert.strictEqual(bj.money.revenue, 10000);
    assert.strictEqual(bj.money.paidToDiffuseurs, 2000);

    const y = await overview(y2025);
    assert.strictEqual(y.money.revenue, 5000, 'activatedAt in 2025: 4000 + 1000');
    assert.strictEqual(y.annonceurs.total, 2);
    assert.strictEqual(y.money.paidToDiffuseurs, 2000, 'creditedAt in 2025');
    assert.strictEqual(y.diffuseurs.total, 1, 'profile createdAt in 2025');
    assert.deepStrictEqual(y.campaigns.byStatus, { completed: 1, pending_review: 1, active: 1 });

    const none = await overview({ country: 'XX' });
    assert.strictEqual(none.money.revenue, 0);
    assert.strictEqual(none.diffuseurs.total, 0);
    assert.deepStrictEqual(none.campaigns.byStatus, {});

    const series = await monthlySeries(12, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-03-31T23:59:59.999Z') });
    assert.deepStrictEqual(series.map(s => s.month), ['2025-01', '2025-02', '2025-03'], 'buckets follow from/to');
    assert.strictEqual(series[2].revenue, 4000);
    assert.strictEqual(series[2].paidToDiffuseurs, 2000);
    assert.strictEqual(series[1].revenue, 1000);
    assert.strictEqual(series[0].newDiffuseurs, 1);
    const seriesCm = await monthlySeries(12, { country: 'CM', from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-03-31T23:59:59.999Z') });
    assert.strictEqual(seriesCm[2].revenue, 4000);
    assert.strictEqual(seriesCm[2].paidToDiffuseurs, 0, 'the 2025 payout was on a BJ campaign');
    assert.strictEqual(seriesCm[1].revenue, 0);
    assert.strictEqual((await monthlySeries(12)).length, 12, 'no dates: unchanged window');

    assert.deepStrictEqual(await inFlight({ country: 'CM' }), { inProgress: 1, offered: 0 });
    assert.deepStrictEqual(await inFlight({ country: 'BJ' }), { inProgress: 0, offered: 1 });

    // --- Admin handlers ---
    const total = (r: Captured) => r.body.pagination.total as number;

    assert.strictEqual(total(await call(listForReview)), 2, 'default queue: paid + pending_review');
    assert.strictEqual(total(await call(listForReview, { country: 'cm' })), 1, 'country is case-insensitive');
    assert.strictEqual(total(await call(listForReview, { from: '2025-01-01', to: '2025-12-31' })), 1);
    assert.strictEqual(total(await call(listForReview, { country: 'CM', from: '2025-01-01', to: '2025-12-31' })), 0);
    assert.strictEqual(total(await call(listForReview, { country: 'ALL' })), 2);
    assert.strictEqual(total(await call(listForReview, { status: 'active', country: 'BJ' })), 1);

    assert.strictEqual(total(await call(listDiffuseurs)), 2);
    const dCm = await call(listDiffuseurs, { country: 'CM' });
    assert.strictEqual(total(dCm), 1);
    assert.strictEqual(dCm.body.data[0].userId, String(D1));
    assert.strictEqual(total(await call(listDiffuseurs, { from: '2025-01-01', to: '2025-12-31' })), 1);

    assert.strictEqual((await call(listMediaChanges)).body.data.length, 2);
    const mCm = await call(listMediaChanges, { country: 'CM' });
    assert.deepStrictEqual(mCm.body.data.map((c: { _id: unknown }) => String(c._id)), [String(c1._id)]);
    assert.strictEqual((await call(listMediaChanges, { country: 'BJ', to: '2025-12-31' })).body.data.length, 1);
    assert.strictEqual((await call(listMediaChanges, { country: 'CM', to: '2025-12-31' })).body.data.length, 0);

    assert.strictEqual((await call(listPending)).body.data.length, 2);
    assert.strictEqual((await call(listPending, { country: 'BJ' })).body.data.length, 1);
    assert.strictEqual((await call(listPending, { from: now.toISOString().slice(0, 10) })).body.data.length, 1);

    const an = await call(getAnalytics, { country: 'CM' });
    assert.strictEqual(an.body.data.money.revenue, 10000);
    assert.ok(Array.isArray(an.body.data.series) && an.body.data.pipeline, 'shape unchanged');

    // --- Bad input → 400 ---
    for (const h of [listForReview, listDiffuseurs, listMediaChanges, listPending, getAnalytics]) {
        for (const q of [{ country: 'zz9' }, { from: 'hier' }, { from: '2025-02-01', to: '2025-01-01' }] as Record<string, string>[]) {
            const r = await call(h, q);
            assert.strictEqual(r.statusCode, 400, `${h.name} ${JSON.stringify(q)}`);
            assert.strictEqual(r.body.success, false);
        }
    }

    // --- user-service down → 502, never "no filter" ---
    setCountryMembersResolver(async () => { throw new Error('ECONNREFUSED'); });
    for (const h of [listForReview, listDiffuseurs, listMediaChanges, listPending, getAnalytics]) {
        const r = await call(h, { country: 'CM' });
        assert.strictEqual(r.statusCode, 502, h.name);
        assert.strictEqual(r.body.message, 'Filtre pays indisponible : le service utilisateurs ne répond pas.');
    }
    // ...and without a country it is not called at all.
    assert.strictEqual((await call(listForReview)).statusCode, 200);

    // Let the background index builds finish, or one recreates the database after the drop.
    await Promise.all([CampaignModel, CampaignParticipationModel, DiffuseurProfileModel, ManualVerificationModel].map(m => m.init()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('OK admin filters: dashboard, campaigns, diffuseurs, media changes, proofs (country, from/to, 400, 502)');
};

main().catch(async err => {
    console.error('FAILED:', err);
    await mongoose.connection.dropDatabase().catch(() => { });
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
