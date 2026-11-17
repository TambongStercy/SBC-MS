/**
 * `?country=` for the admin lists and dashboard (admin plan, phase 3).
 *
 * Campaigns (and everything hanging off a campaign: participations paid out,
 * media changes) belong to the ANNONCEUR's country — not to the countries the
 * campaign targets. Diffuseur profiles and video proofs belong to the
 * DIFFUSEUR's country. Each match is the country's members intersected with the
 * owners actually present in the collection, so the `$in` stays short.
 */
import { Types } from 'mongoose';
import CampaignModel from '../database/models/campaign.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import { countryMembersAmong } from '../utils/country-members';

/** `{ advertiserUserId: { $in } }` for the annonceurs of the country, `{}` without a country. */
export const advertiserMatch = async (country?: string): Promise<Record<string, unknown>> => {
    if (!country) return {};
    const owners = await CampaignModel.distinct('advertiserUserId');
    return { advertiserUserId: { $in: await countryMembersAmong(country, owners) } };
};

/** Ids of the campaigns whose annonceur is in the country; null without a country. */
export const advertiserCampaignIds = async (country?: string): Promise<Types.ObjectId[] | null> => {
    if (!country) return null;
    return (await CampaignModel.distinct('_id', await advertiserMatch(country))) as Types.ObjectId[];
};

/** `{ [field]: { $in } }` for the diffuseurs of the country, `{}` without a country. */
export const diffuseurMatch = async (field: string, country?: string): Promise<Record<string, unknown>> => {
    if (!country) return {};
    // Every diffuseur has a profile (participations and proofs require one).
    const diffuseurs = await DiffuseurProfileModel.distinct('userId');
    return { [field]: { $in: await countryMembersAmong(country, diffuseurs) } };
};
