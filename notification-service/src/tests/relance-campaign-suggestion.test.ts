/**
 * The campaign a parrain is pointed to (Rufus, 2026-10-05): relance des
 * nouveaux only takes filleuls in the 2 hours after signup, so 33 of the 34
 * parrains with credits on prod had nothing to send. A parrain with credits
 * and no campaign running is shown the last 30 days if they have unpaid
 * filleuls there, else their busiest month of the past year, else nothing.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
const getReferralsForCampaign = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { getReferralsForCampaign: (...a: unknown[]) => getReferralsForCampaign(...a) },
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import relanceRoutes from '../api/routes/relance.routes';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus } from '../database/models/relance-target.model';
import CampaignModel, { CampaignStatus, CampaignType } from '../database/models/relance-campaign.model';
import { suggestCampaign } from '../services/relance-campaign-targets.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_suggestion_test';
const DAY = 86400_000;
const NOW = new Date('2026-10-05T10:00:00Z');
const oid = () => new mongoose.Types.ObjectId().toString();
const ref = (daysAgo: number, paid = false) => ({ _id: oid(), createdAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), activeSubscriptionTypes: paid ? ['CLASSIQUE'] : [] });

let server: http.Server;
let base: string;

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const app = express();
    app.use(express.json());
    app.use('/api/relance', relanceRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    server?.close();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});
beforeEach(async () => {
    await Promise.all([RelanceConfigModel.deleteMany({}), RelanceTargetModel.deleteMany({}), CampaignModel.deleteMany({})]);
    getReferralsForCampaign.mockReset();
});

describe('which range is suggested', () => {
    it('the last 30 days when there are unpaid filleuls there', async () => {
        const parrain = oid();
        getReferralsForCampaign.mockResolvedValue([ref(3), ref(20), ref(25, true), ref(90), ref(95)]);
        const s = await suggestCampaign(parrain, 3000, NOW);
        expect(s).toMatchObject({ period: '30d', count: 2 });
        expect(new Date(s!.from).getTime()).toBe(NOW.getTime() - 30 * DAY);
    });

    it('otherwise the busiest month of the past year', async () => {
        const parrain = oid();
        // 3 in early July 2026, 1 in August, none in the last 30 days.
        getReferralsForCampaign.mockResolvedValue([ref(92), ref(93), ref(94), ref(60), ref(400)]);
        const s = await suggestCampaign(parrain, 3000, NOW);
        expect(s).toMatchObject({ period: 'custom', count: 3 });
        expect(s!.from).toBe('2026-07-01T00:00:00.000Z');
        expect(s!.to).toBe('2026-07-31T23:59:59.999Z');
    });

    it('nothing when every filleul has paid or is already in relance', async () => {
        const parrain = oid();
        const inLoop = ref(5);
        await RelanceTargetModel.create({ referralUserId: inLoop._id, referrerUserId: parrain, nextMessageDue: NOW, status: TargetStatus.ACTIVE, language: 'fr' });
        getReferralsForCampaign.mockResolvedValue([inLoop, ref(10, true), ref(40, true)]);
        expect(await suggestCampaign(parrain, 3000, NOW)).toBeNull();
    });

    it('says how many the credits can relance', async () => {
        const parrain = oid();
        getReferralsForCampaign.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ref(i + 1)));
        const s = await suggestCampaign(parrain, 35, NOW); // 35 emails = 5 filleuls x 7 days
        expect(s).toMatchObject({ count: 10, affordable: 5 });
    });
});

describe('GET /api/relance/campaigns/suggestion', () => {
    const get = async (userId: string) => {
        const token = jwt.sign({ userId, id: userId, email: 'p@example.com', role: 'user' }, config.jwt.secret, { expiresIn: '1h' });
        const r = await fetch(`${base}/api/relance/campaigns/suggestion`, { headers: { Authorization: `Bearer ${token}` } });
        return { status: r.status, json: await r.json() as any };
    };

    it('suggests to a parrain with credits and no campaign', async () => {
        const parrain = oid();
        await RelanceConfigModel.create({ userId: parrain, emailBalance: 3000 });
        getReferralsForCampaign.mockResolvedValue([ref(2), ref(8)]);
        const r = await get(parrain);
        expect(r.status).toBe(200);
        expect(r.json.data).toMatchObject({ period: '30d', count: 2 });
    });

    it('stays quiet without email credits, or while a campaign is running', async () => {
        const broke = oid();
        await RelanceConfigModel.create({ userId: broke, emailBalance: 0 });
        getReferralsForCampaign.mockResolvedValue([ref(2)]);
        expect((await get(broke)).json.data).toBeNull();

        const busy = oid();
        await RelanceConfigModel.create({ userId: busy, emailBalance: 3000 });
        await CampaignModel.create({ userId: busy, createdBy: busy, name: 'En cours', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE });
        expect((await get(busy)).json.data).toBeNull();
        expect(getReferralsForCampaign).not.toHaveBeenCalled();
    });
});
