/**
 * Asserts the campaign moderation state machine.
 *
 * The gate this covers is the reason the whole flow exists: an approved creative
 * is published to thousands of people's personal WhatsApp statuses. A hole here
 * means unreviewed content goes out under diffuseurs' own names.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-moderation.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import {
    submitForReview,
    approveCampaign,
    rejectCampaign,
    updateCampaign,
    approvedCampaignCounts,
} from '../services/campaign.service';
import { handlePaymentConfirmation } from '../api/controllers/internal.controller';

const DB = process.env.MODERATION_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_moderation_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

/** Runs `fn` and returns the error message, or null if it unexpectedly succeeded. */
const refusal = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (err) {
        return (err as Error).message;
    }
};

let slugCounter = 0;
const seed = async (overrides: Partial<Record<string, unknown>> = {}): Promise<ICampaign> =>
    CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Promo boutique',
        mediaFileId: 'file1',
        mediaType: 'image',
        contactPhone: '+237600000000',
        landingPageSlug: `mod${slugCounter++}${Date.now()}`,
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.DRAFT,
        ...overrides,
    });

const main = async () => {
    await mongoose.connect(DB);

    // --- Submission ---
    const draft = await seed();
    const submitted = await submitForReview(draft);
    check('draft submits to pending_review', submitted.status === CampaignStatus.PENDING_REVIEW);
    check('submission stamps submittedForReviewAt', !!submitted.submittedForReviewAt);

    check('refuses a second submission', !!await refusal(() => submitForReview(submitted)));

    for (const status of [CampaignStatus.APPROVED, CampaignStatus.ACTIVE, CampaignStatus.COMPLETED]) {
        const c = await seed({ status });
        check(`refuses submission from ${status}`, !!await refusal(() => submitForReview(c)));
    }

    // --- Approval ---
    const admin = new Types.ObjectId();
    check('refuses approving a draft', !!await refusal(() => seed().then(c => approveCampaign(c, admin))));

    const approved = await approveCampaign(submitted, admin);
    check('pending_review approves', approved.status === CampaignStatus.APPROVED);
    check('approval records the reviewer', String(approved.reviewedBy) === String(admin) && !!approved.reviewedAt);

    // --- Rejection ---
    const toReject = await submitForReview(await seed());
    check(
        'refuses rejection without a reason',
        !!await refusal(() => rejectCampaign(toReject, admin, '   ')),
        'the annonceur cannot fix what they are not told',
    );

    const rejected = await rejectCampaign(toReject, admin, 'Créative non conforme : contenu adulte.');
    check('pending_review rejects', rejected.status === CampaignStatus.REJECTED);
    check('rejection stores the reason', rejected.rejectionReason?.includes('contenu adulte') === true);

    // --- Resubmission after rejection ---
    const resubmitted = await submitForReview(rejected);
    check('rejected campaign can be resubmitted', resubmitted.status === CampaignStatus.PENDING_REVIEW);
    check(
        'resubmission clears the stale verdict',
        !resubmitted.rejectionReason && !resubmitted.reviewedBy && !resubmitted.reviewedAt,
    );

    // --- Editing ---
    const editable = await seed();
    const edited = await updateCampaign(editable, { title: 'Nouveau titre' });
    check('draft is editable', edited.title === 'Nouveau titre');

    const withHash = await seed({ mediaPerceptualHash: 'abc123', status: CampaignStatus.REJECTED });
    const swapped = await updateCampaign(withHash, { mediaFileId: 'file2' });
    check(
        'swapping the creative drops the cached hash',
        !swapped.mediaPerceptualHash,
        'a stale hash would verify posts of the previous flyer',
    );

    const repriced = await updateCampaign(await seed(), { amount: 12000 });
    check('changing the amount re-quotes the target', repriced.targetUniqueViews === 4000, `got ${repriced.targetUniqueViews}`);

    const contactless = await seed({ contactPhone: undefined, contactWhatsapp: 'x' });
    check(
        'refuses an edit that removes every contact method',
        !!await refusal(() => updateCampaign(contactless, { contactWhatsapp: '' })),
    );

    for (const status of [CampaignStatus.PENDING_REVIEW, CampaignStatus.APPROVED, CampaignStatus.ACTIVE]) {
        const c = await seed({ status });
        check(
            `refuses edits in ${status}`,
            !!await refusal(() => updateCampaign(c, { mediaFileId: 'swapped' })),
            status === CampaignStatus.APPROVED ? 'else a reviewed creative could be swapped' : '',
        );
    }

    // --- Review-queue history flag ---
    const veteran = new Types.ObjectId();
    await seed({ advertiserUserId: veteran, status: CampaignStatus.COMPLETED });
    await seed({ advertiserUserId: veteran, status: CampaignStatus.ACTIVE });
    await seed({ advertiserUserId: veteran, status: CampaignStatus.REJECTED });
    const newcomer = new Types.ObjectId();
    await seed({ advertiserUserId: newcomer, status: CampaignStatus.PENDING_REVIEW });

    const counts = await approvedCampaignCounts([veteran, newcomer]);
    check('counts an annonceur\'s vetted history', counts.get(String(veteran)) === 2, `got ${counts.get(String(veteran))}`);
    check('a first-time annonceur counts zero', (counts.get(String(newcomer)) ?? 0) === 0);

    // --- Payment callback: the only thing that puts a campaign live ---
    const callback = async (body: unknown) => {
        let code = 200;
        let payload: any;
        const res: any = {
            status(n: number) { code = n; return this; },
            json(b: unknown) { payload = b; return this; },
        };
        await handlePaymentConfirmation({ body } as any, res);
        return { code, payload };
    };

    const failedPayment = await seed({ status: CampaignStatus.APPROVED });
    const failedResult = await callback({
        sessionId: 's1', status: 'FAILED', metadata: { campaignId: String(failedPayment._id) },
    });
    check('acknowledges a failed payment', failedResult.code === 200);
    check(
        'a failed payment does not activate',
        (await CampaignModel.findById(failedPayment._id))?.status === CampaignStatus.APPROVED,
    );

    const orphan = await callback({ sessionId: 's2', status: 'SUCCEEDED', metadata: {} });
    check('rejects a success carrying no campaignId', orphan.code === 400);

    // The whole point of the gate: paying for an unreviewed campaign must not work.
    const unreviewed = await seed({ status: CampaignStatus.DRAFT });
    const bypass = await callback({
        sessionId: 's3', status: 'SUCCEEDED', metadata: { campaignId: String(unreviewed._id) },
    });
    check(
        'payment cannot activate an unreviewed campaign',
        bypass.code === 400 && (await CampaignModel.findById(unreviewed._id))?.status === CampaignStatus.DRAFT,
        `code ${bypass.code}`,
    );

    const paid = await seed({ status: CampaignStatus.APPROVED });
    const paidResult = await callback({
        sessionId: 'sess_abc', status: 'SUCCEEDED', metadata: { campaignId: String(paid._id) },
    });
    const live = await CampaignModel.findById(paid._id);
    check('a successful payment activates an approved campaign', live?.status === CampaignStatus.ACTIVE, `code ${paidResult.code}`);
    check('the payment session is recorded on the campaign', live?.paymentSessionId === 'sess_abc' && !!live?.paidAt);

    const replay = await callback({
        sessionId: 'sess_abc', status: 'SUCCEEDED', metadata: { campaignId: String(paid._id) },
    });
    check(
        'a replayed webhook is a no-op',
        replay.code === 200 && replay.payload?.data?.alreadyActive === true,
        'providers retry; a second round of offers would double-book diffuseurs',
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
