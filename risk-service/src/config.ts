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
};
export type Config = typeof config;
