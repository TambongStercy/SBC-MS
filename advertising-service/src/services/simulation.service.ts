import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import { activateApprovedCampaign } from './activation.service';
import { AppError } from '../utils/errors';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SimulationService');

/**
 * Testing helpers for preprod.
 *
 * A campaign runs over three days with a 24h gate between them, and goes live
 * only once real money arrives. Neither is something you can sit through while
 * testing, so the whole second half of the flow — days 2 and 3, completion,
 * payout — had never been exercised by a person.
 *
 * These shortcut the waiting, not the rules: a simulated payment goes through
 * the same activation path as a real one, and shifting the clock only moves
 * timestamps, leaving every guard to judge them normally.
 */

/** Hard stop. These endpoints must never exist in production. */
export const assertSimulationAllowed = (): void => {
    const enabled = process.env.SIMULATION_ENABLED === 'true';
    const isProduction = config.nodeEnv === 'production';

    if (isProduction || !enabled) {
        throw new AppError(
            'Les outils de simulation sont désactivés dans cet environnement.',
            403,
        );
    }
};

/**
 * Activates a campaign as though its payment had succeeded.
 *
 * Goes through activateApprovedCampaign, so the moderation gate still applies:
 * an unapproved campaign is refused here exactly as it would be by the real
 * webhook. What is skipped is the money, not the checks.
 */
export const simulatePayment = async (campaignId: string) => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) throw new AppError('Campagne introuvable.', 404);

    const result = await activateApprovedCampaign(campaign._id);
    await CampaignModel.updateOne(
        { _id: campaign._id },
        { $set: { paidAt: new Date(), paymentSessionId: `simulated-${Date.now()}` } },
    );

    log.warn(`SIMULATION: campaign ${campaign._id} activated without payment`);
    return result;
};

/**
 * Moves a participation's clock back by `hours`.
 *
 * Everything time-based shifts together — acceptance, the day-1 deadline, the
 * completion deadline, each day's window and post time — so the participation
 * looks exactly as it would have that many hours later. Shifting only the next
 * window would produce a state the real flow can never reach, and then we would
 * be testing a fiction.
 */
export const shiftParticipationClock = async (participationId: string, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
        throw new AppError('Indiquez un nombre d\'heures entre 1 et 720.', 400);
    }

    const participation = await CampaignParticipationModel.findById(participationId);
    if (!participation) throw new AppError('Participation introuvable.', 404);

    const ms = hours * 60 * 60 * 1000;
    const back = (d?: Date | null) => (d ? new Date(d.getTime() - ms) : d);

    participation.acceptedAt = back(participation.acceptedAt) ?? participation.acceptedAt;
    participation.offeredAt = back(participation.offeredAt) ?? participation.offeredAt;
    participation.day1Deadline = back(participation.day1Deadline) ?? participation.day1Deadline;
    participation.completionDeadline = back(participation.completionDeadline) ?? participation.completionDeadline;

    for (const day of participation.days) {
        day.windowOpensAt = back(day.windowOpensAt) ?? day.windowOpensAt;
        day.dueAt = back(day.dueAt) ?? day.dueAt;
        day.postedAt = back(day.postedAt) ?? day.postedAt;
        day.verifiedAt = back(day.verifiedAt) ?? day.verifiedAt;
        // So the reminder and opening mails fire again for the shifted day.
        day.dayOpenedNotifiedAt = undefined;
        day.dayReminderSentAt = undefined;
        day.verificationReminderSentAt = undefined;
    }

    await participation.save();
    log.warn(`SIMULATION: participation ${participationId} moved back ${hours}h`);

    const next = participation.days.find(d => d.status === DayStatus.PENDING);
    return {
        hours,
        nextDay: next?.day,
        nextDayOpensAt: next?.windowOpensAt,
        nextDayOpenNow: Boolean(next?.windowOpensAt && next.windowOpensAt <= new Date()),
        completionDeadline: participation.completionDeadline,
    };
};

/**
 * Marks a day verified with a chosen view count, without a WhatsApp session.
 *
 * The scarce part of testing this flow is the phone: every verification needs a
 * real device, a real status and a real pairing. This fills in a day so the
 * stages *after* verification — completion, payout, the measured average — can
 * be reached without one.
 */
