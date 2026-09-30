import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel, { IDiffuseurProfile } from '../database/models/diffuseur-profile.model';
import { ITargeting } from '../database/models/campaign.model';
import { getUserProfiles } from './clients/user.service.client';
import { getTestCampaign } from './test-campaign.service';
import { matchesTargeting } from './allocation.service';
import { Types } from 'mongoose';
import logger from '../utils/logger';

const log = logger.getLogger('ReachService');

/**
 * How many views the current diffuseur pool could actually deliver for a given
 * targeting.
 *
 * Exists because an annonceur could buy an audience we do not have. Georgi paid
 * 6000 F for 2000 unique views targeting Gabon + RDC, femmes 25-50 — which matches
 * 2 of 223 eligible diffuseurs (2026-09-05). Nothing anywhere told him, told the
 * admin validating it, or stopped it: the campaign would simply have gone live and
 * sat at zero, and he would have been right to be angry about it.
 *
 * Deliberately the same eligibility and matching rules allocation itself uses, so
 * the number shown is the number that will actually be offered to — not an
 * optimistic marketing estimate.
 */

export type ReachEstimate = {
    /** Diffuseurs who could take any paid campaign at all right now. */
    eligible: number;
    /** Of those, how many this targeting actually matches. */
    matching: number;
    /**
     * Unique views those matched diffuseurs are forecast to bring, in total.
     * Day 1 only — that is what an annonceur buys.
     */
    projectedUniqueViews: number;
    /** Views asked for, when the caller supplied a target. */
    targetUniqueViews?: number;
    /** Whether the pool can cover the target. Undefined when no target was given. */
    sufficient?: boolean;
};

const forecastFor = (p: Pick<IDiffuseurProfile, 'hasCompletedTestCampaign'> & {
    measuredAverageViews?: number | null;
    declaredAverageViews?: number | null;
}): number =>
    p.hasCompletedTestCampaign && p.measuredAverageViews != null
        ? p.measuredAverageViews
        : (p.declaredAverageViews ?? 0);

/**
 * @param excludeCampaignId when estimating for a campaign that already exists,
 *   the diffuseurs who have already turned it down or been offered it cannot be
 *   counted again — otherwise the admin sees reach that is no longer available.
 */
export const estimateReach = async (
    targeting: ITargeting,
    targetUniqueViews?: number,
    excludeCampaignId?: Types.ObjectId,
): Promise<ReachEstimate> => {
    const testCampaign = await getTestCampaign();
    const eligibility: Record<string, unknown> = { isActive: true, whatsappLid: { $exists: true } };
    if (testCampaign) eligibility.hasCompletedTestCampaign = true;

    const candidates = await DiffuseurProfileModel
        .find(eligibility)
        .select('userId hasCompletedTestCampaign measuredAverageViews declaredAverageViews')
        .lean<Array<{
            userId: Types.ObjectId;
            hasCompletedTestCampaign: boolean;
            measuredAverageViews?: number | null;
            declaredAverageViews?: number | null;
        }>>();

    let pool = candidates;

    if (excludeCampaignId) {
        const spent = await CampaignParticipationModel
            .find({
                campaignId: excludeCampaignId,
                status: { $in: [ParticipationStatus.DECLINED, ParticipationStatus.FORFEITED] },
            })
            .select('diffuseurUserId')
            .lean();
        const gone = new Set(spent.map(p => String(p.diffuseurUserId)));
        pool = pool.filter(c => !gone.has(String(c.userId)));
    }

    if (!pool.length) {
        return { eligible: 0, matching: 0, projectedUniqueViews: 0, targetUniqueViews, sufficient: false };
    }

    const users = await getUserProfiles(pool.map(c => String(c.userId)));
    const userById = new Map(users.map(u => [String(u._id), u]));

    let matching = 0;
    let projectedUniqueViews = 0;
    for (const c of pool) {
        const user = userById.get(String(c.userId));
        if (!user || !matchesTargeting(user, targeting)) continue;
        matching++;
        projectedUniqueViews += Math.max(0, forecastFor(c));
    }

    const estimate: ReachEstimate = {
        eligible: pool.length,
        matching,
        projectedUniqueViews,
        targetUniqueViews,
    };

    if (typeof targetUniqueViews === 'number' && targetUniqueViews > 0) {
        estimate.sufficient = projectedUniqueViews >= targetUniqueViews;
        if (!estimate.sufficient) {
            log.info(
                `Targeting reaches ${matching} diffuseur(s) for ~${projectedUniqueViews} views, `
                + `short of the ${targetUniqueViews} requested`,
            );
        }
    }

    return estimate;
};

/** A short sentence an annonceur or an admin can act on, in French. */
export const describeReach = (r: ReachEstimate): string => {
    if (r.matching === 0) {
        return 'Aucun diffuseur ne correspond à ces critères. Élargissez le ciblage, '
            + 'sinon la campagne ne pourra être proposée à personne.';
    }
    if (r.sufficient === false) {
        return `Ce ciblage touche ${r.matching} diffuseur(s), soit environ `
            + `${r.projectedUniqueViews} vues uniques — moins que les ${r.targetUniqueViews} `
            + 'demandées. Élargissez le ciblage pour obtenir toutes vos vues.';
    }
    return `Ce ciblage touche ${r.matching} diffuseur(s), soit environ `
        + `${r.projectedUniqueViews} vues uniques disponibles.`;
};
