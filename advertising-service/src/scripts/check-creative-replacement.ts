import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import {
    submitMediaChange,
    cancelMediaChange,
    approveMediaChange,
    rejectMediaChange,
    listPendingMediaChanges,
    updateCampaign,
} from '../services/campaign.service';
import { compareMediaToAny } from '../services/media-hash.service';

/**
 * Asserts an annonceur can replace the creative of a live campaign only through
 * an admin review, and that posts of the replaced creative still match.
 *
 * Live creatives were frozen outright; when the 2026-11-01 Google Cloud
 * suspension lost the files of two live campaigns, their annonceurs had no way
 * to send them again.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-creative-replacement.ts
 */

const DB = process.env.CREATIVE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_creative_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refused = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try { await fn(); return null; } catch (err) { return (err as Error).message; }
};

const OLD_HASH = 'f0f0f0f0f0f0f0f0';
const NEW_POST_HASH = '0f0f0f0f0f0f0f0f';
const admin = new Types.ObjectId();
let n = 0;
const campaign = (status: CampaignStatus, extra: Record<string, unknown> = {}) =>
    CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Forever Argi+',
        mediaFileId: 'old.webp', mediaType: 'image',
        contactWhatsapp: '22675345960',
        landingPageSlug: `cr${Date.now()}${n++}`,
        amountPaid: 6000, pricePerUniqueView: 3, targetUniqueViews: 2000,
        status, paidAt: new Date(),
        ...extra,
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // Submitting on a live campaign parks the new creative; the live one keeps running.
    const live = await campaign(CampaignStatus.ACTIVE, { mediaPerceptualHash: OLD_HASH });
    await submitMediaChange(live, { mediaFileId: 'new.mp4', mediaType: 'video', mediaMimeType: 'video/mp4' });
    let doc = await CampaignModel.findById(live._id).lean();
    check('live campaign: replacement waits as pendingMedia', doc?.pendingMedia?.fileId === 'new.mp4' && doc?.pendingMedia?.type === 'video');
    check('live campaign: current creative unchanged until review', doc?.mediaFileId === 'old.webp' && doc?.mediaType === 'image');
    check('pending replacement is listed for admins', (await listPendingMediaChanges()).some(c => String(c._id) === String(live._id)));

    // Paused campaigns too; drafts and paid-awaiting-review edit directly instead.
    const paused = await campaign(CampaignStatus.PAUSED);
    check('paused campaign can submit', (await refused(() => submitMediaChange(paused, { mediaFileId: 'p.jpg', mediaType: 'image' }))) === null);
    const draft = await campaign(CampaignStatus.DRAFT);
    check('draft campaign is refused (edits directly)', !!(await refused(() => submitMediaChange(draft, { mediaFileId: 'd.jpg', mediaType: 'image' }))));
    check('missing file is refused', !!(await refused(() => submitMediaChange(live, { mediaType: 'image' }))));
    check('unknown media type is refused', !!(await refused(() => submitMediaChange(live, { mediaFileId: 'x.pdf', mediaType: 'pdf' }))));

    // The direct edit path still refuses a creative change on a live campaign.
    const directEdit = await refused(() => updateCampaign(live, { mediaFileId: 'sneaky.jpg' } as never));
    check('direct edit of a live creative is still refused', !!directEdit && directEdit.includes('Remplacer le visuel'), directEdit ?? '');

    // Refusal needs a reason, keeps the creative, and records why.
    check('refusal without reason is refused', !!(await refused(() => rejectMediaChange(live, admin, '  '))));
    await rejectMediaChange(live, admin, 'Image floue');
    doc = await CampaignModel.findById(live._id).lean();
    check('refusal clears the pending creative and keeps the live one', !doc?.pendingMedia && doc?.mediaFileId === 'old.webp');
    check('refusal records the reason', doc?.mediaChangeRejection?.reason === 'Image floue');
    check('approving with nothing pending is refused', !!(await refused(() => approveMediaChange(live, admin))));

    // A new submission clears the previous refusal.
    const again = await CampaignModel.findById(live._id);
    await submitMediaChange(again!, { mediaFileId: 'new2.jpg', mediaType: 'image', mediaMimeType: 'image/jpeg' });
    doc = await CampaignModel.findById(live._id).lean();
    check('resubmitting clears the last refusal', !doc?.mediaChangeRejection && doc?.pendingMedia?.fileId === 'new2.jpg');

    // Approval swaps the creative and keeps the old fingerprint.
    await approveMediaChange((await CampaignModel.findById(live._id))!, admin);
    doc = await CampaignModel.findById(live._id).lean();
    check('approval makes the replacement the creative', doc?.mediaFileId === 'new2.jpg' && doc?.mediaType === 'image' && doc?.mediaMimeType === 'image/jpeg');
    check('approval clears pending and the stale fingerprint', !doc?.pendingMedia && !doc?.mediaPerceptualHash);
    check('the old fingerprint is kept for verification', (doc?.previousMediaPerceptualHashes ?? []).includes(OLD_HASH));

    // A post of the old creative still matches after the swap.
    const oldPost = compareMediaToAny([undefined, ...(doc?.previousMediaPerceptualHashes ?? [])], OLD_HASH);
    check('post of the replaced creative still matches', oldPost.matches === true, `distance ${oldPost.distance}`);
    const unrelated = compareMediaToAny([OLD_HASH], NEW_POST_HASH);
    check('an unrelated image still does not match', unrelated.matches === false, `distance ${unrelated.distance}`);

    // Withdrawal.
    const withdraw = await campaign(CampaignStatus.ACTIVE);
    await submitMediaChange(withdraw, { mediaFileId: 'w.jpg', mediaType: 'image' });
    await cancelMediaChange((await CampaignModel.findById(withdraw._id))!);
    doc = await CampaignModel.findById(withdraw._id).lean();
    check('annonceur can withdraw an unreviewed replacement', !doc?.pendingMedia && doc?.mediaFileId === 'old.webp');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
