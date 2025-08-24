import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import config from '../config';
import { Currency } from '../database/models/transaction.model';
import { AppError } from '../utils/errors';

const log = logger.getLogger('FeexPayPayoutService');

/**
 * FeexPay Payout Service
 * 
 * This service handles FeexPay payout operations for Togo and other supported countries.
 * 
 * IMPORTANT: This implementation follows the official FeexPay Togo Payout API documentation:
 * - URL: https://api.feexpay.me/api/payouts/public/togo
 * - Required fields: phoneNumber, amount, shop, network, motif
 * - Optional fields: email, callback_info
 * - Response: amount, reference, status (SUCCESSFUL/FAILED/PENDING)
 * - Status check: GET /payouts/status/public/{reference}
 * 
 * WEBHOOK INTEGRATION:
 * FeexPay webhooks are POST requests with JSON payload containing:
 * - reference: FeexPay transaction reference
 * - amount: Transaction amount
 * - status: Transaction status
 * - callback_info: Custom data (includes our client_transaction_id)
 * 
 * The callback_info field in the payout request will be returned in webhook payload,
 * allowing us to maintain internal transaction ID mapping.
 * 
 * For Togo specifically:
 * - Network values: "TOGOCOM TG" or "MOOV TG" 
 * - Phone format: 22871000000 (country code + number)
 * - Minimum amount: 100 FCFA
 * - Currency: XOF (West African CFA franc)
 * 
 * IP WHITELISTING REQUIREMENTS:
 * - FeexPay requires server IP addresses to be whitelisted
 * - Contact FeexPay support to whitelist your server IPs
 * - Use the check-server-ip.js script to identify your public IPs
 * 
 * @see https://api.feexpay.me/api/payouts/public/togo
 */

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
    requiresIPWhitelisting?: boolean; // New flag to indicate IP whitelist needed
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
    // Updated based on official FeexPay Payout API documentation
    private readonly feexPayPayoutEndpoints: Record<string, {
        endpoint: string;
        networkParam: string; // The 'network' parameter expected by FeexPay
        minAmount: number; // Minimum amount for this endpoint/network
    }> = {
            // Benin - Using global endpoint for MTN and MOOV
            'MTN_MOMO_BEN': { endpoint: '/payouts/public/transfer/global', networkParam: 'MTN', minAmount: 50 },
            'MOOV_BEN': { endpoint: '/payouts/public/transfer/global', networkParam: 'MOOV', minAmount: 50 },

            // Togo - Using dedicated Togo endpoint as per documentation
            'TOGOCOM_TG': { endpoint: '/payouts/public/togo', networkParam: 'TOGOCOM TG', minAmount: 100 },
            'MOOV_TG': { endpoint: '/payouts/public/togo', networkParam: 'MOOV TG', minAmount: 100 },

            // Congo Brazzaville (Republic of the Congo)
            'MTN_MOMO_COG': { endpoint: '/payouts/public/mtn_cg', networkParam: 'MTN CG', minAmount: 100 },
            'AIRTEL_COG': { endpoint: '/payouts/public/airtel_cg', networkParam: 'AIRTEL CG', minAmount: 100 },

            // DRC (Democratic Republic of Congo)
            'VODACOM_MPESA_COD': { endpoint: '/payouts/public/vodacom_cd', networkParam: 'VODACOM CD', minAmount: 100 },
            'AIRTEL_COD': { endpoint: '/payouts/public/airtel_cd', networkParam: 'AIRTEL CD', minAmount: 100 },
            'ORANGE_COD': { endpoint: '/payouts/public/orange_cd', networkParam: 'ORANGE CD', minAmount: 100 },

            // Kenya
            'MPESA_KEN': { endpoint: '/payouts/public/mpesa_ke', networkParam: 'MPESA KE', minAmount: 100 },

            // Nigeria
            'MTN_MOMO_NGA': { endpoint: '/payouts/public/mtn_ng', networkParam: 'MTN NG', minAmount: 100 },
            'AIRTEL_NGA': { endpoint: '/payouts/public/airtel_ng', networkParam: 'AIRTEL NG', minAmount: 100 },

            // Gabon
            'AIRTEL_GAB': { endpoint: '/payouts/public/airtel_ga', networkParam: 'AIRTEL GA', minAmount: 100 },

            // Note: Côte d'Ivoire, Senegal, and Burkina Faso should now use CinetPay for withdrawals
            // Removing them from FeexPay endpoints to avoid confusion
        };

    private readonly countryDialingCodes: Record<string, string> = {
        'BJ': '229', // Benin
        'CI': '225', // Côte d'Ivoire
        'SN': '221', // Senegal
        'CG': '242', // Congo Brazzaville
        'TG': '228', // Togo
        'BF': '226', // Burkina Faso
        'GN': '224', // Guinea
        'ML': '223', // Mali
        'NE': '227', // Niger
        'GA': '241', // Gabon
        'CD': '243', // DRC
        'KE': '254', // Kenya
        'NG': '234', // Nigeria
        // Note: CM (Cameroon) is handled by CinetPay
    };


    constructor() {
        this.apiClient = axios.create({
            baseURL: config.feexpay.baseUrl, // Assuming a base URL like 'https://api.feexpay.me/api'
            timeout: 600000, // 10 minutes timeout (600000 milliseconds)
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

                // Enhanced error handling for IP whitelisting
                if (this.isIPWhitelistingError(error)) {
                    log.error('🚫 FeexPay IP Whitelisting Error Detected! Server IP needs to be whitelisted.');
                    log.error('📧 Contact FeexPay support to whitelist your server IP address');
                    log.error('🔧 Run the check-server-ip.js script to identify your public IP');
                }

                return Promise.reject(error);
            }
        );
    }

    /**
     * Detects if the error is related to IP whitelisting
     */
    private isIPWhitelistingError(error: any): boolean {
        if (!error.response) return false;

        const status = error.response.status;
        const message = error.response.data?.message || error.message || '';

        // Check for common IP whitelist error patterns
        return (
            status === 403 && (
                message.toLowerCase().includes('forbidden') &&
                (message.toLowerCase().includes('ip') || message.toLowerCase().includes('whitelist'))
            )
        ) || (
                status === 401 && message.toLowerCase().includes('ip not whitelisted')
            ) || (
                message.toLowerCase().includes('ip not whitelisted') ||
                message.toLowerCase().includes('forbidden ip') ||
                message.toLowerCase().includes('ip address not allowed')
            );
    }

    /**
     * Creates a detailed error message for IP whitelisting issues
     */
    private createIPWhitelistingErrorMessage(originalError: any): string {
        return `🚫 FeexPay IP Whitelisting Required

❌ Error: ${originalError.response?.data?.message || originalError.message}

🔧 SOLUTION STEPS:
1. Contact FeexPay Support:
   📧 Email: support@feexpay.me
   📞 Check FeexPay documentation for contact details

2. Request IP Whitelisting:
   🏷️  Shop ID: ${config.feexpay.shopId}
   🌐 Mention this is for PAYOUT API access
   📍 Request whitelisting for server IP addresses

3. Get Your Server IPs:
   💻 Run: node check-server-ip.js
   🔍 Or check your hosting provider's documentation

⚠️  IMPORTANT: Without IP whitelisting, all FeexPay payouts will fail.
💡 Consider setting up a static IP or NAT gateway for production.`;
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

            // Validate and prepare motif (description) according to FeexPay documentation
            // Minimum 5 characters, no special characters
            let motif = request.description || `SBC Withdrawal ${request.client_transaction_id}`;

            // Remove special characters (keep only alphanumeric and spaces)
            motif = motif.replace(/[^a-zA-Z0-9\s]/g, '');

            // Ensure minimum 5 characters
            if (motif.length < 5) {
                motif = `SBC Withdrawal ${request.client_transaction_id || Date.now()}`.replace(/[^a-zA-Z0-9\s]/g, '');
            }

            // Prepare request body according to official FeexPay Togo API documentation
            const requestBody: any = {
                phoneNumber: formattedPhoneNumber, // e.g., 22871000000
                amount: request.amount, // Minimum 100
                shop: config.feexpay.shopId, // Shop ID from FeexPay developer menu
                network: endpointConfig.networkParam, // TOGOCOM TG or MOOV TG
                motif: motif, // Description (min 5 chars, no special characters)
                // Include callback_info for webhook processing (this will be returned in webhook payload)
                callback_info: {
                    client_transaction_id: request.client_transaction_id,
                    userId: request.userId
                }
            };

            // Add optional email field if available
            if (request.recipientEmail) {
                requestBody.email = request.recipientEmail;
            }

            log.info(`Sending FeexPay payout request to ${endpointConfig.endpoint} with body:`, {
                ...requestBody,
                phoneNumber: '***' + requestBody.phoneNumber.slice(-4) // Hide phone number in logs
            });

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

            // Enhanced error handling for IP whitelisting
            if (this.isIPWhitelistingError(error)) {
                const detailedMessage = this.createIPWhitelistingErrorMessage(error);
                log.error(detailedMessage);

                throw new AppError(detailedMessage, 403);
            }

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
            console.log(feexpayResponse)
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

            // Enhanced error handling for IP whitelisting in status checks too
            if (this.isIPWhitelistingError(error)) {
                const detailedMessage = this.createIPWhitelistingErrorMessage(error);
                log.error(detailedMessage);
                throw new AppError(detailedMessage, 403);
            }

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
     * Helper method to extract transaction ID from webhook payload.
     * Updated to handle official FeexPay webhook structure with callback_info.
     * 
     * @param payload - The webhook payload from FeexPay
     * @returns Object containing transaction ID and reference for mapping
     */
    public extractTransactionIdentifiers(payload: any): {
        internalTransactionId: string | null;
        feexpayReference: string | null;
        requiresLookup: boolean;
    } {
        const feexpayReference = payload.reference;
        // According to official webhook docs, callback_info is included in webhook payload
        const internalTxId = payload.callback_info?.client_transaction_id;

        return {
            internalTransactionId: internalTxId || null,
            feexpayReference: feexpayReference || null,
            requiresLookup: !internalTxId && !!feexpayReference
        };
    }

    /**
     * Processes incoming webhook notifications for FeexPay payout status changes.
     * Updated to handle official FeexPay webhook payload structure.
     * 
     * Official webhook payload structure:
     * {
     *   "reference": "transaction_reference",
     *   "amount": transaction_amount,
     *   "status": "transaction_status",
     *   "callback_info": {
     *     "client_transaction_id": "our_internal_id",
     *     "userId": "user_id"
     *   }
     * }
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

        // Use the helper method to extract transaction identifiers
        const { internalTransactionId, feexpayReference, requiresLookup } = this.extractTransactionIdentifiers(payload);

        if (!feexpayReference) {
            log.error('Could not extract FeexPay reference from webhook payload.', payload);
            throw new AppError('FeexPay reference missing from webhook payload.', 400);
        }

        if (!internalTransactionId) {
            log.error('Could not extract internal transaction ID from FeexPay webhook callback_info.', payload);
            throw new AppError('Internal transaction ID missing from FeexPay webhook payload.', 400);
        }

        log.info(`Processing FeexPay webhook: internal ID ${internalTransactionId}, FeexPay reference ${feexpayReference}, status ${payload.status}`);

        return {
            transactionId: internalTransactionId,
            feexpayReference: feexpayReference,
            status: this.mapFeexPayStatus(payload.status),
            amount: payload.amount,
            recipient: payload.phoneNumber || 'N/A', // May not always be in webhook payload
            comment: payload.message || payload.status // Use message if available, else status
        };
    }
}

export const feexPayPayoutService = new FeexPayPayoutService();
