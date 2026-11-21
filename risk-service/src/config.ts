import dotenv from 'dotenv';
dotenv.config();

/**
 * risk-service settings (Security plan Phase 4). See .env.example.
 * Refuses to start without its database, the service secret and the hashing key.
 */
const req = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is required`);
    return v;
};
const num = (name: string, d: number) => (Number.isFinite(Number(process.env[name])) && process.env[name] !== '' && process.env[name] !== undefined ? Number(process.env[name]) : d);

export const config = {
    port: num('PORT', 3013),
    mongoUri: req('MONGODB_URI'),
    serviceSecret: req('SERVICE_SECRET'),
    /** HMAC key for identifiers (numbers, devices): risk-service never stores them in clear. Never rotate. */
    hashKey: req('RISK_HASH_KEY'),
    redisUrl: process.env.REDIS_URL || '',
    supportUrl: (process.env.SUPPORT_SERVICE_URL || '').replace(/\/+$/, ''),
    /** An identifier shared by more accounts than this is a hub (carrier IP, shop number) and stops linking. */
    hubThreshold: num('RISK_HUB_THRESHOLD', 50),
    thresholds: { requireCode: num('RISK_REQUIRE_CODE_AT', 40), hold: num('RISK_HOLD_AT', 70) },
    /** Rules switched off (comma-separated ids), without redeploying. */
    disabledRules: new Set((process.env.RISK_DISABLED_RULES || '').split(',').map(s => s.trim()).filter(Boolean)),
    /**
     * Security plan Phase 8: KYC level 1. On when the worker URL, its secret and the users
     * database are all set; hints are still queued without them (and checked once they are).
     */
    kyc: {
        workerUrl: (process.env.KYC_WORKER_URL || '').replace(/\/+$/, ''),
        secret: process.env.KYC_SHARED_SECRET || '',
        /** Read-only: the member fields the checks need (email, phone, MoMo, countries). */
        usersMongoUri: process.env.USERS_MONGODB_URI || '',
        /** Members sent per second (one batch a second). 50/s backfills 386,000 members in ~2 h. */
        perSecond: Math.max(1, Math.min(500, num('KYC_PER_SECOND', 50))),
        /** Douala hours when the backfill / refresh runs (start inclusive, end exclusive). */
        nightFrom: num('KYC_NIGHT_FROM', 2),
        nightTo: num('KYC_NIGHT_TO', 5),
        /** Preprod tests only: process backfill rows outside the night window. */
        backfillAnytime: String(process.env.KYC_BACKFILL_ANYTIME || '').toLowerCase() === 'true',
        /** Results are kept this long, then deleted by a TTL index (plan: 12 months). */
        retentionDays: num('KYC_RETENTION_DAYS', 365),
        /** Points added in risk-service: another account's address reaches the same mailbox. */
        variantPoints: num('KYC_EMAIL_VARIANT_POINTS', 20),
        disabled: String(process.env.KYC_DISABLED || '').toLowerCase() === 'true',
    },
};
export type Config = typeof config;
