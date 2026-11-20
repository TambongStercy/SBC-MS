/**
 * A filleul who pays leaves every relance journey at once, and each parrain
 * hears « X vient de payer » once.
 *
 * Le Futuriste, 2026-11-17: new filleuls sat in his campaign and in relance des
 * nouveaux. Payment closed only the campaign journey (with the commission and
 * the push); a week later the sender found the other journey "paid" and pushed
 * again, so it looked like a payment with no commission.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const pushFilleulPaid = jest.fn();
jest.mock('../services/relance-alerts.service', () => ({
    pushFilleulPaid: (...a: unknown[]) => pushFilleulPaid(...a),
    pushCreditsLow: jest.fn(),
    pushCreditsExhausted: jest.fn(),
}));

import mongoose from 'mongoose';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import { exitPaidReferral } from '../services/relance-paid-exit.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_paid_exit_test';
const parrain = new mongoose.Types.ObjectId();

const journey = (filleul: mongoose.Types.ObjectId, campaignId?: mongoose.Types.ObjectId, over: Record<string, unknown> = {}) =>
    RelanceTargetModel.create({
        referralUserId: filleul, referrerUserId: parrain, campaignId,
        status: TargetStatus.ACTIVE, currentDay: 1, nextMessageDue: new Date(), ...over,
    } as any);

beforeAll(async () => { await mongoose.connect(MONGO); });
afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
beforeEach(async () => { await RelanceTargetModel.deleteMany({}); pushFilleulPaid.mockClear(); });

it('closes the campaign journey AND relance des nouveaux, and pushes once', async () => {
    const filleul = new mongoose.Types.ObjectId();
    await journey(filleul, new mongoose.Types.ObjectId());
    await journey(filleul, undefined, { currentDay: 0 });

    expect(await exitPaidReferral(filleul)).toBe(2);

    const left = await RelanceTargetModel.find({ referralUserId: filleul }).lean();
    expect(left.every(t => t.status === TargetStatus.COMPLETED && t.exitReason === ExitReason.PAID)).toBe(true);
    expect(pushFilleulPaid).toHaveBeenCalledTimes(1);
    expect(pushFilleulPaid).toHaveBeenCalledWith(String(parrain), String(filleul));
});

it('a paused journey is closed too', async () => {
    const filleul = new mongoose.Types.ObjectId();
    await journey(filleul, undefined, { status: TargetStatus.PAUSED });
    expect(await exitPaidReferral(filleul)).toBe(1);
    expect((await RelanceTargetModel.findOne({ referralUserId: filleul }).lean())?.status).toBe(TargetStatus.COMPLETED);
});

it('a journey found open days later is closed without a second « vient de payer »', async () => {
    const filleul = new mongoose.Types.ObjectId();
    // Already announced at payment time (the old code closed only this one).
    await journey(filleul, new mongoose.Types.ObjectId(), {
        status: TargetStatus.COMPLETED, exitReason: ExitReason.PAID, exitedLoopAt: new Date(Date.now() - 7 * 86400000),
    });
    await journey(filleul);

    expect(await exitPaidReferral(filleul)).toBe(1);
    expect(pushFilleulPaid).not.toHaveBeenCalled();
});

it('nothing open: nothing changes, no push', async () => {
    expect(await exitPaidReferral(new mongoose.Types.ObjectId())).toBe(0);
    expect(pushFilleulPaid).not.toHaveBeenCalled();
});
