import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SettingsServiceClient');

const client = axios.create({
    baseURL: config.services.settingsService,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'event-service',
    },
});

interface CommissionConfig {
    primaryPct: number;
    resalePct: number;
    defaultMaxResalePricePct: number;
}

let cache: { at: number; value: CommissionConfig } | null = null;
const TTL_MS = 60_000;

/**
 * Fetch commission rates from settings-service. Cached for 60s so a high-QPS
 * ticket sale doesn't hammer settings on every purchase. Falls back to env
 * defaults if settings-service is unreachable — the sale must proceed.
 */
export const getCommissionConfig = async (): Promise<CommissionConfig> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    try {
        const { data } = await client.get('/settings/event-commissions');
        if (data?.success && data?.data) {
            const value: CommissionConfig = {
                primaryPct: Number(data.data.primaryPct ?? config.commissions.primaryPct),
                resalePct: Number(data.data.resalePct ?? config.commissions.resalePct),
                defaultMaxResalePricePct: Number(data.data.defaultMaxResalePricePct ?? config.commissions.defaultMaxResalePricePct),
            };
            cache = { at: Date.now(), value };
            return value;
        }
    } catch (err) {
        log.warn(`Falling back to env commissions: ${(err as Error).message}`);
    }
    const fallback: CommissionConfig = { ...config.commissions };
    cache = { at: Date.now(), value: fallback };
    return fallback;
};

export const invalidateCommissionCache = () => { cache = null; };
