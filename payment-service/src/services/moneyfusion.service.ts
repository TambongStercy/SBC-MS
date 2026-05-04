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

const WITHDRAW_MODES: Record<string, Record<string, string>> = {
    CM: { 'ORANGE_CM': 'orange-money-cm', 'MTN_CM': 'mtn-cm' },
    CI: { 'ORANGE_CI': 'orange-money-ci', 'MTN_CI': 'mtn-ci', 'MOOV_CI': 'moov-ci', 'WAVE_CI': 'wave-ci' },
    SN: { 'ORANGE_SN': 'orange-money-senegal', 'FREE_SN': 'free-money-senegal', 'WAVE_SN': 'wave-senegal', 'EXPRESSO_SN': 'expresso-senegal' },
    BF: { 'ORANGE_BF': 'orange-money-burkina', 'MOOV_BF': 'moov-burkina-faso' },
    BJ: { 'MTN_BJ': 'mtn-benin', 'MOOV_BJ': 'moov-benin' },
    TG: { 'TMONEY_TG': 't-money-togo', 'MOOV_TG': 'moov-togo' },
    // Keys match our internal momoOperator slugs (momoOperatorToCountryCode in operatorMaps.ts)
    ML: { 'ORANGE_MLI': 'orange-money-mali' },
    CG: { 'ORANGE_CG': 'orange-money-mali', 'MTN_CG': 'mtn-cg' },
    CD: { 'AIRTEL_COD': 'airtel-money-cd' },
    GA: { 'AIRTEL_GAB': 'airtel-money-ga' },
    GH: { 'AIRTEL_GH': 'airtel-money-gh', 'MTN_GH': 'mtn-gh', 'VODAFONE_GH': 'vodafone-gh' },
    GN: { 'ORANGE_GN': 'orange-gn', 'MTN_GN': 'mtn-gn' },
    NE: { 'ORANGE_NER': 'orange-money-ne', 'MOOV_NER': 'moov-ne' },
    KE: { 'MPESA_KE': 'm-pesa-ke' },
    TD: { 'AIRTEL_TD': 'airtel-money-td', 'MOOV_TD': 'moov-td' },
    RW: { 'MTN_RW': 'mtn-rw' },
};

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

        const payload = {
            totalPrice: request.amount,
            article: [{ payment: request.amount }],
            personal_Info: [request.personalInfo || {}],
            numeroSend: request.phoneNumber,
            nomclient: request.customerName,
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

        const payload = {
            countryCode: request.countryCode.toLowerCase(),
            phone: request.phone,
            amount: request.amount,
            withdraw_mode: request.withdrawMode,
            webhook_url: request.webhookUrl,
        };

        log.info(`Initiating MoneyFusion payout: ${request.amount} to ${request.phone} (${request.withdrawMode})`);

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

    mapPayoutWebhookStatus(event: string): 'completed' | 'failed' {
        switch (event) {
            case 'payout.session.completed': return 'completed';
            case 'payout.session.cancelled': return 'failed';
            default: return 'failed';
        }
    }
}

export const moneyFusionService = new MoneyFusionService();
