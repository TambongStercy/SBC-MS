import { Request, Response } from 'express';
import CampaignModel, { CampaignStatus, ICampaign } from '../../database/models/campaign.model';
import CampaignParticipationModel from '../../database/models/campaign-participation.model';
import { ClickAction } from '../../database/models/click-event.model';
import { recordClick } from '../../services/tracking.service';
import { getUserProfile } from '../../services/clients/user.service.client';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('PublicController');

/** Media is served through settings-service, which owns file storage. */
const mediaUrl = (fileId: string) =>
    `${config.services.settingsService.replace(/\/api$/, '')}/api/settings/files/${fileId}`;

/** Only live campaigns are publicly visible; drafts and cancelled ones 404. */
const isViewable = (c: ICampaign) =>
    c.status === CampaignStatus.ACTIVE || c.status === CampaignStatus.COMPLETED;

type Resolved = { campaign: ICampaign; trackingCode?: string; diffuseurUserId?: string };

/**
 * Both entry points land here: /s/:trackingCode (a diffuseur's link) and
 * /a/:slug (the campaign's own URL, untracked).
 */
const resolve = async (req: Request): Promise<Resolved | null> => {
    const { trackingCode, slug } = req.params;

    if (trackingCode) {
        const participation = await CampaignParticipationModel
            .findOne({ trackingCode })
            .select('campaignId diffuseurUserId')
            .lean();
        if (!participation) return null;
        const campaign = await CampaignModel.findById(participation.campaignId);
        return campaign
            ? { campaign, trackingCode, diffuseurUserId: String(participation.diffuseurUserId) }
            : null;
    }

    const campaign = await CampaignModel.findOne({ landingPageSlug: slug });
    return campaign ? { campaign } : null;
};

export const renderLandingPage = async (req: Request, res: Response) => {
    try {
        const resolved = await resolve(req);
        if (!resolved || !isViewable(resolved.campaign)) {
            return res.status(404).render('not-found');
        }

        const { campaign, trackingCode } = resolved;

        // Fire and forget: the visitor should never wait on analytics.
        void recordClick({ req, trackingCode, campaignId: campaign._id, action: ClickAction.VIEW });

        const actionBase = trackingCode ? `/c/${trackingCode}` : `/c/slug/${campaign.landingPageSlug}`;

        return res.render('landing', {
            title: campaign.title,
            description: campaign.description,
            mediaUrl: mediaUrl(campaign.mediaFileId),
            mediaType: campaign.mediaType,
            hasWhatsapp: Boolean(campaign.contactWhatsapp),
            hasPhone: Boolean(campaign.contactPhone),
            hasWebsite: Boolean(campaign.websiteUrl),
            whatsappUrl: `${actionBase}/whatsapp`,
            callUrl: `${actionBase}/call`,
            siteUrl: `${actionBase}/site`,
            // The tracking link doubles as the diffuseur's affiliate link, so a
            // visitor who joins SBC through it is credited to them. Only shown on
            // a diffuseur's link — /a/:slug has nobody to credit.
            hasSignup: Boolean(trackingCode),
            signupUrl: `${actionBase}/signup`,
        });
    } catch (err) {
        log.error('Failed to render landing page:', err);
        return res.status(500).render('not-found');
    }
};

const ACTIONS: Record<string, { action: ClickAction; target: (c: ICampaign) => string | undefined }> = {
    whatsapp: {
        action: ClickAction.CONTACT_WHATSAPP,
        // wa.me wants digits only, no +, no spaces.
        target: c => c.contactWhatsapp && `https://wa.me/${c.contactWhatsapp.replace(/\D/g, '')}`,
    },
    call: {
        action: ClickAction.CALL,
        target: c => c.contactPhone && `tel:${c.contactPhone.replace(/[^\d+]/g, '')}`,
    },
    site: {
        action: ClickAction.VISIT_SITE,
        target: c => c.websiteUrl,
    },
};

/**
 * Records the click, then redirects. The redirect happens regardless of whether
 * recording succeeded.
 */
export const handleAction = async (req: Request, res: Response) => {
    try {
        const resolved = await resolve(req);
        if (!resolved || !isViewable(resolved.campaign)) {
            return res.status(404).render('not-found');
        }

        // Signup is not a campaign contact method — it sends the visitor to SBC
        // carrying the diffuseur's referral code, so it resolves its target from
        // the diffuseur rather than from the campaign.
        if (req.params.action === 'signup') {
            if (!resolved.diffuseurUserId) return res.status(404).render('not-found');

            await recordClick({
                req,
                trackingCode: resolved.trackingCode,
                campaignId: resolved.campaign._id,
                action: ClickAction.SIGNUP,
            });

            // A missing referral code costs the diffuseur the credit but must not
            // cost the visitor the signup.
            const profile = await getUserProfile(resolved.diffuseurUserId).catch(() => null);
            const signupUrl = new URL('/signup', config.appBaseUrl);
            if (profile?.referralCode) signupUrl.searchParams.set('affiliationCode', profile.referralCode);

            return res.redirect(302, signupUrl.toString());
        }

        const spec = ACTIONS[req.params.action];
        if (!spec) return res.status(404).render('not-found');

        const target = spec.target(resolved.campaign);
        if (!target) return res.status(404).render('not-found');

        await recordClick({
            req,
            trackingCode: resolved.trackingCode,
            campaignId: resolved.campaign._id,
            action: spec.action,
        });

        return res.redirect(302, target);
    } catch (err) {
        log.error('Failed to handle landing page action:', err);
        return res.status(500).render('not-found');
    }
};
