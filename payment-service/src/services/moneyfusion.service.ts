import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import * as sandbox from './sandbox.service';

const log = logger.getLogger('MoneyFusionService');

// --- Payin Types ---

export interface MoneyFusionPayinRequest {
    amount: number;
    phoneNumber: string;
    customerName: string;
    returnUrl?: string;
    webhookUrl?: string;
    personalInfo?: Record<string, any>;
}

export interface MoneyFusionPayinResult {
    success: boolean;
    token?: string;
    checkoutUrl?: string;
    message: string;
}

// --- Payout Types ---

export interface MoneyFusionPayoutRequest {
    countryCode: string;
    phone: string;
    amount: number;
    withdrawMode: string;
    webhookUrl?: string;
}

export interface MoneyFusionPayoutResult {
    success: boolean;
    tokenPay?: string;
    message: string;
}

// --- MoneyFusion payin currency per country ---
// Source: GET https://pay.moneyfusion.net/api/v1/withdraw/methods (returns one currency
// field per country). MF treats RDC payins as USD and Guinée-Conakry as GNF, while
// every other country we route to MF uses XAF or XOF (which our platform handles
// as 1:1 with XAF — our internal currency). For non-CFA destinations we must
// convert XAF -> destination currency BEFORE calling initiatePayment, otherwise
// MF takes our XAF figure literally and the customer is asked to pay e.g. $2150 USD.
const MF_PAYIN_CURRENCY: Record<string, string> = {
    BF: 'XOF',
    BJ: 'XOF',
    CI: 'XOF',
    GW: 'XOF',
    ML: 'XOF',
    NE: 'XOF',
    SN: 'XOF',
    TG: 'XOF',
    CG: 'XAF',
    CM: 'XAF',
    GA: 'XAF',
    TD: 'XAF',
    CF: 'XAF',  // Centrafrique — added 2026-07-08 after Rufus flagged MF supports it
    CD: 'USD',  // ⚠ requires real-rate conversion
    GN: 'GNF',  // ⚠ requires real-rate conversion
};

/**
 * Returns the currency MoneyFusion expects in totalPrice for a given country.
 * Returns undefined for unknown country codes; the caller should fall back to
 * our internal currency (XAF) and log a warning.
 */
export function getMoneyFusionPayinCurrency(countryCode: string): string | undefined {
    if (!countryCode) return undefined;
    return MF_PAYIN_CURRENCY[countryCode.toUpperCase()];
}

// --- Withdraw mode mapping per country ---
// Keys cover BOTH the long-form storage names (e.g. MTN_MOMO_CMR, ORANGE_CMR — see operatorMaps.ts)
// AND the short-form aliases (e.g. MTN_CM, ORANGE_CM). The lookup site passes whatever value is
// stored on the transaction's accountInfo.momoOperator, so we accept both shapes defensively.

