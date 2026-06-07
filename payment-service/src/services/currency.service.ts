import axios from 'axios';
import logger from '../utils/logger';

const log = logger.getLogger('CurrencyService');

// CFA franc family — XAF and XOF are pegged 1:1 and treated as interchangeable
// across the platform. Skip API call for these.
const CFA_FRANCS = new Set(['XAF', 'XOF']);

interface CachedRate {
    rate: number;
    fetchedAt: number;
}

/**
 * Centralized currency conversion using the open-source @fawazahmed0/currency-api
 * (https://github.com/fawazahmed0/exchange-api). The API serves daily-updated JSON
 * files from a CDN, with a fallback mirror, and requires no API key.
 *
 * Shape:
 *   GET .../v1/currencies/{from-lowercase}.json
 *   → { date: "...", "{from}": { "{to}": <rate>, ... } }
 *
 * Used by the payment flow for providers whose declared currency differs from our
 * internal XAF — e.g. MoneyFusion's RDC channel runs on USD, so a 2150 XAF
 * subscription must be sent as ~$3.58 USD to avoid the customer being shown a
 * wildly inflated amount on their mobile money operator's checkout.
 */
class CurrencyService {
    private cache: Map<string, CachedRate> = new Map();
    private readonly cacheTtlMs = 6 * 60 * 60 * 1000; // 6 hours — rates update daily
    private readonly httpTimeoutMs = 5000;

    private primaryUrl(from: string): string {
        return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`;
    }
    private fallbackUrl(from: string): string {
        return `https://latest.currency-api.pages.dev/v1/currencies/${from.toLowerCase()}.json`;
    }

    /**
     * Fetch a fresh exchange rate from the API (with mirror fallback). Returns null
     * on failure. Caches the rate for cacheTtlMs.
     */
    async getRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
        const from = fromCurrency.toUpperCase();
        const to = toCurrency.toUpperCase();

        if (from === to) return 1;

        // CFA franc pair → fixed 1:1 (no need to hit the API)
        if (CFA_FRANCS.has(from) && CFA_FRANCS.has(to)) return 1;

        const cacheKey = `${from}->${to}`;
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.fetchedAt) < this.cacheTtlMs) {
            return cached.rate;
        }

        const rate = await this.fetchRateWithFallback(from, to);
        if (rate !== null) {
            this.cache.set(cacheKey, { rate, fetchedAt: Date.now() });
        }
        return rate;
    }

    /**
     * Convert an amount. Soft: returns the original amount with a warning log if
     * the API is unreachable (caller must decide whether that's acceptable).
     * For real-money paths where an unconverted amount would overcharge users,
     * use convertStrict instead.
     */
    async convert(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
        const from = fromCurrency.toUpperCase();
        const to = toCurrency.toUpperCase();
        if (from === to) return amount;

        const rate = await this.getRate(from, to);
        if (rate === null) {
            log.warn(`Soft conversion: could not fetch ${from}->${to} rate; returning original amount ${amount}. Caller should consider convertStrict for money paths.`);
            return amount;
        }
        return this.round(amount * rate, to);
    }

    /**
     * Strict variant: throws if the rate cannot be fetched. Use on money paths
     * where sending an unconverted amount would over- or under-charge the user
     * (e.g. RDC payins where MoneyFusion expects USD but we operate in XAF).
     */
    async convertStrict(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
        const from = fromCurrency.toUpperCase();
        const to = toCurrency.toUpperCase();
        if (from === to) return amount;

        const rate = await this.getRate(from, to);
        if (rate === null || rate <= 0) {
            throw new Error(`Currency conversion failed: ${from}->${to} rate unavailable from upstream`);
        }
        return this.round(amount * rate, to);
    }

    private async fetchRateWithFallback(from: string, to: string): Promise<number | null> {
        const fromLower = from.toLowerCase();
        const toLower = to.toLowerCase();

        const tryUrl = async (url: string, label: string): Promise<number | null> => {
            try {
                const response = await axios.get(url, { timeout: this.httpTimeoutMs });
                const rate = response.data?.[fromLower]?.[toLower];
                if (typeof rate === 'number' && rate > 0) {
                    log.info(`[${label}] 1 ${from} = ${rate} ${to}`);
                    return rate;
                }
                log.warn(`[${label}] Rate ${from}->${to} not present in payload`);
                return null;
            } catch (error: any) {
                log.warn(`[${label}] Fetch failed: ${error.message}`);
                return null;
            }
        };

        const fromPrimary = await tryUrl(this.primaryUrl(from), 'currency-api/primary');
        if (fromPrimary !== null) return fromPrimary;

        const fromFallback = await tryUrl(this.fallbackUrl(from), 'currency-api/fallback');
        return fromFallback;
    }

    /**
     * Round to the precision appropriate for the target currency:
     * - USD/EUR/GBP: 2 decimal places (cents)
     * - Crypto (BTC, ETH, etc.): 8 decimal places (satoshi-level)
     * - Everything else (XAF, XOF, GNF, etc.): whole numbers
     */
    private round(value: number, currency: string): number {
        const cents = new Set(['USD', 'EUR', 'GBP']);
        const cryptos = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'LTC', 'XRP', 'ADA', 'DOT', 'SOL', 'MATIC', 'TRX']);
        if (cryptos.has(currency)) return parseFloat(value.toFixed(8));
        if (cents.has(currency)) return parseFloat(value.toFixed(2));
        return Math.round(value);
    }
}

export const currencyService = new CurrencyService();
export default currencyService;
