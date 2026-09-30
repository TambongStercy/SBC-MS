/**
 * Asserts reviewed recordings are deleted, and unreviewed ones are not.
 *
 * A verification recording exists so one admin can check a code and a view count
 * once. After that it is inert — and they arrived at ~873 MiB/day when manual
 * verification went live, the fastest-growing thing in storage and the only thing
 * with no second reader.
 *
 * The dangerous mistake here is deleting too much: a recording still awaiting
 * review, or one whose deletion failed, must survive.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-video-retention.ts
 */
import mongoose, { Types } from 'mongoose';
import ManualVerificationModel, { ManualVerificationStatus } from '../database/models/manual-verification.model';
import config from '../config';
import * as settingsClient from '../services/clients/settings.service.client';

const DB = process.env.RETENTION_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_advertising_retention_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

/** Records what the sweep asked to delete, and can be told to refuse. */
const deleted: string[] = [];
let refuse = false;
(settingsClient as any).deleteFile = async (fileId: string) => {
    if (refuse) return false;
    deleted.push(fileId);
    return true;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sweepReviewedVideos } = require('../services/manual-verification.service');

const DAY = 24 * 60 * 60 * 1000;
let n = 0;

const make = async (status: ManualVerificationStatus, reviewedDaysAgo: number | null) =>
    ManualVerificationModel.create({
        participationId: new Types.ObjectId(),
        campaignId: new Types.ObjectId(),
        diffuseurUserId: new Types.ObjectId(),
        day: 1,
        code: String(100000 + n),
        codeIssuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
        status,
        videoFileId: `video-${n++}.mp4`,
        uploadedAt: new Date(),
        ...(reviewedDaysAgo != null ? { reviewedAt: new Date(Date.now() - reviewedDaysAgo * DAY) } : {}),
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const retention = config.campaign.manualVerifyRetentionDays;
    console.log(`retention window: ${retention} day(s)\n`);

    const old = await make(ManualVerificationStatus.APPROVED, retention + 2);
    const rejectedOld = await make(ManualVerificationStatus.REJECTED, retention + 2);
    const recent = await make(ManualVerificationStatus.APPROVED, 0);
    const pending = await make(ManualVerificationStatus.PENDING_REVIEW, null);

    const removed = await sweepReviewedVideos();
    check('reviewed recordings past the window are deleted', removed === 2, `${removed} deleted`);
    check('a refusal is cleaned up too, not just an approval',
        deleted.includes(rejectedOld.videoFileId as string),
        'both are decided; both are inert');

    const afterOld = await ManualVerificationModel.findById(old._id);
    check('the file id is cleared so the UI knows there is nothing to play', !afterOld?.videoFileId);
    check('and the deletion is stamped', !!afterOld?.videoDeletedAt);
    check('while the record itself survives as proof of review',
        afterOld?.status === ManualVerificationStatus.APPROVED && !!afterOld?.reviewedAt);

    const afterRecent = await ManualVerificationModel.findById(recent._id);
    check('a recording reviewed today is kept',
        !!afterRecent?.videoFileId,
        'a refused diffuseur may dispute, and this is the only evidence');

    const afterPending = await ManualVerificationModel.findById(pending._id);
    check('an unreviewed recording is never touched', !!afterPending?.videoFileId);

    // Storage refusing must not strand the object with nothing pointing at it.
    refuse = true;
    const stubborn = await make(ManualVerificationStatus.APPROVED, retention + 5);
    const removedAgain = await sweepReviewedVideos();
    const afterFail = await ManualVerificationModel.findById(stubborn._id);
    check('a failed delete keeps the file id for the next sweep',
        removedAgain === 0 && !!afterFail?.videoFileId,
        'clearing it would leave the object unreachable AND permanent');

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