const WITHDRAW_MODES: Record<string, Record<string, string>> = {
    CM: {
        // NOTE: MF's published docs list "orange-money-cm" for Cameroon Orange,
        // but their API actually accepts "orange-cm" (all lowercase). MF support
        // initially typed "Orange-cm" with capital O in a reply but that was
        // proper-noun casing of the brand — direct API probing confirms the
        // API rejects "Orange-cm" (returns "indisponible") and accepts the
        // lowercase "orange-cm". Same lowercase convention as "mtn-cm".
        // Long-form (storage convention from operatorMaps.ts)
        'MTN_MOMO_CMR': 'mtn-cm',
        'ORANGE_CMR': 'orange-cm',
        'ORANGE_MOMO_CMR': 'orange-cm',
        // Short-form aliases
        'ORANGE_CM': 'orange-cm',
        'MTN_CM': 'mtn-cm',
    },
    CI: {
        'MTN_MOMO_CIV': 'mtn-ci',
        'ORANGE_CIV': 'orange-money-ci',
        'WAVE_CIV': 'wave-ci',
        'ORANGE_CI': 'orange-money-ci',
        'MTN_CI': 'mtn-ci',
        'MOOV_CI': 'moov-ci',
        'WAVE_CI': 'wave-ci',
    },
    SN: {
        'FREE_SEN': 'free-money-senegal',
        'ORANGE_SEN': 'orange-money-senegal',
        'WAVE_SEN': 'wave-senegal',
        'ORANGE_SN': 'orange-money-senegal',
        'FREE_SN': 'free-money-senegal',
        'WAVE_SN': 'wave-senegal',
        'EXPRESSO_SN': 'expresso-senegal',
    },
    BF: {
        'MOOV_BFA': 'moov-burkina-faso',
        'ORANGE_BFA': 'orange-money-burkina',
        'ORANGE_BF': 'orange-money-burkina',
        'MOOV_BF': 'moov-burkina-faso',
    },
    BJ: {
        'MTN_MOMO_BEN': 'mtn-benin',
        'MOOV_BEN': 'moov-benin',
        'MTN_BJ': 'mtn-benin',
        'MOOV_BJ': 'moov-benin',
    },
    TG: {
        'TOGOCOM_TGO': 't-money-togo',
        'MOOV_TGO': 'moov-togo',
        'TOGOCOM_TG': 't-money-togo',
        'MOOV_TG': 'moov-togo',
        'TMONEY_TG': 't-money-togo',
    },
    ML: {
        // Docs only support orange-money-mali for Mali. Moov-Mali users cannot
        // withdraw via MoneyFusion — lookup will return null and throw a clear
        // "not supported" error instead of getting "indisponible" from the API.
        'ORANGE_MLI': 'orange-money-mali',
    },
    CG: {
        // CG routes to FeexPay today, so this map is only a fallback — but it
        // should still be right. MTN is the ONLY network MoneyFusion pays out to
        // in Congo Brazzaville (live methods list, 2026-08-30). The old
        // 'orange-money-mali' entry came from a quirk in their written docs, was
        // keyed on an operator name we never store, and would have sent a
        // Congolese payout to a Malian network slug. Airtel-CG is genuinely
        // absent from MoneyFusion, so it is left out to fail at lookup with a
        // clear message rather than on an invalid slug.
        'MTN_CG': 'mtn-cg',
        'MTN_MOMO_COG': 'mtn-cg',
    },
    CD: {
        // Slugs corrected 2026-08-30: the live list is airtel-cd (not
        // airtel-money-cd, which failed all 8 prod attempts), and Orange and
        // M-Pesa ARE supported now, contrary to the old comment.
        'AIRTEL_COD': 'airtel-cd',
        'ORANGE_COD': 'orange-cd',
        'VODACOM_MPESA_COD': 'mpesa-cd',
    },
    GA: {
        // airtel-ga, not airtel-money-ga — the guessed slug failed all 10 prod
        // attempts. Libertis is not on MoneyFusion's list at all; Moov is.
        'AIRTEL_GAB': 'airtel-ga',
        'MOOV_GAB': 'moov-ga',
    },
    GH: {
        'AIRTEL_GH': 'airtel-money-gh',
        'MTN_GH': 'mtn-gh',
        'VODAFONE_GH': 'vodafone-gh',
    },
    GN: {
        'ORANGE_GN': 'orange-gn',
        'MTN_GN': 'mtn-gn',
    },
    NE: {
        // Verified 2026-08-30 against GET /api/v1/withdraw/methods, which lists
        // exactly: airtel-money-ne, amana-ne, zamanicash-ne, moov-money-ne,
        // nita-ne. The previous map guessed mtn-ne and mauritel-ne (neither
        // exists) and had no entry at all for the two operators we actually
        // store, MOOV_NER and ORANGE_NER — so every Niger payout failed: 9
        // attempts on prod, 0 completed.
        //
        // Orange Niger is now Zamani, so accounts registered as ORANGE_NER pay
        // out through zamanicash-ne.
        'ORANGE_NER': 'zamanicash-ne',
        'ZAMANI_NER': 'zamanicash-ne',
        'MOOV_NER': 'moov-money-ne',
        'AIRTEL_NER': 'airtel-money-ne',
        'AMANA_NER': 'amana-ne',
        'NITA_NER': 'nita-ne',
    },
    KE: {
        'MPESA_KEN': 'm-pesa-ke',
        'MPESA_KE': 'm-pesa-ke',
    },
    TD: {
        // Chad, requested by Rufus. Slug is airtel-td, not the guessed
        // airtel-money-td. Keys are the names we store (AIRTEL_TCD/MOOV_TCD,
        // added to operatorMaps in the same change); the short forms are kept
        // for anything already recorded that way.
        'AIRTEL_TCD': 'airtel-td',
        'MOOV_TCD': 'moov-td',
        'AIRTEL_TD': 'airtel-td',
        'MOOV_TD': 'moov-td',
    },
    GW: {
        'ORANGE_GNB': 'orange-gw',
        'ORANGE_GW': 'orange-gw',
    },
    RW: {
        'MTN_RW': 'mtn-rw',
    },
};

