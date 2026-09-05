/**
 * Asserts an annonceur who has paid is not trapped.
 *
 * Pay-first left three holes that only bite together. A campaign becomes PAID the
 * moment the money lands, before anyone has seen whether it can actually run:
 *
 *   1. PAID was not editable, so an annonceur who bought targeting we cannot
 *      serve could not fix it.
 *   2. REJECTED is a payable status — that is how you pay after fixing a refusal
 *      — so a campaign paid for and THEN refused landed back on the pay button
 *      and would have charged them twice.
 *   3. submitForReview always threw "payez votre campagne", so the only route
 *      back into the queue was that second payment.
 *
 * Georgi (2026-09-05) hit the first: 6000 F paid, targeting Gabon + RDC / femmes
 * 25-50, which matches 2 of 223 eligible diffuseurs.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-paid-campaign-edit.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import { updateCampaign, submitForReview, rejectCampaign } from '../services/campaign.service';

const DB = process.env.PAID_EDIT_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_advertising_paid_edit_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const refused = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (err) {
        return (err as Error).message;
    }
};

let n = 0;
const paidCampaign = () =>
    CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Business en ligne',
        mediaFileId: 'f', mediaType: 'image',
        contactWhatsapp: '22994887218',
        landingPageSlug: `paid${Date.now()}${n++}`,
        amountPaid: 6000, pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.PAID,
        paidAt: new Date(),
        submittedForReviewAt: new Date(),
        targeting: { countries: ['GA', 'CD'], sex: ['female'], minAge: 25, maxAge: 50 },
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // 1. The targeting that cannot be served must be fixable.
    const campaign = await paidCampaign();
    await updateCampaign(campaign, { targeting: { countries: ['CM'], sex: [], interests: [] } as never });
    const fixed = await CampaignModel.findById(campaign._id);
    check(
        'a paid campaign awaiting validation can have its targeting fixed',
        fixed?.targeting?.countries?.[0] === 'CM',
        'nothing has been shown to a diffuseur yet, so there is nothing to freeze',
    );

    // 2. But not its budget — that money has already moved.
    const budgetErr = await refused(() => updateCampaign(fixed!, { amount: 20000 } as never));
    check(
        'the budget of a paid campaign cannot be re-quoted',
        Boolean(budgetErr && /budget/i.test(budgetErr)),
        budgetErr ?? 'it was allowed',
    );
    const unchanged = await CampaignModel.findById(campaign._id);
    check(
        'and the views they bought are untouched',
        unchanged?.targetUniqueViews === 2000 && unchanged?.amountPaid === 6000,
        `${unchanged?.targetUniqueViews} views for ${unchanged?.amountPaid} F`,
    );

    // 3. Refused after paying, then fixed, must not cost a second payment.
    const rejected = await rejectCampaign(unchanged!, new Types.ObjectId(), 'Ciblage trop étroit');
    check('an admin can refuse a paid campaign', rejected.status === CampaignStatus.REJECTED);

    await updateCampaign(rejected, { targeting: { countries: ['CM'] } as never });
    const resubmitted = await submitForReview((await CampaignModel.findById(campaign._id))!);
    check(
        'and it goes back into the queue without paying again',
        resubmitted.status === CampaignStatus.PAID,
        `status ${resubmitted.status}`,
    );
    check(
        'with the refusal cleared so it reads as a fresh submission',
        !resubmitted.rejectionReason && !resubmitted.reviewedAt,
    );

    // 4. An unpaid campaign still has to pay its way in.
    const draft = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Jamais payée',
        mediaFileId: 'f', mediaType: 'image',
        contactWhatsapp: '22994887218',
        landingPageSlug: `draft${Date.now()}`,
        amountPaid: 6000, pricePerUniqueView: 3, targetUniqueViews: 2000,
        status: CampaignStatus.DRAFT,
    });
    const draftErr = await refused(() => submitForReview(draft));
    check(
        'an unpaid campaign still cannot skip the queue',
        Boolean(draftErr && /payez/i.test(draftErr)),
        draftErr ?? 'it was allowed in',
    );

    // 5. A live campaign stays frozen — diffuseurs are already posting it.
    const active = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'En diffusion',
        mediaFileId: 'f', mediaType: 'image',
        contactWhatsapp: '22994887218',
        landingPageSlug: `live${Date.now()}`,
        amountPaid: 6000, pricePerUniqueView: 3, targetUniqueViews: 2000,
        status: CampaignStatus.ACTIVE, paidAt: new Date(), activatedAt: new Date(),
    });
    const activeErr = await refused(() => updateCampaign(active, { title: 'Autre chose' }));
    check(
        'a campaign already being diffused cannot be edited',
        Boolean(activeErr),
        activeErr ?? 'it was allowed',
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
