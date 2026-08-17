import { Request, Response } from 'express';
import CampaignModel, { CampaignStatus, ICampaign } from '../../database/models/campaign.model';
import CampaignParticipationModel from '../../database/models/campaign-participation.model';
import { ClickAction } from '../../database/models/click-event.model';
import { createHmac, timingSafeEqual } from 'crypto';
import { recordClick } from '../../services/tracking.service';
import { getUserProfile } from '../../services/clients/user.service.client';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('PublicController');

/** Media is served through settings-service, which owns file storage. */
/**
 * Public URL for a stored file.
 *
 * Built from the app's public origin, NOT from services.settingsService — that
 * one is an internal address (http://localhost:6007) and this HTML is rendered
 * for strangers on the internet, who cannot reach it. Every image and video on
 * every landing page was broken because of it.
 *
 * Encoded: uploaded filenames can contain spaces.
 */
const mediaUrl = (fileId: string) =>
    `${config.appBaseUrl.replace(/\/$/, '')}/api/settings/files/${encodeURIComponent(fileId)}`;

/** Only live campaigns are publicly visible; drafts and cancelled ones 404. */
const isViewable = (c: ICampaign) =>
    c.status === CampaignStatus.ACTIVE || c.status === CampaignStatus.COMPLETED;

/**
 * Signature that lets an admin open a campaign's landing page before it is live.
 *
 * An admin has to see the page to judge it, but the page is deliberately hidden
 * until the campaign is approved and paid. A JWT cannot ride along in a link the
 * admin clicks, so the review queue is handed a signed URL instead: derived from
 * the slug and SERVICE_SECRET, so it cannot be guessed and grants nothing beyond
 * viewing that one campaign.
 */
export const previewSignature = (slug: string): string =>
    createHmac('sha256', config.services.serviceSecret).update(`preview:${slug}`).digest('hex').slice(0, 32);

const previewSignatureValid = (slug: string, provided: unknown): boolean => {
    if (typeof provided !== 'string' || !provided) return false;
    const expected = previewSignature(slug);
    if (provided.length !== expected.length) return false;
    // Constant-time: a length-safe compare stops the signature being recovered
    // one character at a time.
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
};

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
        if (!resolved) return res.status(404).render('not-found');

        const { campaign, trackingCode } = resolved;
        const isPreview = previewSignatureValid(campaign.landingPageSlug, req.query.preview);
        if (!isViewable(campaign) && !isPreview) {
            return res.status(404).render('not-found');
        }

        // Fire and forget: the visitor should never wait on analytics.
        // Not for previews — an admin checking the page is not a prospect, and
        // counting them would inflate the annonceur's numbers before launch.
        if (!isPreview) {
            void recordClick({ req, trackingCode, campaignId: campaign._id, action: ClickAction.VIEW });
        }

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
            // The test campaign sells nothing — its page is the recruitment
            // pitch, so the signup button is the whole point rather than a
            // footer extra, and it shows even without a tracking code.
            isTestCampaign: Boolean(campaign.isTestCampaign),
            landingVideoUrl: campaign.landingVideoFileId ? mediaUrl(campaign.landingVideoFileId) : null,
            hasSignup: Boolean(trackingCode) || Boolean(campaign.isTestCampaign),
            isPreview,
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
        //
        // Prefilled message, per Rufus: an annonceur receiving a bare "Bonjour"
        // has no idea which campaign produced it. Naming the campaign and SBC Ads
        // Network makes the lead self-identifying, the way the marketplace already
        // works.
        target: c => c.contactWhatsapp && `https://wa.me/${c.contactWhatsapp.replace(/\D/g, '')}/?text=${encodeURIComponent(
            `Bonjour, je suis intéressé(e) par « ${c.title} », vu sur SBC Ads Network.`,
        )}`,
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
            // Untracked signups are allowed on the test campaign: it is SBC's own
            // recruitment page, so there is simply nobody to credit rather than
            // an attribution that went missing.
            if (!resolved.diffuseurUserId && !resolved.campaign.isTestCampaign) {
                return res.status(404).render('not-found');
            }

            await recordClick({
                req,
                trackingCode: resolved.trackingCode,
                campaignId: resolved.campaign._id,
                action: ClickAction.SIGNUP,
            });

            // A missing referral code costs the diffuseur the credit but must not
            // cost the visitor the signup.
            const profile = resolved.diffuseurUserId
                ? await getUserProfile(resolved.diffuseurUserId).catch(() => null)
                : null;
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
