import { CAMPAIGN_STATUS_LABELS, type AdsCampaign, type CampaignStatus } from '../../api/adsNetwork';
import type { StatusMap, Tone } from '../moduleKit';

const CAMPAIGN_TONES: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'info',
  paid: 'warning',
  rejected: 'danger',
  active: 'success',
  paused: 'neutral',
  completed: 'primary',
  banked: 'neutral',
  cancelled: 'neutral',
};

/** Campaign status in words (advertising-service CampaignStatus). */
export const CAMPAIGN_STATUS: StatusMap = Object.fromEntries(
  (Object.keys(CAMPAIGN_STATUS_LABELS) as CampaignStatus[]).map(s => [s, [CAMPAIGN_STATUS_LABELS[s], CAMPAIGN_TONES[s]] as const]),
);

export const ALL_CAMPAIGN_STATUSES = Object.keys(CAMPAIGN_STATUS_LABELS) as CampaignStatus[];

/** A diffuseur's participation, in words (advertising-service ParticipationStatus). */
export const PARTICIPATION_STATUS: StatusMap = {
  offered: ['Offre envoyée', 'info'],
  declined: ['Refusée', 'neutral'],
  expired: ['Expirée', 'neutral'],
  in_progress: ['En cours', 'warning'],
  completed: ['Terminée', 'success'],
  forfeited: ['Abandonnée', 'danger'],
};

export const targetingSummary = (c: Pick<AdsCampaign, 'targeting'>): string => {
  const t = c.targeting || {};
  const bits: string[] = [];
  if (t.countries?.length) bits.push(t.countries.join(', '));
  if (t.regions?.length) bits.push(t.regions.join(', '));
  if (t.cities?.length) bits.push(t.cities.join(', '));
  if (t.sex?.length) bits.push(t.sex.join('/'));
  if (t.minAge || t.maxAge) bits.push(`${t.minAge ?? '?'}–${t.maxAge ?? '?'} ans`);
  if (t.interests?.length) bits.push(t.interests.join(', '));
  if (t.professions?.length) bits.push(t.professions.join(', '));
  if (t.languages?.length) bits.push(t.languages.join(', '));
  return bits.length ? bits.join(' · ') : 'Aucun ciblage : proposée à tous les diffuseurs';
};
