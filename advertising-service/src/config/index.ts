import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger';

// Load .env files - Attempts .env.<NODE_ENV> first, then falls back to .env
const loadEnv = () => {
    const env = process.env.NODE_ENV || 'development';
    const envPath = path.resolve(__dirname, `../../.env.${env}`);
    const defaultEnvPath = path.resolve(__dirname, '../../.env');

    dotenv.config({ path: envPath });

    if (!process.env.PORT) {
        dotenv.config({ path: defaultEnvPath });
    }
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
        /** Extra days after the run to catch up on missed days before forfeiting. */
        graceDays: number;
        /** Max concurrent campaigns per diffuseur per day (relaxed when all are busy). */
        maxCampaignsPerDiffuseurPerDay: number;
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

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3010', 10),
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
    pricing: {
        advertiserPricePerUniqueView: parseFloat(process.env.ADVERTISER_PRICE_PER_VIEW || '3'),
        diffuseurRatePerDay: (process.env.DIFFUSEUR_RATES || '1,0.5,0.25').split(',').map(parseFloat),
        minCampaignAmount: parseInt(process.env.MIN_CAMPAIGN_AMOUNT || '6000', 10),
        minWithdrawalAmount: parseInt(process.env.MIN_WITHDRAWAL_AMOUNT || '2000', 10),
    },
    campaign: {
        durationDays: parseInt(process.env.CAMPAIGN_DURATION_DAYS || '3', 10),
        graceDays: parseInt(process.env.CAMPAIGN_GRACE_DAYS || '3', 10),
        maxCampaignsPerDiffuseurPerDay: parseInt(process.env.MAX_CAMPAIGNS_PER_DAY || '1', 10),
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
