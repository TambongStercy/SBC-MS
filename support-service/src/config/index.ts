import dotenv from 'dotenv';
import path from 'path';

/**
 * support-service configuration (CONTRACT.md §6).
 *
 * The service refuses to start without its secrets: an agent desk signed with
 * a default secret, or a TOTP store encrypted with a missing key, is worse
 * than no desk at all.
 */

const env = process.env.NODE_ENV || 'development';
if (env !== 'test') {
    // dotenv never overwrites already-set vars, so .env.<NODE_ENV> wins and .env fills gaps.
    dotenv.config({ path: path.resolve(__dirname, `../../.env.${env}`) });
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

export class ConfigError extends Error {}

const ensureNoTrailingSlash = (u: string) => u.replace(/\/+$/, '');

const intEnv = (name: string, def: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return def;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new ConfigError(`${name} must be an integer`);
    return n;
};

const required = (name: string, missing: string[]): string => {
    const v = (process.env[name] || '').trim();
    if (!v) missing.push(name);
    return v;
};

function load() {
    const nodeEnv = env;
    const isProd = nodeEnv === 'production';
    const missing: string[] = [];

    const supportJwtSecret = required('SUPPORT_JWT_SECRET', missing);
    const totpEncKeyRaw = required('TOTP_ENC_KEY', missing);
    const serviceSecret = required('SERVICE_SECRET', missing);
    const memberJwtSecret = required('JWT_SECRET', missing);
    if (missing.length) {
        throw new ConfigError(`support-service refuses to start: missing ${missing.join(', ')}`);
    }

    const totpEncKey = Buffer.from(totpEncKeyRaw, 'base64');
    if (totpEncKey.length !== 32) {
        throw new ConfigError('TOTP_ENC_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
    }
    if (supportJwtSecret.length < 32) {
        throw new ConfigError('SUPPORT_JWT_SECRET must be at least 32 characters');
    }
    if (supportJwtSecret === memberJwtSecret) {
        throw new ConfigError('SUPPORT_JWT_SECRET must differ from JWT_SECRET');
    }

    const mongoUri = process.env.MONGODB_URI || (isProd ? '' : 'mongodb://localhost:27017/sbc_support_dev');
    if (!mongoUri) throw new ConfigError('support-service refuses to start: missing MONGODB_URI');

    const publicUrl = ensureNoTrailingSlash(process.env.SUPPORT_PUBLIC_URL || (isProd ? '' : 'http://localhost:5174'));
    if (!publicUrl) throw new ConfigError('support-service refuses to start: missing SUPPORT_PUBLIC_URL');

    const allowedOrigins = (process.env.SUPPORT_ALLOWED_ORIGINS || publicUrl)
        .split(',').map((o) => ensureNoTrailingSlash(o.trim())).filter(Boolean);

    // Secure cookies are mandatory outside local development.
    const cookieSecure = (process.env.COOKIE_SECURE ?? 'true') !== 'false' || isProd;

    const port = intEnv('PORT', 3012);

    return {
        nodeEnv,
        isProd,
        isTest: nodeEnv === 'test',
        port,
        serviceName: 'support-service',
        mongoUri,
        redis: {
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            // Prod and preprod share one Redis on the host: keep their keys apart.
            keyPrefix: process.env.REDIS_KEY_PREFIX || `sbc-support:${nodeEnv}:`,
        },
        logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
        secrets: {
            supportJwt: supportJwtSecret,
            memberJwt: memberJwtSecret,
            service: serviceSecret,
            totpEncKey,
        },
        auth: {
            accessTtlSec: 15 * 60,
            idleTimeoutMs: 30 * 60 * 1000,
            absoluteTimeoutMs: 12 * 60 * 60 * 1000,
            challengeTtlSec: 5 * 60,
            reauthTtlSec: 5 * 60,
            activationTtlMs: 48 * 60 * 60 * 1000,
            /** Every login answer takes at least this long (no timing oracle). */
            loginMinMs: intEnv('LOGIN_MIN_MS', 700),
            cookieSecure,
            audience: 'sbc-support',
            issuer: 'sbc-support',
        },
        cookies: {
            access: 'sbc_sup_at',
            refresh: 'sbc_sup_rt',
            csrf: 'sbc_sup_csrf',
            accessPath: '/api/support/desk',
            refreshPath: '/api/support/desk/auth',
        },
        publicUrl,
        allowedOrigins,
        turnstileSecret: process.env.TURNSTILE_SECRET || '',
        services: {
            user: ensureNoTrailingSlash(process.env.USER_SERVICE_URL || 'http://localhost:3001'),
            payment: ensureNoTrailingSlash(process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003'),
            advertising: ensureNoTrailingSlash(process.env.ADVERTISING_SERVICE_URL || 'http://localhost:3010'),
            notification: ensureNoTrailingSlash(process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002'),
            timeoutMs: intEnv('SERVICE_TIMEOUT_MS', 8000),
        },
        deepseek: {
            apiKey: process.env.DEEPSEEK_API_KEY || '',
            model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            baseUrl: ensureNoTrailingSlash(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'),
            // USD per million tokens, used to keep the monthly budget.
            priceInPerM: parseFloat(process.env.DEEPSEEK_PRICE_IN_PER_M || '0.27'),
            priceOutPerM: parseFloat(process.env.DEEPSEEK_PRICE_OUT_PER_M || '1.10'),
        },
        r2: {
            accountId: process.env.R2_ACCOUNT_ID || '',
            accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
            // Private bucket for ticket attachments (presigned URLs only).
            privateBucket: process.env.R2_PRIVATE_BUCKET || 'sbc-support-private',
            keyPrefix: process.env.R2_SUPPORT_PREFIX || 'support/attachments',
        },
        memberAppUrl: ensureNoTrailingSlash(process.env.MEMBER_APP_URL || 'https://sniperbuisnesscenter.com'),
        jobsEnabled: (process.env.JOBS_ENABLED || 'true') !== 'false',
    };
}

export type Config = ReturnType<typeof load>;

const config: Config = load();

if (config.isProd && !config.turnstileSecret) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ level: 'warn', msg: 'TURNSTILE_SECRET is not set: agent login runs without Turnstile' }));
}

export default config;
