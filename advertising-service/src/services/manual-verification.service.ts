import { notifyManualVerificationApproved, notifyManualVerificationRejected } from './clients/notification.service.client';
import { Types } from 'mongoose';
import { customAlphabet } from 'nanoid';
import ManualVerificationModel, { ManualVerificationStatus, IManualVerification, IDecisionActor } from '../database/models/manual-verification.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import CampaignModel from '../database/models/campaign.model';
import { markDayVerifiedManually, earliestAllowedPost } from './verification.service';
import { currentDay } from './day-window.service';
import { getUserProfile, getUserProfiles } from './clients/user.service.client';
import { sendViewTask } from './clients/support.service.client';
import { deleteFile } from './clients/settings.service.client';
import { banDiffuseur } from './ranking.service';
import config from '../config';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('ManualVerificationService');

// 6 digits: big and unambiguous on a phone screen recording, trivial for the
// diffuseur to keep visible and for the admin to read back off the video.
const genCode = customAlphabet('0123456789', 6);

/**
 * URL of the uploaded recording, for the admin to watch.
 *
 * This pointed straight at the storage bucket, because our own file endpoint
 * answered with `Cross-Origin-Resource-Policy: same-origin` and the admin panel
 * is on admin.sniperbuisnesscenter.com — a different origin — so every video
 * refused to play. The bucket was public and served byte ranges, so it worked.
 *
 * It stopped working on 2026-09-05: `publicAccessPrevention` is now inherited
 * from an org policy that overrides the bucket's allUsers grant, so every
 * anonymous GET returns 403. settings-service now serves these itself, with
 * credentials, `Cross-Origin-Resource-Policy: cross-origin` and real Range
 * support — so the two reasons for going direct are both answered, and this is
 * no longer hostage to whether the bucket happens to be world-readable.
 */
/**
 * `v` busts Cloudflare entries poisoned during the 2026-09-05 storage outage.
 *
 * Errors were served carrying the success path's one-year immutable
 * Cache-Control, so the edge cached 404s for byte-range requests — which is
 * exactly how a <video> seeks. Storage recovered and the videos still would not
 * play. A constant (not a timestamp) so the new URL caches normally; bump it only
 * if the edge is ever poisoned again.
 */
const CACHE_BUSTER = 'v=2';

const videoUrl = (fileId: string) =>
    fileId.startsWith('http')
        ? fileId
        : `${config.appBaseUrl.replace(/\/$/, '')}/api/settings/files/${encodeURIComponent(fileId)}?${CACHE_BUSTER}`;

const ownedInProgress = async (userId: Types.ObjectId, participationId: string) => {
    const participation = await CampaignParticipationModel.findById(participationId);
    if (!participation) throw new AppError('Participation introuvable.', 404);
    if (String(participation.diffuseurUserId) !== String(userId)) {
        throw new AppError('Cette participation ne vous appartient pas.', 403);
    }
    if (participation.status !== ParticipationStatus.IN_PROGRESS) {
        throw new AppError("Cette participation n'est pas en cours.", 400);
    }
    return participation;
};

/**
 * Issues a fresh on-screen code for the diffuseur's current unverified day and
 * opens the upload window. Any earlier un-uploaded code for this participation is
 * retired so only one is ever live.
 */
export const generateManualCode = async (userId: Types.ObjectId, participationId: string) => {
    const participation = await ownedInProgress(userId, participationId);

    const day = currentDay(participation);
    if (!day) throw new AppError('Tous les jours de cette campagne sont déjà vérifiés.', 400);

    const notBefore = earliestAllowedPost(participation.days, day.day);
    if (notBefore && Date.now() < notBefore.getTime()) {
        throw new AppError(
            `Le jour ${day.day} n'est pas encore ouvert. Réessayez après ${notBefore.toLocaleString('fr-FR')}.`,
            400,
        );
    }

    // Retire any still-open code for this participation+day so a diffuseur can't
    // keep several live windows at once.
    await ManualVerificationModel.updateMany(
        { participationId: participation._id, day: day.day, status: ManualVerificationStatus.AWAITING_UPLOAD },
        { $set: { status: ManualVerificationStatus.EXPIRED } },
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.campaign.manualVerifyWindowSeconds * 1000);
    const mv = await ManualVerificationModel.create({
        participationId: participation._id,
        campaignId: participation.campaignId,
        diffuseurUserId: participation.diffuseurUserId,
        day: day.day,
        code: genCode(),
        codeIssuedAt: now,
        expiresAt,
        status: ManualVerificationStatus.AWAITING_UPLOAD,
    });

    log.info(`Manual verify code issued for participation ${participation._id} day ${day.day} (expires ${expiresAt.toISOString()})`);
    return {
        manualVerificationId: String(mv._id),
        code: mv.code,
        day: mv.day,
        expiresAt: mv.expiresAt,
        windowSeconds: config.campaign.manualVerifyWindowSeconds,
    };
};