// Dialing prefixes for MoneyFusion-supported countries. Used to strip the country
// code from the phone before sending it to the payout API (MF expects local format).
const DIALING_PREFIXES: Record<string, string> = {
    CI: '225', SN: '221', BF: '226', BJ: '229', TG: '228', ML: '223',
    CG: '242', CD: '243', CM: '237', GA: '241', GH: '233', GN: '224',
    NE: '227', KE: '254', TD: '235', RW: '250', GW: '245', MR: '222',
    UG: '256', CF: '236', SL: '232', TZ: '255', GM: '220', ET: '251',
};

function stripDialingPrefix(phone: string, countryCode: string): string {
    const digits = String(phone).replace(/\D/g, '');
    const prefix = DIALING_PREFIXES[countryCode.toUpperCase()];
    if (prefix && digits.startsWith(prefix)) {
        return digits.slice(prefix.length);
    }
    return digits;
}

export class MoneyFusionService {
    private payinUrl: string;
    private payoutUrl: string;
    private privateKey: string;

    constructor() {
        this.payinUrl = config.moneyfusion.apiUrl;
        this.payoutUrl = config.moneyfusion.payoutUrl;
        this.privateKey = config.moneyfusion.privateKey;
    }

    // --- PAYIN ---

    async initiatePayment(request: MoneyFusionPayinRequest): Promise<MoneyFusionPayinResult> {
        if (!this.payinUrl) {
            throw new Error('MoneyFusion API URL not configured');
        }

        const payload: Record<string, any> = {
            totalPrice: request.amount,
            article: [{ payment: request.amount }],
            personal_Info: [request.personalInfo || {}],
            nomclient: request.customerName,
            numeroSend: request.phoneNumber,
            return_url: request.returnUrl,
            webhook_url: request.webhookUrl,
        };

        log.info(`Initiating MoneyFusion payment: ${request.amount} for ${request.customerName}`);

        try {
            const response = await axios.post(this.payinUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000,
            });

            const data = response.data;

            if (data.statut === true) {
                log.info(`MoneyFusion payment initiated: token=${data.token}`);
                return {
                    success: true,
                    token: data.token,
                    checkoutUrl: data.url,
                    message: data.message || 'Payment initiated',
                };
            } else {
                log.warn(`MoneyFusion payment failed: ${data.message}`);
                return {
                    success: false,
                    message: data.message || 'Payment initiation failed',
                };
            }
        } catch (error: any) {
            log.error(`MoneyFusion payment error: ${error.message}`);
            throw new Error(`MoneyFusion payment failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async checkPaymentStatus(token: string): Promise<any> {
        try {
            const response = await axios.get(
                `https://www.pay.moneyfusion.net/paiementNotif/${token}`,
                { timeout: 15000 }
            );

            if (response.data?.statut === true) {
                return response.data.data;
            }
            return null;
        } catch (error: any) {
            log.error(`MoneyFusion status check failed for token ${token}: ${error.message}`);
            return null;
        }
    }

    // --- PAYOUT ---

    async initiatePayout(request: MoneyFusionPayoutRequest): Promise<MoneyFusionPayoutResult> {
        // Sandbox: fake tokenPay in place of the API call. The sweeper resolves
        // it through handleMoneyFusionPayoutWebhook — including the 'hang'
        // outcome, which mimics MF's habit of never reaching a terminal state
        // (that's what the /fix-moneyfusion-withdrawals page is for).
        if (sandbox.isSandboxActive()) {
            const outcome = sandbox.payoutOutcomeForAmount(request.amount);
            log.warn(`SANDBOX MoneyFusion payout: amount=${request.amount}, outcome=${outcome}`);
            if (outcome === 'reject') {
                return {
                    success: false,
                    message: 'SANDBOX: payout rejeté à l\'initiation (montant magique ..03).',
                };
            }
            return {
                success: true,
                tokenPay: sandbox.makeSandboxRef(outcome),
                message: 'SANDBOX: payout initié — résolution automatique par le sweeper.',
            };
        }

        if (!this.privateKey) {
            throw new Error('MoneyFusion private key not configured for payouts');
        }

        // MoneyFusion expects the LOCAL phone number (no country dialing prefix).
        // The MF dashboard confirms this: validated withdrawals show "650384125" while
        // our recent rejected ones showed "237650384125" with the same operator slug
        // — only difference being the leading 237. Strip the dialing prefix here.
        const localPhone = stripDialingPrefix(request.phone, request.countryCode);

        const payload = {
            countryCode: request.countryCode.toLowerCase(),
            phone: localPhone,
            amount: request.amount,
            withdraw_mode: request.withdrawMode,
            webhook_url: request.webhookUrl,
        };

        log.info(`Initiating MoneyFusion payout: ${request.amount} to ${localPhone} (${request.withdrawMode})`);

        try {
            const response = await axios.post(this.payoutUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'moneyfusion-private-key': this.privateKey,
                },
                timeout: 30000,
            });

            const data = response.data;

            // Log the raw body verbatim: withdrawal K-l0u2Zh3kCA9cnY came back
            // statut:true but data.tokenPay was undefined, so we stored no MF
            // reference and the payout could not be found on the MF dashboard. We
            // do not know which key held the token — capture the whole response so
            // the next one is diagnosable, and read the token from any key MF might
            // use so the withdrawal stays searchable and auto-reconcilable.
            log.info(`MoneyFusion payout raw response: ${JSON.stringify(data)}`);

            if (data.statut === true) {
                const tokenPay: string | undefined =
                    data.tokenPay ?? data.token ?? data.data?.tokenPay ?? data.data?.token ?? data.numeroTransaction;

                // statut:true does NOT mean the payout was taken. MoneyFusion also
                // answers statut:true to refuse one, putting the refusal in the
                // message: "En maintenance. Veuillez utiliser un autre moyen Mobile
                // Money pour le retrait." Treating that as success left the
                // withdrawal sitting in PROCESSING for ever for a payout the
                // provider had already declined. A refusal is a failure, so the
                // user is told and can retry on another operator.
                const message: string = data.message ?? '';
                const refused = !tokenPay && /maintenance|indisponible|autre moyen|non disponible/i.test(message);
                if (refused) {
                    log.warn(`MoneyFusion refused the payout despite statut:true: ${message}`);
                    return { success: false, message: message || 'MoneyFusion a refusé le retrait.' };
                }

                if (!tokenPay) {
                    log.warn(`MoneyFusion payout accepted (statut:true) but no token found in response: ${JSON.stringify(data)}`);
                }
                log.info(`MoneyFusion payout initiated: tokenPay=${tokenPay}`);
                return {
                    success: true,
                    tokenPay,
                    message: data.message || 'Withdrawal submitted',
                };
            } else {
                log.warn(`MoneyFusion payout failed: ${data.message}`);
                return {
                    success: false,
                    message: data.message || 'Withdrawal failed',
                };
            }
        } catch (error: any) {
            log.error(`MoneyFusion payout error: ${error.message}`);
            throw new Error(`MoneyFusion payout failed: ${error.response?.data?.message || error.message}`);
        }
    }

    // --- HELPERS ---

    getWithdrawMode(countryCode: string, operator: string): string | null {
        const country = WITHDRAW_MODES[countryCode.toUpperCase()];
        if (!country) return null;
        return country[operator] || null;
    }

    getSupportedWithdrawModes(countryCode: string): Record<string, string> {
        return WITHDRAW_MODES[countryCode.toUpperCase()] || {};
    }

    isCountrySupported(countryCode: string): boolean {
        return !!WITHDRAW_MODES[countryCode.toUpperCase()];
    }

    mapPayinWebhookStatus(event: string): 'pending' | 'completed' | 'failed' {
        switch (event) {
            case 'payin.session.completed': return 'completed';
            case 'payin.session.cancelled': return 'failed';
            case 'payin.session.pending': return 'pending';
            default: return 'pending';
        }
    }

    mapPayoutWebhookStatus(event: string): 'completed' | 'failed' | 'pending' {
        switch (event) {
            case 'payout.session.completed': return 'completed';
            case 'payout.session.cancelled': return 'failed';
            default:
                // Unknown / intermediate events (e.g. payout.session.pending,
                // payout.session.processing) are NOT failures. Returning 'pending'
                // keeps the transaction in its current state so we don't prematurely
                // mark it FAILED while MoneyFusion is still processing — which would
                // cause our app's status to diverge from the MoneyFusion dashboard.
                log.warn(`MoneyFusion payout webhook: unrecognized event "${event}", treating as pending no-op`);
                return 'pending';
        }
    }
}

export const moneyFusionService = new MoneyFusionService();
