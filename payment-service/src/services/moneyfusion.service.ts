import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';

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
        // Docs literally specify "orange-money-mali" for Congo Brazzaville.
        // Looks like a quirk in MoneyFusion's table — keep as-is until they
        // confirm otherwise. Airtel-CG is NOT supported per docs.
        'ORANGE_CG': 'orange-money-mali',
        'MTN_CG': 'mtn-cg',
        'MTN_MOMO_COG': 'mtn-cg',
    },
    CD: {
        // Docs only support airtel-money-cd. Mpesa-CD and Orange-CD are not
        // available via MoneyFusion — those users will fail at lookup time.
        'AIRTEL_COD': 'airtel-money-cd',
    },
    GA: {
        'AIRTEL_GAB': 'airtel-money-ga',
        'LIBERTIS_GA': 'libertis-ga',
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
        // Docs only support airtel-money-ne, mtn-ne, mauritel-ne for Niger.
        // Orange-NE and Moov-NE are NOT available via MoneyFusion. If a user
        // is registered with one of those operators, withdraw will fail at
        // lookup with a clear error.
        'AIRTEL_NER': 'airtel-money-ne',
        'MTN_NER': 'mtn-ne',
        'MAURITEL_NER': 'mauritel-ne',
        'AIRTEL_NE': 'airtel-money-ne',
        'MTN_NE': 'mtn-ne',
        'MAURITEL_NE': 'mauritel-ne',
    },
    KE: {
        'MPESA_KEN': 'm-pesa-ke',
        'MPESA_KE': 'm-pesa-ke',
    },
    TD: {
        'AIRTEL_TD': 'airtel-money-td',
        'MOOV_TD': 'moov-td',
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

            if (data.statut === true) {
                log.info(`MoneyFusion payout initiated: tokenPay=${data.tokenPay}`);
                return {
                    success: true,
                    tokenPay: data.tokenPay,
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
