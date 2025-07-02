import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import config from '../config';
import { Currency } from '../database/models/transaction.model';
import { AppError } from '../utils/errors';

const log = logger.getLogger('FeexPayPayoutService');

// Internal types for FeexPay Payout Service
export interface PayoutRequest {
    userId: string;
    amount: number; // Amount to payout, in the target currency (e.g., XOF)
    phoneNumber: string; // Full international or national format (FeexPay expects specific formats)
    countryCode: string; // e.g., 'CI', 'SN'
    momoOperator: string; // e.g., 'MOOV_CI', 'ORANGE_SN'
    recipientName?: string;
    recipientEmail?: string;
    notifyUrl?: string; // Webhook URL for FeexPay to send status updates
    description?: string;
    client_transaction_id?: string; // Our internal transaction ID
}

export interface PayoutResult {
    success: boolean;
    transactionId?: string; // Our internal transaction ID
    feexpayReference?: string; // FeexPay's transaction reference
    status: 'pending' | 'processing' | 'completed' | 'failed';
    message: string;
    amount: number;
    recipient: string;
    error?: any;
}

export interface PayoutStatus {
    transactionId: string; // Our internal client_transaction_id
    feexpayReference: string; // FeexPay's transaction reference
    status: 'pending' | 'processing' | 'completed' | 'failed';
    amount: number;
    recipient: string;
    operator?: string;
    comment?: string;
    completedAt?: Date;
}

export class FeexPayPayoutService {
    private apiClient: AxiosInstance;

    // Map momoOperator slugs to FeexPay payout endpoints and their network parameter value
    // This mapping is crucial for routing to the correct FeexPay API endpoint
    private readonly feexPayPayoutEndpoints: Record<string, {
        endpoint: string;
        networkParam: string; // The 'network' parameter expected by FeexPay
        minAmount: number; // Minimum amount for this endpoint/network
    }> = {
            // Benin
            'MTN_BJ': { endpoint: '/payouts/public/transfer/global', networkParam: 'MTN', minAmount: 50 }, // For general MTN/MOOV global endpoint
            'MOOV_BJ': { endpoint: '/payouts/public/transfer/global', networkParam: 'MOOV', minAmount: 50 },
            'CELTIIS_BJ': { endpoint: '/payouts/public/celtiis_bj', networkParam: 'CELTIIS BJ', minAmount: 50 },
            // Côte d'Ivoire
            'MTN_CI': { endpoint: '/payouts/public/mtn_ci', networkParam: 'MTN CI', minAmount: 100 },
            'ORANGE_CI': { endpoint: '/payouts/public/orange_ci', networkParam: 'ORANGE CI', minAmount: 100 },
            'MOOV_CI': { endpoint: '/payouts/public/moov_ci', networkParam: 'MOOV CI', minAmount: 100 },
            'WAVE_CI': { endpoint: '/payouts/public/wave_ci', networkParam: 'WAVE CI', minAmount: 100 }, // Assuming this exists or falls back to generic
            // Senegal
            'ORANGE_SN': { endpoint: '/payouts/public/orange_sn', networkParam: 'ORANGE SN', minAmount: 100 },
            'FREE_SN': { endpoint: '/payouts/public/free_sn', networkParam: 'FREE SN', minAmount: 100 },
            // Congo Brazzaville
            'MTN_CG': { endpoint: '/payouts/public/mtn_cg', networkParam: 'MTN CG', minAmount: 100 },
            // Togo
            'TOGOCOM_TG': { endpoint: '/payouts/public/togo', networkParam: 'TOGOCOM TG', minAmount: 100 },
            'MOOV_TG': { endpoint: '/payouts/public/togo', networkParam: 'MOOV TG', minAmount: 100 },
            // Burkina Faso
            'MOOV_BF': { endpoint: '/payouts/public/moov_bf', networkParam: 'MOOV BF', minAmount: 100 },
            'ORANGE_BF': { endpoint: '/payouts/public/orange_bf', networkParam: 'ORANGE BF', minAmount: 100 },
            // Add other countries as needed based on FeexPay docs
        };

