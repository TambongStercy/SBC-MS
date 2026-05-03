import axios, { AxiosInstance } from 'axios';
import https from 'https';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('CinetPayPayoutService');

// New CinetPay API response types
interface CinetPayAuthResponse {
    code: number;
    status: string;
    access_token: string;
    token_type: string;
    expires_in: number; // seconds (86400 = 24h)
}

interface CinetPayTransferResponse {
    code: number;
    status: string;
    merchant_transaction_id: string;
    transaction_id: string;
    amount: number;
    fee_amount: number;
    user?: {
        name: string;
        email: string;
        phone_number: string;
    };
}

interface CinetPayTransferStatusResponse {
    code: number;
    status: string;
    merchant_transaction_id: string;
    transaction_id: string;
    amount: string;
    fee_amount: string;
    user?: {
        name: string;
        email: string;
        phone_number: string;
    };
}

interface CinetPayBalanceResponse {
    code: number;
    status: string;
    real_balance: number;
    available_balance: number;
    currency: string;
}

// Per-country token cache
interface TokenCache {
    accessToken: string;
    expiresAt: Date;
}

// Our internal types (kept compatible with existing consumers)
export interface PayoutRequest {
    userId: string;
    amount: number;
    phoneNumber: string;
    countryCode: string;
    recipientName: string;
    recipientEmail?: string;
    notifyUrl?: string;
    paymentMethod?: string; // Required in new API (e.g., OM_CM, MTN_CI)
    description?: string;
    client_transaction_id?: string;
}

export interface PayoutResult {
    success: boolean;
    transactionId?: string;
    cinetpayTransactionId?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    message: string;
    amount: number;
    recipient: string;
    feeAmount?: number;
    estimatedCompletion?: Date;
}

export interface PayoutStatus {
    transactionId: string;
    cinetpayTransactionId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    amount: number;
    recipient: string;
    operator?: string;
    sendingStatus: 'confirmed' | 'pending';
    comment?: string;
    completedAt?: Date;
}

export class CinetPayPayoutService {
    private apiClient: AxiosInstance;
    private tokenCache: Map<string, TokenCache> = new Map(); // keyed by country code

    // Country code to prefix mapping
    private readonly countryPrefixes: Record<string, string> = {
        'CI': '225', // Côte d'Ivoire
        'SN': '221', // Sénégal
        'CM': '237', // Cameroun
        'TG': '228', // Togo
        'BJ': '229', // Benin
        'ML': '223', // Mali
        'BF': '226', // Burkina Faso
        'GN': '224', // Guinea
        'CD': '243', // Congo (RDC)
        'NE': '227', // Niger
    };