/**
 * Attaches the uploaded recording to the live code — but only if it arrived
 * inside the window. A late upload is refused (and the code retired) so a stale
 * video, recorded before the code existed, cannot be passed off as fresh.
 */
export const submitManualVideo = async (
    userId: Types.ObjectId,
    participationId: string,
    videoFileId: string,
) => {
    if (!videoFileId) throw new AppError('La vidéo est requise.', 400);
    await ownedInProgress(userId, participationId);

    const mv = await ManualVerificationModel
        .findOne({ participationId, status: ManualVerificationStatus.AWAITING_UPLOAD })
        .sort({ createdAt: -1 });
    if (!mv) {
        // The same video sent again (double tap, network retry): answer as the first time.
        const same = await ManualVerificationModel
            .findOne({ participationId, videoFileId, status: ManualVerificationStatus.PENDING_REVIEW })
            .select('day status').lean();
        if (same) return { manualVerificationId: String(same._id), day: same.day, status: same.status };
        throw new AppError("Aucun code en attente. Générez un code avant d'enregistrer.", 400);
    }

    if (Date.now() > mv.expiresAt.getTime()) {
        mv.status = ManualVerificationStatus.EXPIRED;
        await mv.save();
        throw new AppError('Le délai est dépassé. Recommencez avec un nouveau code.', 400);
    }

    // Conditional, so a double tap or a retried upload cannot enter the queue
    // (and reach SBC Support) twice.
    const uploadedAt = new Date();
    const entered = await ManualVerificationModel.findOneAndUpdate(
        { _id: mv._id, status: ManualVerificationStatus.AWAITING_UPLOAD },
        {
            $set: { videoFileId, uploadedAt, status: ManualVerificationStatus.PENDING_REVIEW },
            $push: { history: { at: uploadedAt, action: 'submitted' } },
        },
        { new: true },
    );
    if (!entered) {
        const current = await ManualVerificationModel.findById(mv._id).select('status day').lean();
        if (current?.status === ManualVerificationStatus.PENDING_REVIEW) {
            return { manualVerificationId: String(mv._id), day: current.day, status: current.status };
        }
        throw new AppError("Aucun code en attente. Générez un code avant d'enregistrer.", 400);
    }

    log.info(`Manual verify video uploaded for participation ${participationId} day ${entered.day} (mv ${entered._id})`);
    // Fire-and-forget: never delays or fails the diffuseur's upload.
    void queueViewTask(entered);
    return { manualVerificationId: String(entered._id), day: entered.day, status: entered.status };
};

/**
 * Tells SBC Support a proof is waiting (one verifier task per proof). Never
 * throws; support-service's catch-up sync covers anything lost here.
 */
export const queueViewTask = async (mv: Pick<IManualVerification, '_id' | 'uploadedAt' | 'campaignId' | 'diffuseurUserId' | 'day'>): Promise<boolean> => {
    try {
        const profile = await getUserProfile(String(mv.diffuseurUserId)).catch(() => null);
        return await sendViewTask({
            sourceId: String(mv._id),
            submittedAt: (mv.uploadedAt ?? new Date()).toISOString(),
            campaignId: String(mv.campaignId),
            diffuseurUserId: String(mv.diffuseurUserId),
            dayIndex: mv.day,
            country: profile?.country ?? null,
        });
    } catch (err) {
        log.warn(`View task for proof ${mv._id} not sent: ${(err as Error)?.message}`);
        return false;
    }
};

