import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger';

// Load .env files - Attempts .env.<NODE_ENV> first, then falls back to .env
const loadEnv = () => {
    const env = process.env.NODE_ENV || 'development';
    const envPath = path.resolve(__dirname, `../../.env.${env}`);
    const defaultEnvPath = path.resolve(__dirname, '../../.env');

    // Both, always. dotenv never overwrites a variable that is already set, so
    // .env.<NODE_ENV> still wins and .env only fills gaps.
    //
    // The previous guard was `if (!process.env.PORT)`, which reads as "nothing
    // loaded yet" but is false whenever PM2 injects PORT — as the ecosystem
    // files do. The fallback therefore never ran under PM2, JWT_SECRET stayed
    // empty, and every authenticated route answered 500.
    dotenv.config({ path: envPath });
    dotenv.config({ path: defaultEnvPath });
};

loadEnv();

// Service-to-service calls all target the /api prefix
const ensureApiSuffix = (url: string | undefined, defaultUrl: string): string => {
    const baseUrl = url || defaultUrl;
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    server: {
        bodyLimit: string;
    };
    mongodb: {
        uri: string;
        options: {
            serverSelectionTimeoutMS: number;
            maxPoolSize: number;
        };
    };
    jwt: {
        secret: string;
    };
    services: {
        serviceSecret: string;
        userService: string;
        notificationService: string;
        settingsService: string;
        paymentService: string;
    };
    /** Public origin the tracking links and landing pages are served from. */
    publicBaseUrl: string;
    /** ISO instant the network opens to non-admins. Empty = already open. */
    launchAt: string;
    /**
     * The SBC web app. Where « Je m'inscris » on a landing page sends visitors.
     */
    appBaseUrl: string;
    /**
     * Where payment-service reaches us back. Service-to-service, so this is the
     * internal address, not the public one.
     */
    selfBaseUrl: string;
    /**
     * Commercial rules. Defaults follow the agreed spec
     * (docs/ADVERTISING-FEATURE-SPEC.md); env can override without a redeploy.
     */
    pricing: {
        /** What the advertiser pays per unique (day 1) view, in XAF. */
        advertiserPricePerUniqueView: number;
        /** What the diffuseur earns per view, indexed by campaign day (1-based). */
        diffuseurRatePerDay: number[];
        /** Minimum spend to launch a campaign, in XAF. */
        minCampaignAmount: number;
        /** Minimum payout from the advertising balance, in XAF. */
        minWithdrawalAmount: number;
    };
    campaign: {
        /** Days a diffuseur must post to complete a campaign. */
        durationDays: number;
        /**
         * Days for the recruitment test campaign only. Kept short (default 1) so a
         * new diffuseur becomes available fast; real campaigns still use
         * durationDays. Verification/completion iterate participation.days, so this
         * is independent of durationDays and does not touch the rate array.
         */
        testDurationDays: number;
        /** Extra days after the run to catch up on missed days before forfeiting. */
        graceDays: number;
        /** Max concurrent campaigns per diffuseur per day (relaxed when all are busy). */
        maxCampaignsPerDiffuseurPerDay: number;
        /**
         * Minimum gap between two campaign days, in hours.
         *
         * The 3-day structure exists so the advertiser's product is seen repeatedly
         * over time; three posts in one afternoon buy none of that. A full 24h so
         * the three posts genuinely span three days — a shorter gap would let each
         * post creep earlier than the last and compress the campaign.
         */
        minHoursBetweenDays: number;
        /**
         * Manual (video-proof) verification: seconds allowed between issuing the
         * on-screen code and the diffuseur uploading their screen recording. The
         * code appears in the video, so a short window proves the recording was
         * made fresh — an old video cannot carry a code that did not exist yet.
         */
        manualVerifyWindowSeconds: number;
    };
    referral: {
        /** Completed campaigns required to unlock the commission. */
        campaignsToUnlock: number;
        /** Share of SBC's margin paid to the referrer, as a fraction. */
        commissionRate: number;
        /** Days of being offered campaigns but completing none before suspension. */
        inactivityDays: number;
    };
}