export const simulateVerification = async (
    participationId: string,
    day: number,
    viewCount: number,
) => {
    if (!Number.isFinite(viewCount) || viewCount < 0) {
        throw new AppError('Indiquez un nombre de vues valide.', 400);
    }

    const participation = await CampaignParticipationModel.findById(participationId);
    if (!participation) throw new AppError('Participation introuvable.', 404);

    const target = participation.days.find(d => d.day === day);
    if (!target) throw new AppError(`Le jour ${day} n'existe pas.`, 400);

    const campaign = await CampaignModel.findById(participation.campaignId).lean<ICampaign>();

    target.status = DayStatus.VERIFIED;
    target.postedAt = target.postedAt ?? new Date();
    target.verifiedAt = new Date();
    target.viewCount = viewCount;
    target.deliveredCount = viewCount * 3;
    target.trackingLinkPresent = true;
    target.mediaMatches = true;
    target.statusMessageId = `simulated-${participationId}-${day}`;
    // The rate was fixed when the offer was made; earnings follow it, so a
    // simulated day is paid exactly like a real one.
    target.earnedAmount = Math.round(viewCount * (target.ratePerView ?? 0) * 100) / 100;

    participation.uniqueViews = participation.days.filter(d => d.day === 1 && d.status === DayStatus.VERIFIED)
        .reduce((n, d) => n + d.viewCount, 0);
    participation.repeatViews = participation.days.filter(d => d.day !== 1 && d.status === DayStatus.VERIFIED)
        .reduce((n, d) => n + d.viewCount, 0);
    participation.totalViews = participation.uniqueViews + participation.repeatViews;
    participation.totalEarned = Math.round(
        participation.days
            .filter(d => d.status === DayStatus.VERIFIED)
            .reduce((n, d) => n + d.earnedAmount, 0) * 100,
    ) / 100;

    if (participation.days.every(d => d.status === DayStatus.VERIFIED)
        && participation.status === ParticipationStatus.IN_PROGRESS) {
        participation.status = ParticipationStatus.COMPLETED;
        participation.completedAt = new Date();
    }

    await participation.save();

    // Campaign counters, recomputed rather than incremented — the same rule the
    // real verification path follows.
    if (campaign) {
        const all = await CampaignParticipationModel.find({ campaignId: campaign._id }).lean();
        await CampaignModel.updateOne({ _id: campaign._id }, {
            $set: {
                uniqueViewsDelivered: all.reduce((n, p) => n + (p.uniqueViews ?? 0), 0),
                repeatViewsDelivered: all.reduce((n, p) => n + (p.repeatViews ?? 0), 0),
            },
        });
    }

    log.warn(`SIMULATION: participation ${participationId} day ${day} verified with ${viewCount} views`);

    return {
        day,
        viewCount,
        earnedAmount: target.earnedAmount,
        participationStatus: participation.status,
        totalEarned: participation.totalEarned,
    };
};

/** Everything the simulation panel needs to show what state a run is in. */
export const simulationSnapshot = async (userId?: string) => {
    const filter = userId ? { diffuseurUserId: new Types.ObjectId(userId) } : {};
    const participations = await CampaignParticipationModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

    const campaigns = await CampaignModel.find({
        _id: { $in: participations.map(p => p.campaignId) },
    }).select('title status isTestCampaign').lean();
    const byId = new Map(campaigns.map(c => [String(c._id), c]));

    return participations.map(p => ({
        participationId: String(p._id),
        campaign: byId.get(String(p.campaignId))?.title ?? null,
        isTestCampaign: Boolean(byId.get(String(p.campaignId))?.isTestCampaign),
        status: p.status,
        totalViews: p.totalViews,
        totalEarned: p.totalEarned,
        creditedAt: p.creditedAt ?? null,
        days: (p.days ?? []).map(d => ({
            day: d.day,
            status: d.status,
            windowOpensAt: d.windowOpensAt ?? null,
            openNow: Boolean(d.windowOpensAt && d.windowOpensAt <= new Date()),
            viewCount: d.viewCount,
        })),
    }));
};

export const activeCampaignsForSimulation = async () =>
    CampaignModel.find({ status: { $in: [CampaignStatus.APPROVED, CampaignStatus.ACTIVE] } })
        .select('title status isTestCampaign targetUniqueViews uniqueViewsDelivered')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