/** The diffuseur's latest manual-verification state for a participation. */
export const getManualStatus = async (userId: Types.ObjectId, participationId: string) => {
    await ownedInProgress(userId, participationId);
    const mv = await ManualVerificationModel.findOne({ participationId }).sort({ createdAt: -1 }).lean();
    if (!mv) return null;
    return {
        manualVerificationId: String(mv._id),
        day: mv.day,
        status: mv.status,
        code: mv.status === ManualVerificationStatus.AWAITING_UPLOAD ? mv.code : undefined,
        expiresAt: mv.expiresAt,
        rejectionReason: mv.rejectionReason,
    };
};

// --- Admin ---

export interface ListPage {
    page: number;
    limit: number;
}

/**
 * `match`: extra conditions (the admin's country / date filters).
 * `paging`: absent = every pending proof (what the dashboard counters read);
 * given = one page of it. `total` is always the whole queue for these filters.
 */
export const listPendingManualVerifications = async (match: Record<string, unknown> = {}, paging?: ListPage) => {
    const filter = { ...match, status: ManualVerificationStatus.PENDING_REVIEW };
    let query = ManualVerificationModel
        .find(filter)
        // By upload time, not by createdAt. createdAt is when the CODE was issued,
        // and the gap between the two is whatever the diffuseur took to record —
        // so ordering by it puts someone who asked for a code early and uploaded
        // late ahead of someone who has been waiting longer for a decision.
        // Whoever sent their video first is served first (Rufus, 2026-09-05).
        .sort({ uploadedAt: 1, createdAt: 1 });
    if (paging) query = query.skip((paging.page - 1) * paging.limit).limit(paging.limit);
    const [items, total] = await Promise.all([query.lean(), ManualVerificationModel.countDocuments(filter)]);

    const [profiles, campaigns] = await Promise.all([
        getUserProfiles(items.map(i => String(i.diffuseurUserId))).catch(() => []),
        CampaignModel.find({ _id: { $in: items.map(i => i.campaignId) } }).select('title isTestCampaign').lean(),
    ]);
    const profileById = new Map(profiles.map(p => [String(p._id), p]));
    const campaignById = new Map(campaigns.map(c => [String(c._id), c]));

    return {
        total,
        items: items.map(i => {
            const p = profileById.get(String(i.diffuseurUserId));
            const c = campaignById.get(String(i.campaignId));
            return {
                manualVerificationId: String(i._id),
                participationId: String(i.participationId),
                day: i.day,
                code: i.code,
                codeIssuedAt: i.codeIssuedAt,
                uploadedAt: i.uploadedAt,
                videoFileId: i.videoFileId ?? null,
                videoUrl: i.videoFileId ? videoUrl(i.videoFileId) : null,
                diffuseurName: p?.name ?? 'Inconnu',
                diffuseurPhone: p?.phoneNumber,
                campaignTitle: c?.title ?? '—',
                isTestCampaign: Boolean(c?.isTestCampaign),
            };
        }),
    };
};

// --- SBC Support (internal) ---

/**
 * Proofs for support-service's catch-up sync, oldest change first. Pass the
 * last `updatedAt` seen as `updatedSince` to page through.
 */
export const listForSupportSync = async (opts: { status: ManualVerificationStatus; updatedSince?: Date; limit: number }) => {
    const filter: Record<string, unknown> = { status: opts.status };
    if (opts.updatedSince) filter.updatedAt = { $gt: opts.updatedSince };
    const items = await ManualVerificationModel.find(filter)
        .sort({ updatedAt: 1, _id: 1 })
        .limit(opts.limit)
        .select('_id status uploadedAt updatedAt campaignId diffuseurUserId day')
        .lean();
    return items.map(i => ({
        id: String(i._id),
        status: i.status,
        submittedAt: i.uploadedAt ?? null,
        updatedAt: i.updatedAt,
        campaignId: String(i.campaignId),
        diffuseurUserId: String(i.diffuseurUserId),
        dayIndex: i.day,
    }));
};