const port = parseInt(process.env.PORT || '3010', 10);

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port,
    host: process.env.HOST || '0.0.0.0',
    server: {
        bodyLimit: process.env.BODY_LIMIT || '10mb',
    },
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sbc_advertising_dev',
        options: {
            serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '5000', 10),
            maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10),
        },
    },
    jwt: {
        secret: process.env.JWT_SECRET || '',
    },
    services: {
        serviceSecret: process.env.SERVICE_SECRET || '',
        userService: ensureApiSuffix(process.env.USER_SERVICE_URL, 'http://localhost:3001'),
        notificationService: ensureApiSuffix(process.env.NOTIFICATION_SERVICE_URL, 'http://localhost:3002'),
        settingsService: ensureApiSuffix(process.env.SETTINGS_SERVICE_URL, 'http://localhost:3007'),
        paymentService: ensureApiSuffix(process.env.PAYMENT_SERVICE_URL, 'http://localhost:3003'),
    },
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3010',
    // Rufus opens the network at the end of his Tuesday presentation. Set on
    // prod so the feature can ship days early and stay shut until then; admins
    // pass through so it can be rehearsed on the real thing.
    launchAt: process.env.ADS_NETWORK_LAUNCH_AT || '',
    appBaseUrl: process.env.APP_BASE_URL || 'https://sniperbuisnesscenter.com',
    // Derived from the running port, not hardcoded: preprod listens on 6010, and a
    // fixed 3010 default would have preprod's payment callbacks land on prod.
    selfBaseUrl: process.env.SELF_BASE_URL || `http://localhost:${port}`,
    pricing: {
        advertiserPricePerUniqueView: parseFloat(process.env.ADVERTISER_PRICE_PER_VIEW || '3'),
        diffuseurRatePerDay: (process.env.DIFFUSEUR_RATES || '1,0.5,0.25').split(',').map(parseFloat),
        minCampaignAmount: parseInt(process.env.MIN_CAMPAIGN_AMOUNT || '6000', 10),
        minWithdrawalAmount: parseInt(process.env.MIN_WITHDRAWAL_AMOUNT || '2000', 10),
    },
    campaign: {
        durationDays: parseInt(process.env.CAMPAIGN_DURATION_DAYS || '3', 10),
        testDurationDays: parseInt(process.env.TEST_CAMPAIGN_DURATION_DAYS || '1', 10),
        graceDays: parseInt(process.env.CAMPAIGN_GRACE_DAYS || '3', 10),
        maxCampaignsPerDiffuseurPerDay: parseInt(process.env.MAX_CAMPAIGNS_PER_DAY || '1', 10),
        minHoursBetweenDays: parseInt(process.env.MIN_HOURS_BETWEEN_DAYS || '24', 10),
        manualVerifyWindowSeconds: parseInt(process.env.MANUAL_VERIFY_WINDOW_SECONDS || '900', 10),
    },
    referral: {
        campaignsToUnlock: parseInt(process.env.REFERRAL_CAMPAIGNS_TO_UNLOCK || '100', 10),
        commissionRate: parseFloat(process.env.REFERRAL_COMMISSION_RATE || '0.20'),
        inactivityDays: parseInt(process.env.REFERRAL_INACTIVITY_DAYS || '30', 10),
    },
};

const log = logger.getLogger('Config');

if (!config.jwt.secret) {
    log.warn('JWT_SECRET is not set. Authenticated routes will reject every request.');
}
if (!config.services.serviceSecret) {
    log.warn('SERVICE_SECRET is not set. Service-to-service calls will fail.');
}
if (config.pricing.diffuseurRatePerDay.length !== config.campaign.durationDays) {
    // A mismatch silently underpays or overpays on the last day, so fail loudly.
    log.error(
        `DIFFUSEUR_RATES has ${config.pricing.diffuseurRatePerDay.length} entries but ` +
        `CAMPAIGN_DURATION_DAYS is ${config.campaign.durationDays}. These must match.`
    );
}

export default config;
