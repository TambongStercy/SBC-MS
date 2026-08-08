/**
 * Asserts the landing-page action redirects.
 *
 * These URLs are what a prospect actually taps after seeing a status. A wrong
 * redirect here does not error anywhere — the visitor simply lands somewhere
 * useless and the lead is gone.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-landing.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel from '../database/models/campaign-participation.model';
import * as userClient from '../services/clients/user.service.client';
import * as tracking from '../services/tracking.service';

const DB = process.env.LANDING_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_landing_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

// Clicks are analytics; they must never decide where a visitor ends up.
(tracking as any).recordClick = async () => undefined;
(userClient as any).getUserProfile = async () => ({ _id: 'u1', referralCode: 'ABC123' });

// Imported after the stubs so the controller picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleAction } = require('../api/controllers/public.controller');

/** Runs handleAction and returns where it sent the visitor, plus the status code. */
const act = async (params: Record<string, string>) => {
    let code = 200;
    let location: string | undefined;
    const res: any = {
        status(n: number) { code = n; return this; },
        redirect(n: number, url: string) { code = n; location = url; return this; },
        render() { return this; },
    };
    await handleAction({ params, headers: {}, ip: '1.2.3.4' } as any, res);
    return { code, location };
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Chaussures Nike Air',
        mediaFileId: 'f',
        mediaType: 'image',
        landingPageSlug: `slug${Date.now()}`,
        contactWhatsapp: '+237 675 08 04 77',
        contactPhone: '+237675080477',
        websiteUrl: 'https://example.com',
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.ACTIVE,
    });

    const trackingCode = 'trk12345';
    await CampaignParticipationModel.create({
        campaignId: campaign._id,
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode,
    });

    // --- WhatsApp, with Rufus's prefilled message ---
    const wa = await act({ trackingCode, action: 'whatsapp' });
    check('whatsapp redirects to wa.me', wa.location?.startsWith('https://wa.me/237675080477') === true, wa.location);
    check(
        'the number is digits only',
        wa.location?.includes('237675080477') === true && !wa.location?.includes('+'),
        'wa.me rejects +, spaces and punctuation',
    );

    const decoded = decodeURIComponent(wa.location ?? '');
    check(
        'the message names the campaign',
        decoded.includes('Chaussures Nike Air'),
        'an annonceur receiving a bare "Bonjour" cannot tell which campaign it came from',
    );
    check('the message credits SBC Ads Network', decoded.includes('SBC Ads Network'));
    check('the message is passed as ?text=', wa.location?.includes('?text=') === true);
    check(
        'the message is URL-encoded',
        !wa.location?.includes(' ') && wa.location?.includes('%') === true,
        'a raw space would truncate the message in some clients',
    );

    // --- The other contact actions ---
    const call = await act({ trackingCode, action: 'call' });
    check('call redirects to tel:', call.location === 'tel:+237675080477', call.location);

    const site = await act({ trackingCode, action: 'site' });
    check('site redirects to the advertiser URL', site.location === 'https://example.com', site.location);

    // --- Signup carries the diffuseur's referral code ---
    const signup = await act({ trackingCode, action: 'signup' });
    check(
        'signup credits the diffuseur',
        signup.location?.includes('affiliationCode=ABC123') === true,
        signup.location,
    );

    // The campaign's own URL has no diffuseur, so there is nobody to credit.
    const slugSignup = await act({ slug: campaign.landingPageSlug, action: 'signup' });
    check('signup is refused on the untracked campaign URL', slugSignup.code === 404, `code ${slugSignup.code}`);

    const slugWa = await act({ slug: campaign.landingPageSlug, action: 'whatsapp' });
    check('contact actions still work on the untracked URL', slugWa.location?.includes('wa.me') === true);

    // --- A campaign that is not live must not be reachable ---
    await CampaignModel.updateOne({ _id: campaign._id }, { $set: { status: CampaignStatus.DRAFT } });
    const draft = await act({ trackingCode, action: 'whatsapp' });
    check('a draft campaign 404s', draft.code === 404, `code ${draft.code}`);

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