/** One proof with what a verifier needs to judge it. Null when not found. */
export const getProofForSupport = async (manualVerificationId: string) => {
    if (!Types.ObjectId.isValid(manualVerificationId)) return null;
    const mv = await ManualVerificationModel.findById(manualVerificationId).lean();
    if (!mv) return null;

    const [participation, campaign, profile, attempts] = await Promise.all([
        CampaignParticipationModel.findById(mv.participationId).lean(),
        CampaignModel.findById(mv.campaignId).select('title targetUniqueViews isTestCampaign status').lean(),
        getUserProfile(String(mv.diffuseurUserId)).catch(() => null),
        // Earlier attempts at the same participation: a refused day, an expired code.
        ManualVerificationModel.find({ participationId: mv.participationId, _id: { $ne: mv._id } })
            .sort({ createdAt: -1 }).limit(20)
            .select('day status uploadedAt reviewedAt rejectionReason observedViewCount decidedBy createdAt')
            .lean(),
    ]);
    const day = participation?.days?.find((d: any) => d.day === mv.day);

    return {
        id: String(mv._id),
        status: mv.status,
        dayIndex: mv.day,
        code: mv.code,
        codeIssuedAt: mv.codeIssuedAt,
        submittedAt: mv.uploadedAt ?? null,
        // Served by settings-service's file proxy (proofs are in the public media
        // bucket under an unguessable id), the same URL the admin panel plays.
        videoUrl: mv.videoFileId ? videoUrl(mv.videoFileId) : null,
        videoDeletedAt: mv.videoDeletedAt ?? null,
        decision: mv.status === ManualVerificationStatus.APPROVED || mv.status === ManualVerificationStatus.REJECTED
            ? { reviewedAt: mv.reviewedAt, decidedBy: mv.decidedBy ?? (mv.reviewedBy ? { source: 'admin', id: String(mv.reviewedBy) } : null), observedViewCount: mv.observedViewCount ?? null, rejectionReason: mv.rejectionReason ?? null }
            : null,
        participation: participation ? {
            id: String(participation._id),
            status: participation.status,
            day: day ? { status: day.status, viewCount: day.viewCount ?? null, verifiedAt: day.verifiedAt ?? null } : null,
            totalViews: participation.totalViews ?? 0,
        } : null,
        campaign: campaign ? {
            id: String(campaign._id),
            name: campaign.title,
            targetViews: campaign.targetUniqueViews ?? null,
            isTestCampaign: Boolean(campaign.isTestCampaign),
        } : { id: String(mv.campaignId), name: null, targetViews: null, isTestCampaign: false },
        diffuseur: {
            id: String(mv.diffuseurUserId),
            name: profile?.name ?? null,
            country: profile?.country ?? null,
        },
        history: {
            events: mv.history ?? [],
            previousAttempts: attempts.map(a => ({
                id: String(a._id),
                dayIndex: a.day,
                status: a.status,
                submittedAt: a.uploadedAt ?? null,
                reviewedAt: a.reviewedAt ?? null,
                observedViewCount: a.observedViewCount ?? null,
                rejectionReason: a.rejectionReason ?? null,
                decidedBy: a.decidedBy ?? null,
            })),
        },
    };
};

/** The roles allowed to ban a diffuseur from SBC Support (contract §2.3). */
export const SUPPORT_BAN_ROLES = ['views_supervisor', 'support_admin'];

export class AlreadyDecidedError extends AppError {
    readonly code = 'ALREADY_DECIDED';
    constructor(readonly currentStatus: string) {
        super(`Cette vérification n'est plus en attente (statut : ${currentStatus}).`, 409);
    }
}

export interface DecisionInput {
    decision: 'approve' | 'reject';
    observedViewCount?: number;
    reason?: string;
    /** Ban the diffuseur from the ads network in the same action (reject only). */
    ban?: boolean;
    actor: IDecisionActor;
    /**
     * The admin user who decided (admin panel), stored in reviewedBy and used as
     * bannedBy. Absent for SBC Support agents, whose ids live in support-service.
     */
    adminUserId?: Types.ObjectId;
}

const objectIdOrUndefined = (id?: string) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);

