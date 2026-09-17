import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger';

const loadEnv = () => {
    const env = process.env.NODE_ENV || 'development';
    const envPath = path.resolve(__dirname, `../../.env.${env}`);
    const defaultEnvPath = path.resolve(__dirname, '../../.env');
    // dotenv never overwrites already-set vars, so .env.<NODE_ENV> wins and .env fills gaps.
    dotenv.config({ path: envPath });
    dotenv.config({ path: defaultEnvPath });
};

loadEnv();

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
    publicBaseUrl: string;
    mediaCdnBaseUrl: string;
    appBaseUrl: string;
    selfBaseUrl: string;
    /** ISO instant the module opens to non-admins. Empty = already open. */
    launchAt: string;
    /** HMAC secret used to sign QR tokens; failure to set = QR scans reject. */
    qrTokenSecret: string;
    commissions: {
        /** Fallback if settings-service unreachable. Live rate read from settings. */
        primaryPct: number;
        resalePct: number;
        defaultMaxResalePricePct: number;
    };
    minWithdrawalAmount: number;
    scheduler: {
        enabled: boolean;
        intervalMs: number;
    };
}

const port = parseInt(process.env.PORT || '3011', 10);

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port,
    host: process.env.HOST || '0.0.0.0',
    server: {
        bodyLimit: process.env.BODY_LIMIT || '10mb',
    },
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sbc_event_dev',
        options: {
            serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '5000', 10),
            // Event opens are the highest-QPS moment in the platform; default higher than other services.
            maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10),
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
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    mediaCdnBaseUrl: process.env.MEDIA_CDN_BASE_URL || 'https://storage.googleapis.com/sbc-file-storage',
    appBaseUrl: process.env.APP_BASE_URL || 'https://sniperbuisnesscenter.com',
    // Derived from running port, not hardcoded: preprod listens on 6011, and a fixed 3011 default
    // would have preprod's payment callbacks land on prod.
    selfBaseUrl: process.env.SELF_BASE_URL || `http://localhost:${port}`,
    launchAt: process.env.EVENT_LAUNCH_AT || '',
    qrTokenSecret: process.env.QR_TOKEN_SECRET || '',
    commissions: {
        primaryPct: parseFloat(process.env.PRIMARY_COMMISSION_PCT || '0.05'),
        resalePct: parseFloat(process.env.RESALE_COMMISSION_PCT || '0.10'),
        defaultMaxResalePricePct: parseFloat(process.env.DEFAULT_MAX_RESALE_PRICE_PCT || '120'),
    },
    minWithdrawalAmount: parseInt(process.env.MIN_WITHDRAWAL_AMOUNT || '2000', 10),
    scheduler: {
        enabled: (process.env.SCHEDULER_ENABLED || 'true') !== 'false',
        intervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '300000', 10),
    },
};

const log = logger.getLogger('Config');

if (!config.jwt.secret) {
    log.warn('JWT_SECRET is not set. Authenticated routes will reject every request.');
}
if (!config.services.serviceSecret) {
    log.warn('SERVICE_SECRET is not set. Service-to-service calls will fail.');
}
if (!config.qrTokenSecret) {
    log.warn('QR_TOKEN_SECRET is not set. QR signing will fail — every scan rejects.');
}

export default config;
