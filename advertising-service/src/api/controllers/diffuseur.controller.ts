import { Response } from 'express';
import { Types } from 'mongoose';
import DiffuseurProfileModel, { ReferralTier } from '../../database/models/diffuseur-profile.model';
import CampaignParticipationModel, { ParticipationStatus, DayStatus } from '../../database/models/campaign-participation.model';
import CampaignModel from '../../database/models/campaign.model';
import { acceptOffer } from '../../services/allocation.service';
import { buildTrackingUrl, buildShareCaption } from '../../services/tracking.service';
import { scheduleSummary, currentDay } from '../../services/day-window.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import { getUserProfile, IUserProfile } from '../../services/clients/user.service.client';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('DiffuseurController');

/**
 * Fields a user must have filled before they can be offered campaigns. Targeting
 * runs on these, so a diffuseur missing any of them is invisible to advertisers
 * and would silently never receive an offer. Better to tell them upfront.
 */
const REQUIRED_PROFILE_FIELDS = ['country', 'city', 'sex', 'birthDate'] as const;

const missingProfileFields = (user: IUserProfile): string[] =>
    REQUIRED_PROFILE_FIELDS.filter(f => {
        const v = user[f];
        return v === undefined || v === null || v === '';
    });

const currentUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, err);
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (err as Error).message,
    });
};

/**
 * Eligibility check plus the checklist of what is still missing, so the UI can
 * show exactly which fields to fill rather than a generic refusal.
 */
export const getEligibility = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const user = await getUserProfile(userId.toString());
        if (!user) throw new AppError('Profil utilisateur introuvable.', 404);

        const missing = missingProfileFields(user);
        const profile = await DiffuseurProfileModel.findOne({ userId }).lean();

        return res.json({
            success: true,
            data: {
                eligible: missing.length === 0,
                missingFields: missing,
                hasProfile: Boolean(profile),
                whatsappLinked: Boolean(profile?.whatsappLid),
            },
        });
    } catch (err) {
        return fail(res, err, 'getEligibility');
    }
};

/** Creates or updates the diffuseur profile. Refuses while the user profile is incomplete. */
export const enroll = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const user = await getUserProfile(userId.toString());
        if (!user) throw new AppError('Profil utilisateur introuvable.', 404);

        const missing = missingProfileFields(user);
        if (missing.length) {
            throw new AppError(
                `Complétez votre profil avant de devenir diffuseur. Champs manquants: ${missing.join(', ')}`,
                400,
            );
        }

        const declared = Number(req.body.declaredAverageViews);
        if (!Number.isFinite(declared) || declared < 0) {
            throw new AppError('declaredAverageViews est requis et doit être un nombre positif.', 400);
        }

        const profile = await DiffuseurProfileModel.findOneAndUpdate(
            { userId },
            { $set: { declaredAverageViews: declared, isActive: true } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        );

        return res.status(201).json({ success: true, data: profile });
    } catch (err) {
        return fail(res, err, 'enroll');
    }
};

export const getMyProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const profile = await DiffuseurProfileModel.findOne({ userId });
        if (!profile) throw new AppError("Vous n'êtes pas encore diffuseur.", 404);

        const remaining = Math.max(0, config.referral.campaignsToUnlock - profile.campaignsCompleted);

        return res.json({
            success: true,
            data: {
                ...profile.toObject(),
                effectiveAverageViews: profile.hasCompletedTestCampaign && profile.measuredAverageViews != null
                    ? profile.measuredAverageViews
                    : (profile.declaredAverageViews ?? 0),
                referral: {
                    tier: profile.referralTier,
                    campaignsCompleted: profile.campaignsCompleted,
                    campaignsToUnlock: config.referral.campaignsToUnlock,
                    campaignsRemaining: remaining,
                    commissionRate: config.referral.commissionRate,
                    // Suspension is reversible: completing one campaign restores it,
                    // no need to redo the 100.
                    suspended: profile.referralTier === ReferralTier.SUSPENDED,
                },
            },
        });
    } catch (err) {
        return fail(res, err, 'getMyProfile');
    }
};