    // Minimum amounts by country (new API: min 500 for transfers)
    private readonly minAmounts: Record<string, number> = {
        'CI': 500,
        'SN': 500,
        'CM': 500,
        'TG': 500,
        'BJ': 500,
        'ML': 500,
        'BF': 500,
        'GN': 500,
        'CD': 500,
        'NE': 500,
    };

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.cinetpay.baseUrl,
            timeout: 600000, // 10 minutes
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            // Force IPv4 — CinetPay IP whitelist only supports IPv4 addresses
            httpsAgent: new https.Agent({ family: 4 }),
        });

        this.apiClient.interceptors.request.use(
            (reqConfig) => {
                log.debug(`CinetPay API Request: ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`);
                return reqConfig;
            },
            (error) => {
                log.error('CinetPay API Request Error:', error);
                return Promise.reject(error);
            }
        );

        this.apiClient.interceptors.response.use(
            (response) => {
                log.debug(`CinetPay API Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                log.error('CinetPay API Response Error:', error.response?.data || error.message);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Get country credentials from config
     */
    private getCountryCredentials(countryCode: string): { apiKey: string; apiPassword: string; currency: string } {
        const creds = config.cinetpay.countries[countryCode];
        if (!creds) {
            throw new Error(`No CinetPay credentials configured for country: ${countryCode}. Add CINETPAY_${countryCode}_API_KEY and CINETPAY_${countryCode}_API_PASSWORD to .env`);
        }
        return creds;
    }

    /**
     * Authenticate with CinetPay OAuth and get access token (per-country)
     */
    private async authenticate(countryCode: string): Promise<string> {
        try {
            // Check cached token (with 5 minute buffer)
            const cached = this.tokenCache.get(countryCode);
            if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
                return cached.accessToken;
            }

            const creds = this.getCountryCredentials(countryCode);

            log.info(`Authenticating with CinetPay for country ${countryCode}...`);

            const response = await this.apiClient.post<CinetPayAuthResponse>(
                '/v1/oauth/login',
                {
                    api_key: creds.apiKey,
                    api_password: creds.apiPassword,
                }
            );

            if (response.data.code !== 200) {
                throw new Error(`Authentication failed: ${response.data.status}`);
            }

            const token = response.data.access_token;
            const expiresIn = response.data.expires_in || 86400; // default 24h

            this.tokenCache.set(countryCode, {
                accessToken: token,
                expiresAt: new Date(Date.now() + expiresIn * 1000),
            });

            log.info(`Successfully authenticated with CinetPay for country ${countryCode} (expires in ${expiresIn}s)`);
            return token;

        } catch (error: any) {
            log.error(`CinetPay authentication failed for ${countryCode}:`, error.response?.data || error.message);
            throw new Error(`Failed to authenticate with CinetPay for ${countryCode}: ${error.message}`);
        }
    }

    /**
     * Get account balance
     */
    async getBalance(countryCode?: string): Promise<{ total: number; available: number; inUse: number }> {
        try {
            // Use first available country if not specified
            const cc = countryCode || Object.keys(config.cinetpay.countries)[0];
            if (!cc) {
                throw new Error('No CinetPay country credentials configured');
            }

            const token = await this.authenticate(cc);

            const response = await this.apiClient.get<CinetPayBalanceResponse>(
                '/v1/balances',
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (response.data.code !== 200) {
                throw new Error(`Failed to get balance: ${response.data.status}`);
            }

            const realBalance = response.data.real_balance || 0;
            const available = response.data.available_balance || 0;

            log.info(`CinetPay balance for ${cc}: real=${realBalance}, available=${available} ${response.data.currency}`);

            return {
                total: realBalance,
                available,
                inUse: realBalance - available,
            };

        } catch (error: any) {
            log.error('Failed to get CinetPay balance:', error);
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    /**
     * Validate payout request
     */
    private validatePayoutRequest(request: PayoutRequest): void {
        const { countryCode, amount, phoneNumber } = request;

        if (!this.countryPrefixes[countryCode]) {
            throw new Error(`Country ${countryCode} is not supported for payouts`);
        }

        // Check credentials exist for this country
        this.getCountryCredentials(countryCode);

        const minAmount = this.minAmounts[countryCode] || 500;
        if (amount < minAmount) {
            throw new Error(`Minimum amount for ${countryCode} is ${minAmount}`);
        }

        if (!phoneNumber || phoneNumber.length < 8) {
            throw new Error('Invalid phone number format');
        }

        if (amount % 5 !== 0) {
            throw new Error('Amount must be a multiple of 5');
        }
    }

    /**
     * Format phone number to E.164 format with + prefix
     */
    private formatPhoneNumberE164(phoneNumber: string, countryCode: string): string {
        let cleanPhone = phoneNumber.replace(/\D/g, '');
        const prefix = this.countryPrefixes[countryCode];

        // Remove country prefix if already present
        if (prefix && cleanPhone.startsWith(prefix)) {
            cleanPhone = cleanPhone.substring(prefix.length);
        }

        // Remove leading zeros
        cleanPhone = cleanPhone.replace(/^0+/, '');

        // Special handling for Côte d'Ivoire (10 digits required)
        if (countryCode === 'CI') {
            if (cleanPhone.length === 8) {
                cleanPhone = '0' + cleanPhone;
            }
            if (cleanPhone.length === 9 && !cleanPhone.startsWith('0')) {
                cleanPhone = '0' + cleanPhone;
            }
        }

        // Return in E.164 format: +{prefix}{number}
        return `+${prefix}${cleanPhone}`;
    }

    /**
     * Initiate a payout transfer (new single-call API)
     */
    async initiatePayout(request: PayoutRequest): Promise<PayoutResult> {
        try {
            log.info(`Initiating payout for user ${request.userId}: ${request.amount} to ${request.phoneNumber} in ${request.countryCode}`);

            this.validatePayoutRequest(request);

            const creds = this.getCountryCredentials(request.countryCode);
            const token = await this.authenticate(request.countryCode);
            const phoneE164 = this.formatPhoneNumberE164(request.phoneNumber, request.countryCode);
            const rawMerchantTxId = request.client_transaction_id || `SBC-${request.userId}-${Date.now()}`;

            // merchant_transaction_id: max 30 chars, alphanumeric and hyphens only
            const truncatedMerchantTxId = rawMerchantTxId.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 30);

            if (!request.paymentMethod) {
                throw new Error(`payment_method is required for CinetPay transfers. Country: ${request.countryCode}`);
            }

            const transferBody = {
                currency: creds.currency,
                payment_method: request.paymentMethod,
                merchant_transaction_id: truncatedMerchantTxId,
                amount: request.amount,
                phone_number: phoneE164,
                reason: request.description || `SBC Withdrawal for user ${request.userId}`,
                notify_url: request.notifyUrl || `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay`,
            };

            log.info(`CinetPay transfer request:`, transferBody);

            const response = await this.apiClient.post<CinetPayTransferResponse>(
                '/v1/transfer',
                transferBody,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            log.info(`CinetPay transfer response: ${JSON.stringify(response.data)}`);

            // New API: code 100 = SUCCESS, code 200 = OK/initiated, code 2001 = INITIATED, code 2002 = PENDING
            const code = response.data.code;
            if (code !== 100 && code !== 200 && code !== 2001 && code !== 2002) {
                log.error(`CinetPay transfer REJECTED. Code: ${code}, Status: ${response.data.status}, Full: ${JSON.stringify(response.data)}`);
                throw new Error(`Transfer failed: [${code}] ${response.data.status}`);
            }

            const status = this.mapStatusCode(code, response.data.status);

            log.info(`Payout initiated successfully: ${response.data.transaction_id} (merchant: ${truncatedMerchantTxId})`);

            return {
                success: true,
                transactionId: truncatedMerchantTxId,
                cinetpayTransactionId: response.data.transaction_id,
                status,
                message: 'Payout initiated successfully. Awaiting confirmation.',
                amount: request.amount,
                feeAmount: response.data.fee_amount,
                recipient: phoneE164,
                estimatedCompletion: new Date(Date.now() + 30 * 60 * 1000),
            };

        } catch (error: any) {
            log.error('Payout initiation failed. Full error:', JSON.stringify(error.response?.data || error.message));
            log.error('Payout request was:', JSON.stringify({
                phoneE164: request.phoneNumber,
                countryCode: request.countryCode,
                amount: request.amount,
                paymentMethod: request.paymentMethod,
            }));
            return {
                success: false,
                status: 'failed',
                message: error.response?.data?.status || error.message,
                amount: request.amount,
                recipient: request.phoneNumber,
            };
        }
    }

    /**
     * Check the status of a payout
     */
    async checkPayoutStatus(transactionId: string, countryCode?: string): Promise<PayoutStatus | null> {
        try {
            // We need a country code to authenticate. Try all configured countries if not specified.
            const countries = countryCode ? [countryCode] : Object.keys(config.cinetpay.countries);

            for (const cc of countries) {
                try {
                    const token = await this.authenticate(cc);

                    const response = await this.apiClient.get<CinetPayTransferStatusResponse>(
                        `/v1/transfer/${transactionId}`,
                        {
                            headers: { Authorization: `Bearer ${token}` },
                        }
                    );

                    if (response.data.code === 404) {
                        continue; // Try next country
                    }

                    const status = this.mapStatusCode(response.data.code, response.data.status);

                    return {
                        transactionId: response.data.merchant_transaction_id,
                        cinetpayTransactionId: response.data.transaction_id,
                        status,
                        amount: parseFloat(response.data.amount),
                        recipient: response.data.user?.phone_number || '',
                        sendingStatus: status === 'completed' ? 'confirmed' : 'pending',
                        comment: response.data.status,
                    };
                } catch (innerError: any) {
                    if (innerError.response?.status === 404) {
                        continue;
                    }
                    throw innerError;
                }
            }

            return null;

        } catch (error: any) {
            log.error('Failed to check payout status:', error);
            throw new Error(`Failed to check status: ${error.message}`);
        }
    }

    /**
     * Map new CinetPay status codes to internal status
     */
    private mapStatusCode(code: number, status: string): 'pending' | 'processing' | 'completed' | 'failed' {
        switch (code) {
            case 100: // SUCCESS
                return 'completed';
            case 2010: // FAILED
            case 2005: // INSUFFICIENT_BALANCE
                return 'failed';
            case 2001: // INITIATED
            case 200:  // OK
                return 'pending';
            case 2002: // PENDING
                return 'processing';
            default:
                // Also check string status as fallback
                if (status === 'SUCCESS') return 'completed';
                if (status === 'FAILED') return 'failed';
                if (status === 'PENDING') return 'processing';
                return 'pending';
        }
    }

    /**
     * Get supported countries and their details
     */
    getSupportedCountries(): Array<{
        code: string;
        name: string;
        prefix: string;
        currency: string;
        minAmount: number;
        configured: boolean;
    }> {
        const countries = [
            { code: 'CM', name: 'Cameroun', currency: 'XAF' },
            { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF' },
            { code: 'SN', name: 'Sénégal', currency: 'XOF' },
            { code: 'BF', name: 'Burkina Faso', currency: 'XOF' },
            { code: 'ML', name: 'Mali', currency: 'XOF' },
            { code: 'NE', name: 'Niger', currency: 'XOF' },
            { code: 'TG', name: 'Togo', currency: 'XOF' },
            { code: 'BJ', name: 'Benin', currency: 'XOF' },
            { code: 'GN', name: 'Guinea', currency: 'GNF' },
            { code: 'CD', name: 'Congo (RDC)', currency: 'CDF' },
        ];

        return countries.map(country => ({
            ...country,
            prefix: this.countryPrefixes[country.code],
            minAmount: this.minAmounts[country.code] || 500,
            configured: !!config.cinetpay.countries[country.code],
        }));
    }

    /**
     * Process webhook notification from CinetPay (new format)
     * New payload: { notify_token, merchant_transaction_id, transaction_id, user: { name, email, phone_number } }
     */
    processWebhookNotification(payload: any): {
        transactionId: string;
        cinetpayTransactionId: string;
        notifyToken: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        recipient: string;
    } {
        return {
            transactionId: payload.merchant_transaction_id,
            cinetpayTransactionId: payload.transaction_id,
            notifyToken: payload.notify_token,
            // Webhook only tells us there's an update — we must check status via API
            status: 'processing',
            recipient: payload.user?.phone_number || '',
        };
    }
}

// Export singleton instance
export const cinetpayPayoutService = new CinetPayPayoutService();
