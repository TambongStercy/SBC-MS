import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('CinetPayPayoutService');

// CinetPay API Types
interface CinetPayAuthResponse {
    code: number;
    message: string;
    data: {
        token: string;
    };
}

interface CinetPayBalanceResponse {
    code: number;
    message: string;
    data: {
        amount: number;
        inUsing: number;
        available: number;
    };
}

interface CinetPayContact {
    prefix: string;
    phone: string;
    name: string;
    surname: string;
    email: string;
}

interface CinetPayContactResponse {
    code: number;
    message: string;
    data: Array<{
        prefix: string;
        phone: string;
        name: string;
        surname: string;
        email: string;
        code: number;
        status: string;
        lot: string;
    }>;
}

interface CinetPayTransferRequest {
    prefix: string;
    phone: string;
    amount: number;
    notify_url: string;
    client_transaction_id: string;
    payment_method?: string; // Optional wallet specification
}

interface CinetPayTransferResponse {
    code: number;
    message: string;
    data: Array<{
        prefix: string;
        phone: string;
        amount: number;
        client_transaction_id: string;
        notify_url: string;
        payment_method?: string;
        code: number;
        status: string;
        treatment_status: string;
        transaction_id: string;
        lot: string;
    }>;
}

interface CinetPayTransferStatus {
    transaction_id: string;
    client_transaction_id: string;
    lot: string;
    amount: string;
    receiver: string;
    receiver_e164: string;
    operator: string;
    sending_status: 'CONFIRM' | 'PENDING';
    transfer_valid: 'Y' | 'N';
    treatment_status: 'NEW' | 'REC' | 'VAL' | 'REJ' | 'NOS';
    comment: string;
    validated_at?: string;
}

interface CinetPayStatusResponse {
    code: number;
    message: string;
    data: CinetPayTransferStatus[];
}