/**
 * Accept an offer. Whoever accepts first wins, so this re-checks the campaign's
 * remaining target rather than trusting that the offer is still good.
 */
export const acceptParticipation = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const participation = await acceptOffer(new Types.ObjectId(req.params.id), userId);

        const campaign = await CampaignModel.findById(participation.campaignId)
            .select('title suggestedCaption mediaFileId mediaType')
            .lean();

        return res.json({
            success: true,
            data: {
                participation,
                campaign,
                // Everything the share screen needs. The link MUST survive into the
                // status caption or the day cannot be verified.
                shareCaption: buildShareCaption(campaign?.suggestedCaption, participation.trackingCode),
                trackingUrl: buildTrackingUrl(participation.trackingCode),
                warning: 'Ne modifiez pas le texte, surtout le lien. Sans le lien, votre publication ne peut pas être vérifiée et la journée ne sera pas comptée.',
            },
        });
    } catch (err) {
        return fail(res, err, 'acceptParticipation');
    }
};

export const declineParticipation = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const participation = await CampaignParticipationModel.findOne({
            _id: req.params.id,
            diffuseurUserId: userId,
        });
        if (!participation) throw new AppError('Offre introuvable.', 404);
        if (participation.status !== ParticipationStatus.OFFERED) {
            throw new AppError('Cette offre ne peut plus être refusée.', 400);
        }

        participation.status = ParticipationStatus.DECLINED;
        await participation.save();

        return res.json({ success: true, data: { status: participation.status } });
    } catch (err) {
        return fail(res, err, 'declineParticipation');
    }
};

/**
 * Diffuseur confirms they have shared the status. Called right after the share
 * sheet closes.
 *
 * This is NOT proof of anything — the timestamp is self-declared and verification
 * overwrites it with the real one read off WhatsApp. Its only job is to start the
 * 24h clock so we can remind them to verify before the status expires, which is
 * the one deadline no grace budget can undo.
 */
export const markPosted = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const participation = await CampaignParticipationModel.findOne({
            _id: req.params.id,
            diffuseurUserId: userId,
        });
        if (!participation) throw new AppError('Participation introuvable.', 404);
        if (participation.status !== ParticipationStatus.IN_PROGRESS) {
            throw new AppError("Cette campagne n'est pas en cours.", 400);
        }

        const pending = currentDay(participation);
        if (!pending) throw new AppError('Toutes les journées sont déjà publiées.', 400);

        const now = new Date();
        if (pending.windowOpensAt && now < pending.windowOpensAt) {
            throw new AppError(
                `Le jour ${pending.day} ne peut pas encore être publié. Réessayez après ${pending.windowOpensAt.toLocaleString('fr-FR')}.`,
                400,
            );
        }

        pending.status = DayStatus.POSTED;
        pending.postedAt = now;
        await participation.save();

        return res.json({
            success: true,
            data: {
                day: pending.day,
                schedule: scheduleSummary(participation, now),
                warning: 'Vérifiez votre publication avant 24h, sinon les vues de cette journée seront perdues.',
            },
        });
    } catch (err) {
        return fail(res, err, 'markPosted');
    }
};

/** Campaigns offered to or accepted by this diffuseur. */
export const listMyParticipations = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Number(req.query.limit) || 20);

        const filter: Record<string, unknown> = { diffuseurUserId: userId };
        if (req.query.status) filter.status = req.query.status;

        const [items, total] = await Promise.all([
            CampaignParticipationModel.find(filter)
                .sort({ offeredAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            CampaignParticipationModel.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            data: items.map(p => ({
                ...p.toObject(),
                // Which day is owed, when its window opens, and how much grace is
                // left. Without this a diffuseur cannot tell whether they are late.
                schedule: p.status === ParticipationStatus.IN_PROGRESS
                    ? scheduleSummary(p)
                    : undefined,
            })),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        return fail(res, err, 'listMyParticipations');
    }
};