    private readonly countryDialingCodes: Record<string, string> = {
        'BJ': '229', // Benin
        'CI': '225', // Côte d\'Ivoire
        'SN': '221', // Senegal
        'CG': '242', // Congo Brazzaville
        'TG': '228', // Togo
        'BF': '226', // Burkina Faso
        'GN': '224', // Guinea
        'ML': '223', // Mali
        'NE': '227', // Niger
        'GA': '241', // Gabon
        'CD': '243', // DRC
        'KE': '254', // Kenya (Not yet in FeexPay docs for payout, but in current system)
        // Note: CM (Cameroon) is handled by CinetPay
    };


    constructor() {
        this.apiClient = axios.create({
            baseURL: config.feexpay.baseUrl, // Assuming a base URL like 'https://api.feexpay.me/api'
            timeout: 60000, // 60 seconds timeout
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.feexpay.apiKey}`, // Authorization header for all requests
            },
        });

        // Interceptors for logging
        this.apiClient.interceptors.request.use(
            (reqConfig) => {
                log.debug(`FeexPay API Request: ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`, reqConfig.data);
                return reqConfig;
            },
            (error) => {
                log.error('FeexPay API Request Error:', error);
                return Promise.reject(error);
            }
        );

        this.apiClient.interceptors.response.use(
            (response) => {
                log.debug(`FeexPay API Response: ${response.status} ${response.config.url}`, response.data);
                return response;
            },
            (error) => {
                log.error('FeexPay API Response Error:', error.response?.data || error.message);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Initiates a payout transfer via FeexPay.
     * Selects the appropriate FeexPay endpoint based on country and operator.
     */
    public async initiatePayout(request: PayoutRequest): Promise<PayoutResult> {
        log.info(`Initiating FeexPay payout for user ${request.userId} to ${request.phoneNumber} via ${request.momoOperator}. Amount: ${request.amount}`);

        try {
            const endpointConfig = this.feexPayPayoutEndpoints[request.momoOperator];

            if (!endpointConfig) {
                const message = `Unsupported mobile money operator for FeexPay payout: ${request.momoOperator}.`;
                log.error(message);
                throw new AppError(message, 400);
            }

            // Basic validation
            if (request.amount < endpointConfig.minAmount) {
                throw new AppError(`Minimum payout amount for ${request.momoOperator} is ${endpointConfig.minAmount} FCFA.`, 400);
            }

            // Ensure phone number has country prefix if required by FeexPay for specific endpoints
            let formattedPhoneNumber = request.phoneNumber;
            const dialingPrefix = this.countryDialingCodes[request.countryCode];
            if (dialingPrefix && !formattedPhoneNumber.startsWith(dialingPrefix)) {
                formattedPhoneNumber = dialingPrefix + formattedPhoneNumber.replace(/\D/g, ''); // Ensure no spaces/dashes and add prefix
                log.info(`Formatted phone number for FeexPay: ${formattedPhoneNumber}`);
            } else {
                formattedPhoneNumber = formattedPhoneNumber.replace(/\D/g, ''); // Ensure no spaces/dashes if prefix already there or not needed
            }


            const requestBody = {
                phoneNumber: formattedPhoneNumber, // As per FeexPay docs, some endpoints expect full number
                amount: request.amount,
                shop: config.feexpay.shopId,
                network: endpointConfig.networkParam, // Specific network param for the chosen endpoint
                motif: request.description || `SBC Withdrawal ${request.client_transaction_id}`,
                callback_info: {
                    client_transaction_id: request.client_transaction_id,
                    userId: request.userId
                }
                // FeexPay Payout API docs generally don't show email in the request body for mobile money payouts,
                // but if an endpoint explicitly requires it, it can be added conditionally here.
                // email: request.recipientEmail, // Optional: if FeexPay payout endpoint accepts it
            };

            log.info(`Sending FeexPay payout request to ${endpointConfig.endpoint} with body:`, requestBody);

            const response = await this.apiClient.post(endpointConfig.endpoint, requestBody);

            log.info(`FeexPay payout response for ${request.client_transaction_id}:`, response.data);

            if (response.data.status === 'SUCCESSFUL' || response.data.status === 'PENDING') {
                return {
                    success: true,
                    transactionId: request.client_transaction_id,
                    feexpayReference: response.data.reference,
                    status: this.mapFeexPayStatus(response.data.status),
                    message: response.data.message || 'Payout initiated successfully.',
                    amount: request.amount,
                    recipient: request.phoneNumber,
                };
            } else {
                const message = response.data.message || `FeexPay payout failed: ${response.data.status}`;
                log.error(`FeexPay payout initiation failed for ${request.client_transaction_id}: ${message}`, response.data);
                return {
                    success: false,
                    status: 'failed',
                    message: message,
                    amount: request.amount,
                    recipient: request.phoneNumber,
                    error: response.data,
                };
            }

        } catch (error: any) {
            log.error(`Error initiating FeexPay payout for ${request.client_transaction_id}: ${error.message}`, error.response?.data || error);
            throw new AppError(`Failed to initiate FeexPay payout: ${error.response?.data?.message || error.message}`, error.response?.status || 500);
        }
    }

    /**
     * Checks the status of a FeexPay payout using its reference ID.
     * This is needed for payouts that initially return PENDING.
     */
    public async checkPayoutStatus(feexpayReference: string): Promise<PayoutStatus> {
        log.info(`Checking FeexPay payout status for reference: ${feexpayReference}`);

        try {
            const response = await this.apiClient.get(`/payouts/status/public/${feexpayReference}`);

            const feexpayResponse = response.data;
            log.info(`FeexPay payout status response for ${feexpayReference}:`, feexpayResponse);

            if (response.status === 200 && feexpayResponse.status) {
                return {
                    transactionId: feexpayResponse.client_transaction_id || feexpayReference, // Use client_transaction_id if available, otherwise reference
                    feexpayReference: feexpayResponse.reference,
                    status: this.mapFeexPayStatus(feexpayResponse.status),
                    amount: feexpayResponse.amount,
                    recipient: feexpayResponse.phoneNumber,
                    comment: feexpayResponse.message || feexpayResponse.comment, // Use message or comment
                    completedAt: feexpayResponse.validated_at ? new Date(feexpayResponse.validated_at) : undefined, // Assuming a validated_at field
                };
            } else {
                const message = feexpayResponse.message || `Failed to retrieve FeexPay payout status: ${feexpayResponse.status}`;
                log.error(message, feexpayResponse);
                throw new AppError(message, response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error checking FeexPay payout status for ${feexpayReference}: ${error.message}`, error.response?.data || error);
            throw new AppError(`Failed to check FeexPay payout status: ${error.response?.data?.message || error.message}`, error.response?.status || 500);
        }
    }

    /**
     * Maps FeexPay's status strings to our internal PayoutStatus enum.
     */
    private mapFeexPayStatus(feexPayStatus: string): 'pending' | 'processing' | 'completed' | 'failed' {
        switch (feexPayStatus.toUpperCase()) {
            case 'SUCCESSFUL':
                return 'completed';
            case 'PENDING':
            case 'IN PENDING STATE': // As per documentation
                return 'pending'; // Or 'processing' if that better fits 'in progress'
            case 'FAILED':
            case 'CANCELED': // Assuming this is a possible failed state
                return 'failed';
            default:
                log.warn(`Unknown FeexPay payout status: ${feexPayStatus}. Mapping to 'pending'.`);
                return 'pending';
        }
    }

    /**
     * Processes incoming webhook notifications for FeexPay payout status changes.
     */
    public processWebhookNotification(payload: any): {
        transactionId: string;
        feexpayReference: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        amount: number;
        recipient: string;
        comment?: string;
    } {
        // FeexPay webhook payload: Json containing reference, amount, status, callback_info
        log.debug('Processing FeexPay webhook notification payload:', payload);
        const internalTxId = payload.callback_info?.client_transaction_id || payload.client_transaction_id;

        if (!internalTxId) {
            log.error('Could not extract internal transaction ID (client_transaction_id) from FeexPay webhook payload.', payload);
            throw new AppError('Internal transaction ID missing from FeexPay webhook payload.', 400);
        }

        return {
            transactionId: internalTxId,
            feexpayReference: payload.reference,
            status: this.mapFeexPayStatus(payload.status),
            amount: payload.amount,
            recipient: payload.phoneNumber || 'N/A', // Assuming phoneNumber is in payload
            comment: payload.message || payload.status // Use message if available, else status
        };
    }
}

export const feexPayPayoutService = new FeexPayPayoutService(); 