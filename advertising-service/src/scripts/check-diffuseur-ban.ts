/**
 * Asserts a ban actually stops someone getting paid work.
 *
 * Rufus banned an account for submitting AI-generated proof for the second time
 * (2026-09-06). The ban has to be from the FEATURE, not from SBC — Sterling asked
 * him directly ("Le bannir de SBC ou de la fonctionnalité ?" / "De la
 * fonctionnalité"), so the user account and its balance stay untouched and only
 * the diffuseur side is closed.
 *
 * The trap: that account was holding four IN_PROGRESS participations. A ban that
 * only cleared the profile flag would have left every one of them submittable.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-diffuseur-ban.ts
 */
import mongoose, { Types } from 'mongoose';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import { banDiffuseur, unbanDiffuseur } from '../services/ranking.service';

const DB = process.env.BAN_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_ban_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

let n = 0;
const participation = (userId: Types.ObjectId, status: ParticipationStatus) =>
    CampaignParticipationModel.create({
        campaignId: new Types.ObjectId(),
        diffuseurUserId: userId,
        diffuseurProfileId: new Types.ObjectId(),
        status,
        trackingCode: `b${Date.now()}${n++}`,
        offeredAt: new Date(),
        days: [],
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const userId = new Types.ObjectId();
    const admin = new Types.ObjectId();
    await DiffuseurProfileModel.create({
        userId, declaredAverageViews: 50, hasCompletedTestCampaign: true,
        whatsappLid: 'lid1', isActive: true,
    });

    const offered = await participation(userId, ParticipationStatus.OFFERED);
    const running = await participation(userId, ParticipationStatus.IN_PROGRESS);
    const done = await participation(userId, ParticipationStatus.COMPLETED);

    const noReason = await banDiffuseur(userId, admin, '   ').catch(e => e.message as string);
    check('a ban without a reason is refused', typeof noReason === 'string',
        'bans are repeat-offence judgements; the record has to say what happened');

    const result = await banDiffuseur(userId, admin, 'Preuve générée par IA, 2e fois');

    const profile = await DiffuseurProfileModel.findOne({ userId });
    check('the profile is deactivated', profile?.isActive === false,
        'isActive is what allocation already filters on');
    check('with the reason and author on the record',
        profile?.banReason?.includes('IA') === true && !!profile?.bannedAt && !!profile?.bannedBy);

    check('outstanding offers are withdrawn',
        (await CampaignParticipationModel.findById(offered._id))?.status === ParticipationStatus.EXPIRED,
        `${result.offersWithdrawn} withdrawn`);
    check('work already under way is stopped',
        (await CampaignParticipationModel.findById(running._id))?.status === ParticipationStatus.FORFEITED,
        'else the ban barely bites — the real account held four of these');
    check('completed work is left alone',
        (await CampaignParticipationModel.findById(done._id))?.status === ParticipationStatus.COMPLETED,
        'clawing back credited money is not a moderation decision');

    await unbanDiffuseur(userId);
    const lifted = await DiffuseurProfileModel.findOne({ userId });
    check('a ban can be lifted', lifted?.isActive === true && !lifted?.bannedAt);
    check('and the reason survives the lift', lifted?.banReason?.includes('IA') === true,
        'so a second offence is visible as a second offence');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err.message);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
