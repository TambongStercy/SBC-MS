/**
 * Asserts that a day can be verified more than once.
 *
 * A status can only ever back one campaign day — but "one day" must include the
 * same day being checked again. Folding a day's own previous match into the
 * off-limits set made re-verification impossible: the status was sitting on the
 * account and the service reported it had found nothing.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-reverify.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import { ExtractionResult } from '../services/whatsapp-status.service';
import * as mediaHash from '../services/media-hash.service';

const DB = process.env.REVERIFY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_reverify_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

// The creative check needs bytes we do not have here; treat media as matching so
// the assertions isolate status claiming.
(mediaHash as any).perceptualHash = async () => 'ffffffffffffffff';
(mediaHash as any).hammingDistance = () => 0;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyExtraction } = require('../services/verification.service');

const TRACKING = 'abc123xyz9';

const extraction = (statusId: string, views: number, postedAt: Date): ExtractionResult => ({
    statuses: [{
        statusMessageId: statusId,
        postedAt,
        mediaType: 'image',
        caption: `Venez voir https://sbc.test/s/${TRACKING}`,
        viewCount: views,
        deliveredCount: views * 3,
    }],
    lid: 'lid-1',
    phone: '237600000000',
} as unknown as ExtractionResult);

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne', mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `rv${Date.now()}`,
        amountPaid: 6000, pricePerUniqueView: 3, targetUniqueViews: 2000,
        status: CampaignStatus.ACTIVE,
    });

    const postedAt = new Date();
    const participation = await CampaignParticipationModel.create({
        campaignId: campaign._id,
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode: TRACKING,
        status: ParticipationStatus.IN_PROGRESS,
        acceptedAt: postedAt,
        days: [1, 2, 3].map(day => ({
            day, status: day === 1 ? DayStatus.POSTED : DayStatus.PENDING,
            viewCount: 0, deliveredCount: 0, ratePerView: 1, earnedAmount: 0,
            ...(day === 1 ? { postedAt } : {}),
        })),
    });

    // --- First verification ---
    const first = await applyExtraction(participation._id, extraction('STATUS-1', 13, postedAt));
    check('day 1 is accepted', first[0]?.accepted === true, first[0]?.reason ?? '');
    check('with the real view count', first[0]?.viewCount === 13, `${first[0]?.viewCount}`);

    let fresh = (await CampaignParticipationModel.findById(participation._id))!;
    check('the status is recorded against the day', fresh.days[0].statusMessageId === 'STATUS-1');

    // --- Re-verify the same day, same status ---
    fresh.days[0].status = DayStatus.POSTED;
    await fresh.save();

    const again = await applyExtraction(participation._id, extraction('STATUS-1', 17, postedAt));
    check(
        're-verifying the same day still matches its own status',
        again[0]?.accepted === true,
        again[0]?.accepted ? '' : `REGRESSION: ${again[0]?.reason}`,
    );
    check('and picks up the newer view count', again[0]?.viewCount === 17, `${again[0]?.viewCount}`);

    // --- One status cannot back two different days ---
    fresh = (await CampaignParticipationModel.findById(participation._id))!;
    fresh.days[0].status = DayStatus.POSTED;
    fresh.days[1].status = DayStatus.POSTED;
    fresh.days[1].postedAt = new Date(postedAt.getTime() + 25 * 60 * 60 * 1000);
    await fresh.save();

    const both = await applyExtraction(participation._id, extraction('STATUS-1', 20, postedAt));
    const accepted = both.filter((v: { accepted: boolean }) => v.accepted);
    check(
        'a single status cannot satisfy two days',
        accepted.length === 1,
        `${accepted.length} day(s) accepted from one status`,
    );

    // --- Another diffuseur's status stays off-limits ---
    await CampaignParticipationModel.create({
        campaignId: campaign._id,
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode: 'other12345',
        status: ParticipationStatus.IN_PROGRESS,
        days: [{
            day: 1, status: DayStatus.VERIFIED, statusMessageId: 'STATUS-STOLEN',
            viewCount: 5, deliveredCount: 5, ratePerView: 1, earnedAmount: 5,
        }],
    });

    // Only day 3 is up for judgement here, written directly so the earlier steps
    // cannot leave the other days in a state that muddies the assertion.
    await CampaignParticipationModel.updateOne(
        { _id: participation._id },
        {
            $set: {
                'days.0.status': DayStatus.VERIFIED,
                'days.1.status': DayStatus.VERIFIED,
                'days.2.status': DayStatus.POSTED,
                'days.2.postedAt': new Date(postedAt.getTime() + 50 * 60 * 60 * 1000),
            },
        },
    );

    const stolen = await applyExtraction(participation._id, extraction('STATUS-STOLEN', 99, postedAt));
    const day3 = stolen.find((v: { day: number }) => v.day === 3);
    check(
        "another participation's status cannot be reused",
        day3?.accepted === false,
        'otherwise one status could be sold to several campaigns',
    );

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
