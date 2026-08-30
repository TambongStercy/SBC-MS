import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Helper to ensure URL has /api suffix for service-to-service communication
const ensureApiSuffix = (url: string | undefined, defaultUrl: string): string => {
    const baseUrl = url || defaultUrl;
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

// Define config interface for type safety
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    server: {
        bodyLimit: string;
        cors: {
            origin: string;
            methods: string[];
            allowedHeaders: string[];
        };
    };
    mongodb: {
        uri: string;
        options: {
            serverSelectionTimeoutMS: number;
            socketTimeoutMS?: number;
            family?: number;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    sso: {
        // SEPARATE secret from the main user JWT — keeps SSO access tokens and SBC user
        // JWTs non-interchangeable. Compromise of one secret should not let an attacker
        // mint tokens of the other class.
        jwtSecret: string;
        accessTokenTtl: string;   // jsonwebtoken expiresIn syntax — e.g. "1h"
        refreshTokenTtl: string;
    };
    services: {
        serviceSecret: string;
        userService: string;
        paymentService: string;
        notificationService: string;
        productService: string;
        apiGateway: string;
        settingsService?: string;
        tombolaService?: string;
    };
    logging: {
        level: string;
        format: string;
    };
    withdrawal: {
        dailyLimit: number;
        maxTransactionsPerDay: number;
    };
    selfBaseUrl: string;
    /**
     * Monthly leaderboard bonus (see leaderboard-bonus.service).
     *
     * These thresholds and amounts are the ones members are shown in the app's
     * reward table (ui/src/lib/leaderTiers.ts) — the two must stay in step, so
     * change them here and there together, or not at all.
     */
    leaderboardBonus: {
        enabled: boolean;
        /** Ascending by threshold; the highest one a member reaches is paid. */
        tiers: { key: 'leader' | 'gold' | 'elite'; minSales: number; amountXaf: number }[];
        /** node-cron expression, evaluated in `timezone`. */
        cron: string;
        timezone: string;
        /**
         * First month the bonus is ever paid for, 'YYYY-MM'. Months before it
         * are refused on every path — the programme starts here, and no back
         * pay is owed for the months the feature did not exist.
         */
        firstPaidMonth: string;
    };
}

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',

    server: {
        bodyLimit: process.env.BODY_LIMIT || '10mb',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }
    },

    mongodb: {
        uri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD as string : process.env.MONGODB_URI_DEV as string,
        options: {
            serverSelectionTimeoutMS: 60000,
            socketTimeoutMS: 45000,
        }
    },

    jwt: {
        secret: process.env.JWT_SECRET || 'your_jwt_secret',
        expiresIn: process.env.JWT_EXPIRATION || '1d'
    },

    sso: {
        jwtSecret: process.env.SSO_JWT_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        accessTokenTtl: process.env.SSO_ACCESS_TOKEN_TTL || '1h',
        refreshTokenTtl: process.env.SSO_REFRESH_TOKEN_TTL || '30d',
    },

    services: {
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userService: ensureApiSuffix(process.env.USER_SERVICE_URL, 'http://localhost:3001'),
        paymentService: ensureApiSuffix(process.env.PAYMENT_SERVICE_URL, 'http://localhost:3003'),
        notificationService: ensureApiSuffix(process.env.NOTIFICATION_SERVICE_URL, 'http://localhost:3002'),
        productService: ensureApiSuffix(process.env.PRODUCT_SERVICE_URL, 'http://localhost:3004'),
        apiGateway: ensureApiSuffix(process.env.API_GATEWAY_URL, 'http://localhost:3000'),
        settingsService: process.env.SETTINGS_SERVICE_URL ? ensureApiSuffix(process.env.SETTINGS_SERVICE_URL, '') : undefined,
        tombolaService: process.env.TOMBOLA_SERVICE_URL ? ensureApiSuffix(process.env.TOMBOLA_SERVICE_URL, '') : undefined,
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    withdrawal: {
        dailyLimit: Number(process.env.DAILY_WITHDRAWAL_LIMIT) || 50000,
        maxTransactionsPerDay: Number(process.env.MAX_WITHDRAWALS_PER_DAY) || 3
    },

    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3001',

    leaderboardBonus: {
        // Off by default: turning it on is a deliberate act, because the first
        // run moves real money for every qualifying member.
        enabled: (process.env.LEADERBOARD_BONUS_ENABLED || 'false').toLowerCase() === 'true',
        tiers: [
            { key: 'leader', minSales: Number(process.env.LEADERBOARD_TIER1_SALES) || 30, amountXaf: Number(process.env.LEADERBOARD_TIER1_XAF) || 2000 },
            { key: 'gold', minSales: Number(process.env.LEADERBOARD_TIER2_SALES) || 120, amountXaf: Number(process.env.LEADERBOARD_TIER2_XAF) || 10000 },
            { key: 'elite', minSales: Number(process.env.LEADERBOARD_TIER3_SALES) || 320, amountXaf: Number(process.env.LEADERBOARD_TIER3_XAF) || 50000 },
        ],
        // 03:00 on the 1st, Douala time: the month it pays for is closed, and
        // the hour is quiet.
        cron: process.env.LEADERBOARD_BONUS_CRON || '0 3 1 * *',
        timezone: process.env.LEADERBOARD_BONUS_TZ || 'Africa/Douala',
        // September 2026 is the first counted month, so the first payout runs
        // on 1 October 2026 — once September has actually closed.
        firstPaidMonth: process.env.LEADERBOARD_BONUS_FIRST_MONTH || '2026-09',
    }
};

// Validation function for required configurations
const validateConfig = (): void => {
    const requiredEnvs = [
        'JWT_SECRET',
        'SERVICE_SECRET'
    ];

    // Only validate these in production
    if (config.nodeEnv === 'production') {
        requiredEnvs.push(
            'DAILY_WITHDRAWAL_LIMIT',
            'MAX_WITHDRAWALS_PER_DAY'
        );
    }

    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);

    if (missingEnvs.length > 0) {
        logger.error(`Missing required environment variables: ${missingEnvs.join(', ')}`);
        process.exit(1);
    }
};

// Run validation in production
if (config.nodeEnv === 'production') {
    validateConfig();
}

export default config; 