// Our internal types
export interface PayoutRequest {
    userId: string;
    amount: number;
    phoneNumber: string;
    countryCode: string;
    recipientName: string;
    recipientEmail?: string;
    notifyUrl?: string;
    paymentMethod?: string;
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
    private currentToken: string | null = null;
    private tokenExpiry: Date | null = null;
    private readonly baseUrl = 'https://client.cinetpay.com/v1';

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
    };

    // Supported payment methods by country
    // Note: CinetPay auto-detects operators from phone numbers, so payment_method is often optional
    // These are the confirmed working payment methods, but auto-detection is recommended
    private readonly paymentMethods: Record<string, string[]> = {
        'CI': ['OM', 'FLOOZ', 'MOMO', 'WAVECI'],
        'SN': ['OMSN', 'FREESN', 'WAVESN'],
        'CM': ['OMCM'], // Only Orange confirmed working, MTN auto-detected
        'TG': ['TMONEYTG', 'FLOOZTG'],
        'BJ': ['MTNBJ', 'MOOVBJ'],
        'ML': ['OMML', 'MOOVML'],
        'BF': ['OMBF', 'MOOVBF'],
        'GN': ['OMGN', 'MTNGN'],
        'CD': ['OMCD', 'MPESACD', 'AIRTELCD'],
    };

    // Minimum amounts by country (in local currency)
    private readonly minAmounts: Record<string, number> = {
        'CI': 200,  // XOF
        'SN': 200,  // XOF
        'CM': 500,  // XAF
        'TG': 150,  // XOF
        'BJ': 500,  // XOF
        'ML': 500,  // XOF (estimated)
        'BF': 500,  // XOF
        'GN': 1000, // GNF
        'CD': 1000, // CDF
    };

    constructor() {
        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        // Add request interceptor for logging
        this.apiClient.interceptors.request.use(
            (config) => {
                log.debug(`CinetPay API Request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                log.error('CinetPay API Request Error:', error);
                return Promise.reject(error);
            }
        );

        // Add response interceptor for logging
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
     * Authenticate with CinetPay and get access token
     */
    private async authenticate(): Promise<string> {
        try {
            // Check if current token is still valid (with 1 minute buffer)
            if (this.currentToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 60000)) {
                return this.currentToken;
            }

            log.info('Authenticating with CinetPay...');

            const params = new URLSearchParams();
            params.append('apikey', config.cinetpay.apiKey);
            params.append('password', config.cinetpay.transferPassword);

            const response = await this.apiClient.post<CinetPayAuthResponse>(
                '/auth/login?lang=fr',
                params
            );

            if (response.data.code !== 0) {
                throw new Error(`Authentication failed: ${response.data.message}`);
            }

            this.currentToken = response.data.data.token;
            this.tokenExpiry = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes (5min - 1min buffer)

            log.info('Successfully authenticated with CinetPay');
            return this.currentToken;

        } catch (error: any) {
            log.error('CinetPay authentication failed:', error);
            throw new Error(`Failed to authenticate with CinetPay: ${error.message}`);
        }
    }

    /**
     * Get account balance for transfers
     */
    async getBalance(): Promise<{ total: number; available: number; inUse: number }> {
        try {
            const token = await this.authenticate();

            const response = await this.apiClient.get<CinetPayBalanceResponse>(
                `/transfer/check/balance?token=${token}&lang=fr`
            );

            if (response.data.code !== 0) {
                throw new Error(`Failed to get balance: ${response.data.message}`);
            }

            const { amount, available, inUsing } = response.data.data;

            log.info(`CinetPay balance - Total: ${amount}, Available: ${available}, In Use: ${inUsing}`);

            return {
                total: amount,
                available: available,
                inUse: inUsing
            };

        } catch (error: any) {
            log.error('Failed to get CinetPay balance:', error);
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    /**
     * Add a contact to CinetPay (required before sending money)
     */
    private async addContact(contact: CinetPayContact): Promise<boolean> {
        try {
            const token = await this.authenticate();

            log.info(`Preparing to add contact to CinetPay:`, contact);

            // Special handling for Côte d'Ivoire to prevent 417 errors
            if (contact.prefix === '225') { // Côte d'Ivoire
                // Ensure phone number format is correct for Côte d'Ivoire
                const phonePattern = /^0[1235789]\d{7}$/; // Must be 01, 02, 03, 05, 07, 08, 09 + 7 digits
                if (!phonePattern.test(contact.phone)) {
                    log.warn(`Côte d'Ivoire phone number ${contact.phone} may not be in correct format. Expected: 0XXXXXXXX`);
                }
            }

            const params = new URLSearchParams();
            params.append('data', JSON.stringify([contact]));

            log.info(`URLSearchParams for addContact:`, params.toString());

            const response = await this.apiClient.post<CinetPayContactResponse>(
                `/transfer/contact?token=${token}&lang=fr`,
                params, // Send URLSearchParams object directly
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                        'User-Agent': 'SBC-API/1.0'
                    }
                }
            );

            log.info(`CinetPay add contact raw response:`, response.data);

            if (response.data.code !== 0) {
                // Check if contact already exists
                if (response.data.message && response.data.message.includes('ALREADY_MY_CONTACT')) {
                    log.info(`Contact ${contact.phone} already exists (message: ALREADY_MY_CONTACT)`);
                    return true;
                }
                // Check for specific error code 726
                if (response.data.code === 726) {
                    log.info(`Contact ${contact.phone} already exists (code 726)`);
                    return true;
                }
                throw new Error(`Failed to add contact: ${response.data.message || 'Unknown error'}`);
            }

            // Check if data array exists and has elements
            if (!response.data.data || !Array.isArray(response.data.data) || response.data.data.length === 0) {
                throw new Error('Invalid response format: missing data array');
            }

            let contactResult;
            if (Array.isArray(response.data.data[0])) {
                // Handle case where data is double-nested (e.g., [[{...}]])
                if (response.data.data[0].length === 0) {
                    throw new Error('Invalid response format: empty nested data array.');
                }
                contactResult = response.data.data[0][0];
            } else {
                // Handle case where data is single-nested (e.g., [{...}])
                contactResult = response.data.data[0];
            }

            log.info(`Processed contact result:`, contactResult);

            if (contactResult.code !== 0) {
                // Check if contact already exists (code 726) or other specific statuses
                if (contactResult.code === 726 || contactResult.status === 'ERROR_PHONE_ALREADY_MY_CONTACT') {
                    log.info(`Contact ${contact.phone} already exists in CinetPay contacts (result code/status)`);
                    return true; // This is not an error, contact exists and can be used
                }

                const errorMessage = contactResult.status || contactResult.message || 'Unknown contact error from result';
                throw new Error(`Failed to add contact: ${errorMessage}`);
            }

            log.info(`Successfully added/verified contact: ${contact.phone}`);
            return true;

        } catch (error: any) {
            log.error('Failed to add contact:', error.message);

            // Special handling for 417 errors (common with Côte d'Ivoire)
            if (error.response && error.response.status === 417) {
                log.error('HTTP 417 Expectation Failed - likely phone number format issue for Côte d\'Ivoire');
                log.error('Contact data:', contact);
                log.error('Recommendation: Check phone number format for country', contact.prefix);

                // For Côte d'Ivoire, provide specific guidance
                if (contact.prefix === '225') {
                    throw new Error(`Failed to add contact: Invalid phone number format for Côte d'Ivoire. Phone numbers must start with 01, 02, 03, 05, 07, 08, or 09 and be 10 digits total. Current: ${contact.phone}`);
                }
            }

            // Log the full error details for debugging
            if (error.response) {
                log.error('CinetPay API Error Response (addContact):', {
                    status: error.response.status,
                    data: error.response.data,
                    headers: error.response.headers
                });
            }
            throw new Error(`Failed to add contact: ${error.message}`);
        }
    }

    /**
     * Validate payout request
     */
    private validatePayoutRequest(request: PayoutRequest): void {
        const { countryCode, amount, phoneNumber } = request;

        // Check if country is supported
        if (!this.countryPrefixes[countryCode]) {
            throw new Error(`Country ${countryCode} is not supported for payouts`);
        }

        // Check minimum amount
        const minAmount = this.minAmounts[countryCode];
        if (amount < minAmount) {
            throw new Error(`Minimum amount for ${countryCode} is ${minAmount}`);
        }

        // Validate phone number format (basic validation)
        if (!phoneNumber || phoneNumber.length < 8) {
            throw new Error('Invalid phone number format');
        }

        // Check if amount is multiple of 5 (CinetPay requirement)
        if (amount % 5 !== 0) {
            throw new Error('Amount must be a multiple of 5');
        }
    }

    /**
     * Check if payment method is valid for the country
     */
    private isValidPaymentMethod(paymentMethod: string, countryCode: string): boolean {
        const validMethods = this.paymentMethods[countryCode] || [];
        return validMethods.includes(paymentMethod);
    }

    /**
     * Format phone number for CinetPay
     */
    private formatPhoneNumber(phoneNumber: string, countryCode: string): string {
        let cleanPhone = phoneNumber.replace(/\D/g, ''); // Remove all non-digits

        const prefix = this.countryPrefixes[countryCode];
        if (prefix && cleanPhone.startsWith(prefix)) { // Ensure prefix exists before trying to remove
            cleanPhone = cleanPhone.substring(prefix.length);
        }

        cleanPhone = cleanPhone.replace(/^0+/, ''); // Remove leading zeros (e.g., 07895086 -> 7895086)

        // Special handling for Côte d'Ivoire to prevent 417 errors
        if (countryCode === 'CI') {
            // Côte d'Ivoire phone numbers should be 10 digits without country code
            // Valid operator prefixes: 01, 02, 03, 05, 07, 08, 09
            if (cleanPhone.length === 8) {
                // If 8 digits, add leading 0 (e.g., 12345678 -> 012345678)
                cleanPhone = '0' + cleanPhone;
            }
            if (cleanPhone.length === 9 && !cleanPhone.startsWith('0')) {
                // If 9 digits without leading 0, add it
                cleanPhone = '0' + cleanPhone;
            }
            // Validate that it starts with valid operator prefixes
            const validPrefixes = ['01', '02', '03', '05', '07', '08', '09'];
            const phonePrefix = cleanPhone.substring(0, 2);
            if (!validPrefixes.includes(phonePrefix)) {
                log.warn(`Côte d'Ivoire phone number ${cleanPhone} has invalid operator prefix ${phonePrefix}. Valid prefixes: ${validPrefixes.join(', ')}`);
            }
        }

        return cleanPhone;
    }

    /**
     * Initiate a payout transfer
     */
    async initiatePayout(request: PayoutRequest): Promise<PayoutResult> {
        try {
            log.info(`Initiating payout for user ${request.userId}: ${request.amount} to ${request.phoneNumber}`);

            // Validate request
            this.validatePayoutRequest(request);

            const prefix = this.countryPrefixes[request.countryCode];
            const formattedPhone = this.formatPhoneNumber(request.phoneNumber, request.countryCode);

            log.info(`Country prefix for ${request.countryCode}: ${prefix}`);
            log.info(`Formatted phone: ${formattedPhone}`);

            // Refine name and surname
            const firstName = (request.recipientName.split(' ')[0] || 'User').trim();
            const lastName = (request.recipientName.split(' ').slice(1).join(' ') || 'SBC').trim();

            // Refine email
            let contactEmail = request.recipientEmail;
            if (!contactEmail) {
                const simpleUserId = String(request.userId).substring(0, 10);
                contactEmail = `user_${simpleUserId}@sbc.com`;
            }
            if (!contactEmail.includes('@') && contactEmail.length > 0) {
                contactEmail = `${contactEmail}@sbc.com`;
            }

            const finalFormattedPhone = formattedPhone.replace(/\D/g, '');

            // Step 1: Add contact
            const contact: CinetPayContact = {
                prefix: prefix,
                phone: finalFormattedPhone,
                name: firstName || 'User',
                surname: lastName || 'SBC',
                email: contactEmail
            };

            log.info(`Adding contact to CinetPay: +${prefix}${finalFormattedPhone} (${contact.name} ${contact.surname})`);
            await this.addContact(contact);

            // Step 2: Initiate transfer
            const transferRequest: CinetPayTransferRequest = {
                prefix: prefix,
                phone: finalFormattedPhone,
                amount: request.amount,
                notify_url: request.notifyUrl || `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay`,
                client_transaction_id: request.client_transaction_id || `SBC_${request.userId}_${Date.now()}`
            };

            // payment_method is optional for CinetPay. Only set if explicitly provided and valid.
            if (request.paymentMethod && request.paymentMethod !== 'OMCM' && this.isValidPaymentMethod(request.paymentMethod, request.countryCode)) {
                transferRequest.payment_method = request.paymentMethod;
                log.info(`Using specified payment method: ${request.paymentMethod}`);
            } else if (request.paymentMethod === 'OMCM') {
                log.warn(`Explicitly not setting payment_method 'OMCM' for CinetPay transfer due to API rejection. Relying on auto-detection.`);
            }
            else {
                log.info(`Using auto-detection for operator (no payment_method specified or invalid)`);
                // No need to explicitly delete, as it's not set if this path is taken
            }

            const token = await this.authenticate();

            log.info(`Initiating transfer with CinetPay:`);
            log.info(`Transfer request:`, transferRequest);
            log.info(`Transfer URL: /transfer/money/send/contact?token=${token.substring(0, 20)}...&lang=fr`);
            log.info(`Transfer payload: data=${JSON.stringify([transferRequest])}`);

            const payload = `data=${JSON.stringify([transferRequest])}`;
            const headers = {
                'Expect': '',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload)
            };

            const response = await this.apiClient.post<CinetPayTransferResponse>(
                `/transfer/money/send/contact?token=${token}&lang=fr`,
                payload,
                {
                    headers
                }
            );

            log.info(`Transfer response status: ${response.status}`);
            log.info(`Transfer response data:`, response.data);

            if (response.data.code !== 0) {
                throw new Error(`Transfer initiation failed: ${response.data.message}`);
            }

            // Handle nested array response format like in addContact
            let transferResult;
            if (Array.isArray(response.data.data[0])) {
                transferResult = response.data.data[0][0];
            } else {
                transferResult = response.data.data[0];
            }

            log.debug(`Transfer result:`, transferResult);

            if (transferResult.code !== 0) {
                throw new Error(`Transfer failed: ${transferResult.status}`);
            }

            log.info(`Payout initiated successfully: ${transferResult.transaction_id}`);

            return {
                success: true,
                transactionId: transferRequest.client_transaction_id,
                cinetpayTransactionId: transferResult.transaction_id,
                status: this.mapTreatmentStatus(transferResult.treatment_status),
                message: 'Payout initiated successfully. Awaiting confirmation.',
                amount: request.amount,
                recipient: `+${prefix}${formattedPhone}`,
                estimatedCompletion: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes estimate
            };

        } catch (error: any) {
            log.error('Payout initiation failed:', error);
            return {
                success: false,
                status: 'failed',
                message: error.message,
                amount: request.amount,
                recipient: request.phoneNumber
            };
        }
    }

    /**
     * Check the status of a payout
     */
    async checkPayoutStatus(clientTransactionId: string): Promise<PayoutStatus | null> {
        try {
            const token = await this.authenticate();

            const response = await this.apiClient.get<CinetPayStatusResponse>(
                `/transfer/check/money?token=${token}&lang=fr&client_transaction_id=${clientTransactionId}`
            );

            if (response.data.code !== 0) {
                if (response.data.code === 723) { // NOT_FOUND
                    return null;
                }
                throw new Error(`Status check failed: ${response.data.message}`);
            }

            const statusData = response.data.data[0];
            if (!statusData) {
                return null;
            }
            console.log(statusData)

            return {
                transactionId: statusData.client_transaction_id,
                cinetpayTransactionId: statusData.transaction_id,
                status: this.mapTreatmentStatus(statusData.treatment_status),
                amount: parseFloat(statusData.amount),
                recipient: statusData.receiver_e164,
                operator: statusData.operator,
                sendingStatus: statusData.sending_status === 'CONFIRM' ? 'confirmed' : 'pending',
                comment: statusData.comment,
                completedAt: statusData.validated_at ? new Date(statusData.validated_at) : undefined
            };

        } catch (error: any) {
            log.error('Failed to check payout status:', error);
            throw new Error(`Failed to check status: ${error.message}`);
        }
    }

    /**
     * Map CinetPay treatment status to our internal status
     */
    private mapTreatmentStatus(treatmentStatus: string): 'pending' | 'processing' | 'completed' | 'failed' {
        switch (treatmentStatus) {
            case 'NEW':
            case 'NOS':
                return 'pending';
            case 'REC':
                return 'processing';
            case 'VAL':
                return 'completed';
            case 'REJ':
                return 'failed';
            default:
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
        paymentMethods: string[];
    }> {
        const countries = [
            { code: 'CI', name: 'Côte d\'Ivoire', currency: 'XOF' },
            { code: 'SN', name: 'Sénégal', currency: 'XOF' },
            { code: 'CM', name: 'Cameroun', currency: 'XAF' },
            { code: 'TG', name: 'Togo', currency: 'XOF' },
            { code: 'BJ', name: 'Benin', currency: 'XOF' },
            { code: 'ML', name: 'Mali', currency: 'XOF' },
            { code: 'BF', name: 'Burkina Faso', currency: 'XOF' },
            { code: 'GN', name: 'Guinea', currency: 'GNF' },
            { code: 'CD', name: 'Congo (RDC)', currency: 'CDF' },
        ];

        return countries.map(country => ({
            ...country,
            prefix: this.countryPrefixes[country.code],
            minAmount: this.minAmounts[country.code],
            paymentMethods: this.paymentMethods[country.code] || []
        }));
    }

    /**
     * Process webhook notification from CinetPay
     */
    processWebhookNotification(payload: any): {
        transactionId: string;
        cinetpayTransactionId: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        amount: number;
        recipient: string;
        comment?: string;
    } {
        return {
            transactionId: payload.client_transaction_id,
            cinetpayTransactionId: payload.transaction_id,
            status: this.mapTreatmentStatus(payload.treatment_status),
            amount: parseFloat(payload.amount),
            recipient: payload.receiver,
            comment: payload.comment
        };
    }
}

// Export singleton instance
export const cinetpayPayoutService = new CinetPayPayoutService();