/**
 * The one way a video proof gets decided, from the admin panel or SBC Support.
 *
 * The status moves `pending_review → approved/rejected` in a single conditional
 * write, BEFORE anything else happens. Two reviewers deciding the same proof at
 * once used to both pass a read-then-check and both credit the day; now exactly
 * one write matches and every other caller gets 409 ALREADY_DECIDED. Side
 * effects (crediting the day, banning, notifying) run only for the caller whose
 * write took. If crediting the day fails, the claim is released (back to
 * pending_review) so the proof can be decided again.
 */
export const decideManualVerification = async (manualVerificationId: string, input: DecisionInput) => {
    if (!Types.ObjectId.isValid(manualVerificationId)) throw new AppError('Vérification introuvable.', 404);
    const { decision, actor } = input;
    if (decision !== 'approve' && decision !== 'reject') {
        throw new AppError('Décision invalide : « approve » ou « reject ».', 400);
    }

    const views = Number(input.observedViewCount);
    if (decision === 'approve' && (input.observedViewCount === undefined || input.observedViewCount === null
        || !Number.isFinite(views) || views < 0)) {
        throw new AppError('Le nombre de vues doit être un nombre positif.', 400);
    }
    const reason = (input.reason ?? '').trim();
    if (decision === 'reject' && !reason) throw new AppError('Un motif de refus est obligatoire.', 400);

    const now = new Date();
    const status = decision === 'approve' ? ManualVerificationStatus.APPROVED : ManualVerificationStatus.REJECTED;
    const set: Record<string, unknown> = { status, reviewedAt: now, decidedBy: actor };
    if (input.adminUserId) set.reviewedBy = input.adminUserId;
    if (decision === 'reject') set.rejectionReason = reason;

    const event = {
        at: now,
        action: decision === 'approve' ? 'approved' : 'rejected',
        by: actor,
        ...(decision === 'approve' ? { observedViewCount: Math.max(0, Math.round(views)) } : { reason, ban: Boolean(input.ban) }),
    };

    const mv = await ManualVerificationModel.findOneAndUpdate(
        { _id: manualVerificationId, status: ManualVerificationStatus.PENDING_REVIEW },
        { $set: set, $push: { history: event } },
        { new: true },
    );
    if (!mv) {
        const current = await ManualVerificationModel.findById(manualVerificationId).select('status').lean();
        if (!current) throw new AppError('Vérification introuvable.', 404);
        throw new AlreadyDecidedError(current.status);
    }

    const who = `${actor.source}:${actor.id ?? '?'}${actor.role ? `(${actor.role})` : ''}${actor.override ? ' [override]' : ''}`;

    if (decision === 'approve') {
        let result: Awaited<ReturnType<typeof markDayVerifiedManually>>;
        try {
            result = await markDayVerifiedManually(mv.participationId, mv.day, views);
        } catch (err) {
            // Not credited: release the claim so the proof can be decided again.
            await ManualVerificationModel.updateOne(
                { _id: mv._id, status: ManualVerificationStatus.APPROVED, reviewedAt: now },
                {
                    $set: { status: ManualVerificationStatus.PENDING_REVIEW },
                    $unset: { reviewedAt: 1, reviewedBy: 1, decidedBy: 1 },
                    $push: { history: { at: new Date(), action: 'decision_reverted', by: actor, reason: (err as Error)?.message?.slice(0, 300) } },
                },
            ).catch(e => log.error(`Could not release proof ${mv._id} after a failed approval: ${e?.message}`));
            throw err;
        }
        await ManualVerificationModel.updateOne({ _id: mv._id }, { $set: { observedViewCount: result.viewCount } });

        log.info(`${who} approved manual verification ${manualVerificationId} (day ${mv.day}, ${result.viewCount} views)`
            + (actor.requestId ? ` request ${actor.requestId}` : ''));
        void notifyManualVerificationApproved(String(mv.diffuseurUserId), mv.day, result.viewCount, result.earnedAmount);
        return { manualVerificationId, status: ManualVerificationStatus.APPROVED, ...result };
    }

    let banned = false;
    let offersWithdrawn = 0;
    if (input.ban) {
        // The refusal reason IS the ban reason: they are the same judgement about
        // the same recording. The refusal is already recorded, so a failed ban is
        // reported, not thrown: the caller retries it from the diffuseurs screen.
        try {
            ({ offersWithdrawn } = await banDiffuseur(
                mv.diffuseurUserId,
                input.adminUserId ?? objectIdOrUndefined(actor.id),
                reason,
            ));
            banned = true;
        } catch (err) {
            log.error(`Proof ${manualVerificationId} rejected but banning diffuseur ${mv.diffuseurUserId} failed: ${(err as Error)?.message}`);
        }
    }

    void notifyManualVerificationRejected(String(mv.diffuseurUserId), mv.day, reason);

    log.info(
        `${who} rejected manual verification ${manualVerificationId}: ${reason}`
        + (banned ? ` — diffuseur ${mv.diffuseurUserId} banned` : '')
        + (actor.requestId ? ` request ${actor.requestId}` : ''),
    );
    return { manualVerificationId, status: ManualVerificationStatus.REJECTED, banned, offersWithdrawn };
};

