import { Types } from 'mongoose';
import { customAlphabet } from 'nanoid';
import ManualVerificationModel, { ManualVerificationStatus, IManualVerification } from '../database/models/manual-verification.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import CampaignModel from '../database/models/campaign.model';
import { markDayVerifiedManually, earliestAllowedPost } from './verification.service';
import { currentDay } from './day-window.service';
import { getUserProfiles } from './clients/user.service.client';
import config from '../config';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('ManualVerificationService');

// 6 digits: big and unambiguous on a phone screen recording, trivial for the
// diffuseur to keep visible and for the admin to read back off the video.
const genCode = customAlphabet('0123456789', 6);

/**
 * Public URL of the uploaded recording, for the admin to watch.
 *
 * Points straight at the storage bucket rather than at our own file endpoint:
 * that endpoint answers with `Cross-Origin-Resource-Policy: same-origin`, and the
 * admin panel is served from admin.sniperbuisnesscenter.com — a different origin
 * — so the browser refused to play every video. The bucket is public and serves
 * byte ranges, which is what a <video> element needs anyway.
 */
const videoUrl = (fileId: string) =>
    fileId.startsWith('http') ? fileId : `${config.mediaCdnBaseUrl.replace(/\/$/, '')}/${fileId}`;

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
    if (!mv) throw new AppError("Aucun code en attente. Générez un code avant d'enregistrer.", 400);

    if (Date.now() > mv.expiresAt.getTime()) {
        mv.status = ManualVerificationStatus.EXPIRED;
        await mv.save();
        throw new AppError('Le délai est dépassé. Recommencez avec un nouveau code.', 400);
    }

    mv.videoFileId = videoFileId;
    mv.uploadedAt = new Date();
    mv.status = ManualVerificationStatus.PENDING_REVIEW;
    await mv.save();

    log.info(`Manual verify video uploaded for participation ${participationId} day ${mv.day} (mv ${mv._id})`);
    return { manualVerificationId: String(mv._id), day: mv.day, status: mv.status };
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

export const listPendingManualVerifications = async () => {
    const items = await ManualVerificationModel
        .find({ status: ManualVerificationStatus.PENDING_REVIEW })
        .sort({ createdAt: 1 })
        .lean();

    const [profiles, campaigns] = await Promise.all([
        getUserProfiles(items.map(i => String(i.diffuseurUserId))).catch(() => []),
        CampaignModel.find({ _id: { $in: items.map(i => i.campaignId) } }).select('title isTestCampaign').lean(),
    ]);
    const profileById = new Map(profiles.map(p => [String(p._id), p]));
    const campaignById = new Map(campaigns.map(c => [String(c._id), c]));

    return items.map(i => {
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
    });
};

export const approveManualVerification = async (
    adminId: Types.ObjectId,
    manualVerificationId: string,
    observedViewCount: number,
) => {
    if (!Number.isFinite(observedViewCount) || observedViewCount < 0) {
        throw new AppError('Le nombre de vues doit être un nombre positif.', 400);
    }
    const mv = await ManualVerificationModel.findById(manualVerificationId);
    if (!mv) throw new AppError('Vérification introuvable.', 404);
    if (mv.status !== ManualVerificationStatus.PENDING_REVIEW) {
        throw new AppError(`Cette vérification n'est plus en attente (statut : ${mv.status}).`, 400);
    }

    const result = await markDayVerifiedManually(mv.participationId, mv.day, observedViewCount);

    mv.status = ManualVerificationStatus.APPROVED;
    mv.reviewedBy = adminId;
    mv.reviewedAt = new Date();
    mv.observedViewCount = result.viewCount;
    await mv.save();

    log.info(`Admin ${adminId} approved manual verification ${manualVerificationId} (day ${mv.day}, ${result.viewCount} views)`);
    return { manualVerificationId, ...result };
};

export const rejectManualVerification = async (
    adminId: Types.ObjectId,
    manualVerificationId: string,
    reason: string,
) => {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new AppError('Un motif de refus est obligatoire.', 400);

    const mv = await ManualVerificationModel.findById(manualVerificationId);
    if (!mv) throw new AppError('Vérification introuvable.', 404);
    if (mv.status !== ManualVerificationStatus.PENDING_REVIEW) {
        throw new AppError(`Cette vérification n'est plus en attente (statut : ${mv.status}).`, 400);
    }

    mv.status = ManualVerificationStatus.REJECTED;
    mv.reviewedBy = adminId;
    mv.reviewedAt = new Date();
    mv.rejectionReason = trimmed;
    await mv.save();

    log.info(`Admin ${adminId} rejected manual verification ${manualVerificationId}: ${trimmed}`);
    return { manualVerificationId, status: mv.status };
};