/** Admin panel approve (see decideManualVerification). */
export const approveManualVerification = async (
    adminId: Types.ObjectId,
    manualVerificationId: string,
    observedViewCount: number,
    actor: Partial<IDecisionActor> = {},
) => decideManualVerification(manualVerificationId, {
    decision: 'approve',
    observedViewCount,
    adminUserId: adminId,
    actor: { source: 'admin', id: String(adminId), ...actor },
});

/**
 * Admin panel reject, optionally banning the diffuseur in the same action.
 *
 * The moment you know is the moment you are watching the recording — Rufus
 * spotted an AI-generated proof for the second time and had nowhere to act on
 * it from the review screen. Splitting "refuse" from "ban" across two screens
 * means the second step is the one that gets skipped.
 */
export const rejectManualVerification = async (
    adminId: Types.ObjectId,
    manualVerificationId: string,
    reason: string,
    ban = false,
    actor: Partial<IDecisionActor> = {},
) => decideManualVerification(manualVerificationId, {
    decision: 'reject',
    reason,
    ban,
    adminUserId: adminId,
    actor: { source: 'admin', id: String(adminId), ...actor },
});

/**
 * Delete the recordings of verifications that have already been decided.
 *
 * A screen recording exists to let one admin check a code and a view count once.
 * After that it is inert, and they arrived at ~873 MiB/day once verification went
 * live — the fastest-growing thing we store, and unlike everything else it has no
 * second reader. Compression (~87%) slows that curve; deleting them flattens it.
 *
 * Not deleted at the moment of review. A diffuseur who is refused loses a day's
 * earnings and may well dispute it, and the recording is the only evidence either
 * way — so it survives a grace period first. Set MANUAL_VERIFY_RETENTION_DAYS=0
 * to delete as soon as the decision is made.
 *
 * The record itself is kept: it still shows who was reviewed, when, and what was
 * decided. Only the video goes.
 */
export const sweepReviewedVideos = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - config.campaign.manualVerifyRetentionDays * 24 * 60 * 60 * 1000);

    const decided = await ManualVerificationModel.find({
        status: { $in: [ManualVerificationStatus.APPROVED, ManualVerificationStatus.REJECTED] },
        videoFileId: { $exists: true, $nin: [null, ''] },
        reviewedAt: { $lte: cutoff },
    }).select('_id videoFileId').limit(200);

    if (!decided.length) return 0;

    let deleted = 0;
    for (const mv of decided) {
        const gone = await deleteFile(mv.videoFileId as string);
        // Leave videoFileId in place when the delete failed, so the next sweep
        // retries it. Clearing it would strand the object with nothing pointing
        // at it — unreachable AND permanent.
        if (!gone) continue;

        await ManualVerificationModel.updateOne(
            { _id: mv._id },
            { $set: { videoDeletedAt: new Date() }, $unset: { videoFileId: 1 } },
        );
        deleted++;
    }

    if (deleted) log.info(`Removed ${deleted} reviewed verification recording(s) from storage`);
    return deleted;
};
