import { AxiosError } from 'axios';
import logger from '../utils/logger';
import config from '../config';
import {
    createWhatsAppHttpClient,
    withRetry,
    extractWhatsAppError
} from '../utils/http-client';
import {
    WhatsAppMessage,
    WhatsAppResponse,
    WhatsAppError
} from '../types/whatsapp-cloud-api.types';
import {
    WHATSAPP_API_ENDPOINTS,
    MESSAGE_TYPES,
    PHONE_VALIDATION,
    RETRY_CONFIG,
    DEFAULTS,
    MEDIA_CONFIG
} from '../constants/whatsapp-cloud-api.constants';
import {
    WhatsAppApiError,
    defaultWhatsAppErrorHandler
} from '../utils/whatsapp-error-handler';
import { EventEmitter } from 'events';
import { WhatsAppSendResult } from './whatsapp-service-factory';

const log = logger.getLogger('WhatsAppCloudService');

interface TransactionData {
    phoneNumber: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
}

/**
 * WhatsApp Cloud API Service
 * Handles sending messages via the official WhatsApp Cloud API
 */
class WhatsAppCloudService extends EventEmitter {
    private httpClient;
    private phoneNumberId: string;
    private isReady: boolean = false;
    private connectionState: string = 'initializing';
    private lastHealthCheck: Date | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.httpClient = createWhatsAppHttpClient();
        this.phoneNumberId = config.whatsapp.phoneNumberId;

        // Initialize the service
        this.init();
    }

    /**
     * Initialize the WhatsApp Cloud API service
     */
    private async init(): Promise<void> {
        try {
            log.info('Initializing WhatsApp Cloud API service...');

            // Validate required configuration
            this.validateConfig();

            // Check API connectivity
            await this.checkApiConnectivity();

            // Set up periodic health checks
            this.setupHealthChecks();

            log.info('WhatsApp Cloud API service initialized successfully');
            this.isReady = true;
            this.connectionState = 'connected';
            this.emit('connected');
        } catch (error) {
            log.error('Failed to initialize WhatsApp Cloud API service:', error);
            this.isReady = false;
            this.connectionState = 'error';
            this.emit('error', error);
        }
    }

    /**
     * Validate required configuration
     */
    private validateConfig(): void {
        const requiredFields = ['accessToken', 'phoneNumberId', 'businessAccountId', 'webhookVerifyToken'];
        const missingFields = requiredFields.filter(field => !config.whatsapp[field as keyof typeof config.whatsapp]);

        if (missingFields.length > 0) {
            throw new Error(`Missing required WhatsApp Cloud API configuration: ${missingFields.join(', ')}`);
        }
    }

    /**
     * Check API connectivity
     */
    private async checkApiConnectivity(): Promise<void> {
        try {
            // Simple API call to verify connectivity
            const response = await this.httpClient.get(`/${this.phoneNumberId}`);
            log.info('WhatsApp Cloud API connectivity verified');
        } catch (error) {
            log.error('Failed to verify WhatsApp Cloud API connectivity:', error);
            throw error;
        }
    }

    /**
     * Set up periodic health checks
     */
    private setupHealthChecks(): void {
        // Check health every 5 minutes
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.checkApiConnectivity();
                this.lastHealthCheck = new Date();
                this.isReady = true;
                this.connectionState = 'connected';
            } catch (error) {
                log.warn('Health check failed:', error);
                this.isReady = false;
                this.connectionState = 'error';
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Sends a template message using the WhatsApp Cloud API
     * @param params The parameters for sending the template message
     * @returns A promise that resolves with the result of the send operation
     */
    async sendTemplateMessage(params: {
        phoneNumber: string;
        templateName: string;
        languageCode: string;
        components: any[];
    }): Promise<WhatsAppSendResult> {
        try {
            // Rate limiting disabled - WhatsApp Business API has its own rate limits
            // TODO: Implement proper rate limiting if needed in the future
            // Note: WhatsApp Business API enforces 1000 marketing conversations per day

            const formattedPhoneNumber = this.formatPhoneNumber(params.phoneNumber);

            const messageData: WhatsAppMessage = {
                messaging_product: 'whatsapp',
                to: formattedPhoneNumber,
                type: 'template',
                template: {
                    name: params.templateName,
                    language: {
                        code: params.languageCode,
                    },
                    components: params.components,
                },
            };

            // Use retry logic for the API call (same as sendTextMessageEnhanced)
            const response = await withRetry(
                async () => {
                    return this.httpClient.post(
                        `/${this.phoneNumberId}/${WHATSAPP_API_ENDPOINTS.MESSAGES}`,
                        messageData
                    );
                },
                RETRY_CONFIG.MAX_RETRIES,
                RETRY_CONFIG.BASE_DELAY
            );

            const responseData = response.data as WhatsAppResponse;

            if (responseData.messages && responseData.messages.length > 0) {
                const messageId = responseData.messages[0].id;

                // Rate limiting removed - handled by WhatsApp Business API

                log.info(`WhatsApp template message sent successfully to ${formattedPhoneNumber}, message ID: ${messageId}`);
                return {
                    success: true,
                    messageId
                };
            }

            return {
                success: false,
                error: 'No message ID in response from WhatsApp API',
            };
        } catch (error) {
            const whatsappError = defaultWhatsAppErrorHandler.processError(error, {
                phoneNumber: params.phoneNumber
            });
            log.error(`Failed to send template message to ${params.phoneNumber}:`, whatsappError);
            return {
                success: false,
                error: whatsappError.message || 'Unknown error occurred',
            };
        }
    }

    /**
     * Get connection status
     */
    public getConnectionStatus(): {
        isReady: boolean;
        connectionState: string;
        lastHealthCheck: Date | null;
        implementation: string;
    } {
        return {
            isReady: this.isReady,
            connectionState: this.connectionState,
            lastHealthCheck: this.lastHealthCheck,
            implementation: 'WhatsApp Cloud API'
        };
    }

    /**
     * Handle disconnect callback (compatibility with Bailey interface)
     */
    public onDisconnect(callback: (qrUrl: string | null) => void): void {
        // For Cloud API, there's no QR code disconnect concept
        // We can emit connection errors instead
        this.on('error', () => callback(null));
    }

    /**
     * Validate phone number format
     */
    private validatePhoneNumber(phoneNumber: string): boolean {
        // Remove all non-digit characters
        const cleanNumber = phoneNumber.replace(/\D/g, '');

        // Check if it's a valid international format (7-15 digits)
        return cleanNumber.length >= 7 && cleanNumber.length <= 15;
    }

    /**
     * Format phone number for WhatsApp API (International)
     * Handles numbers from multiple countries while preserving existing country codes
     */
    private formatPhoneNumber(phoneNumber: string): string {
        // Remove all non-digit characters
        let cleanNumber = phoneNumber.replace(/\D/g, '');

        // If number is already in international format (12+ digits), keep as-is
        // We use 12+ because some countries have 11-digit local numbers that need formatting
        if (cleanNumber.length >= 12) {
            return cleanNumber;
        }

        // Common country code patterns - if number starts with these, it's likely already formatted
        const commonCountryCodes = [
            // Major non-African countries
            '1',    // US/Canada
            '33',   // France
            '44',   // UK
            '49',   // Germany
            '86',   // China
            '91',   // India

            // Complete African country codes (all 54 African countries)
            '212',  // Morocco
            '213',  // Algeria
            '216',  // Tunisia
            '218',  // Libya
            '220',  // Gambia
            '221',  // Senegal
            '222',  // Mauritania
            '223',  // Mali
            '224',  // Guinea
            '225',  // Côte d'Ivoire (Ivory Coast)
            '226',  // Burkina Faso
            '227',  // Niger
            '228',  // Togo
            '229',  // Benin
            '230',  // Mauritius
            '231',  // Liberia
            '232',  // Sierra Leone
            '233',  // Ghana
            '234',  // Nigeria
            '235',  // Chad
            '236',  // Central African Republic
            '237',  // Cameroon
            '238',  // Cape Verde
            '239',  // São Tomé and Príncipe
            '240',  // Equatorial Guinea
            '241',  // Gabon
            '242',  // Republic of the Congo
            '243',  // Democratic Republic of the Congo
            '244',  // Angola
            '245',  // Guinea-Bissau
            '246',  // British Indian Ocean Territory
            '247',  // Ascension Island
            '248',  // Seychelles
            '249',  // Sudan
            '250',  // Rwanda
            '251',  // Ethiopia
            '252',  // Somalia
            '253',  // Djibouti
            '254',  // Kenya
            '255',  // Tanzania
            '256',  // Uganda
            '257',  // Burundi
            '258',  // Mozambique
            '260',  // Zambia
            '261',  // Madagascar
            '262',  // Réunion/Mayotte (France)
            '263',  // Zimbabwe
            '264',  // Namibia
            '265',  // Malawi
            '266',  // Lesotho
            '267',  // Botswana
            '268',  // Eswatini (Swaziland)
            '269',  // Comoros
            '27',   // South Africa
            '290',  // Saint Helena
            '291',  // Eritrea
            '297',  // Aruba (sometimes used in Africa context)
            '298',  // Faroe Islands (sometimes used in Africa context)
        ];

        // Check if number already starts with a country code
        // Prioritize longer country codes to avoid conflicts (e.g., 212 vs 21)
        const sortedCodes = commonCountryCodes.sort((a, b) => b.length - a.length);

        for (const code of sortedCodes) {
            if (cleanNumber.startsWith(code)) {
                // Additional validation: ensure the remaining digits make sense for that country
                const remainingDigits = cleanNumber.substring(code.length);

                // For 3-digit country codes, remaining should be 7-10 digits
                // For 2-digit country codes, remaining should be 8-10 digits  
                // For 1-digit country codes, remaining should be 10 digits
                const minRemaining = code.length === 3 ? 7 : code.length === 2 ? 8 : 10;
                const maxRemaining = 10;

                if (remainingDigits.length >= minRemaining && remainingDigits.length <= maxRemaining) {
                    // Special case: avoid treating US numbers as Morocco (212) numbers
                    if (code === '212' && cleanNumber.length === 10 && /^[2-9]\d{9}$/.test(cleanNumber)) {
                        // This looks like a US number, continue to US formatting logic
                        break;
                    }

                    // Number already has country code, return as-is
                    return cleanNumber;
                }
            }
        }

        // Handle specific patterns for numbers without country codes
        // Focus on your main user countries from payment service + major African countries
        // Use intelligent defaults to minimize conflicts

        // Nigerian numbers (11 digits starting with 0, remove 0 and add 234)
        if (cleanNumber.length === 11 && cleanNumber.startsWith('0') &&
            (cleanNumber.startsWith('070') || cleanNumber.startsWith('080') ||
                cleanNumber.startsWith('081') || cleanNumber.startsWith('090') ||
                cleanNumber.startsWith('091'))) {
            return '234' + cleanNumber.substring(1);
        }

        // Cameroon mobile numbers (9 digits starting with 6) - Your primary market
        if (cleanNumber.length === 9 && cleanNumber.startsWith('6')) {
            return '237' + cleanNumber;
        }

        // Senegal numbers (9 digits starting with 7, add 221)
        if (cleanNumber.length === 9 && cleanNumber.startsWith('7')) {
            return '221' + cleanNumber;
        }

        // DRC numbers (9 digits starting with 8 or 9, add 243)
        if (cleanNumber.length === 9 &&
            (cleanNumber.startsWith('8') || cleanNumber.startsWith('9'))) {
            return '243' + cleanNumber;
        }

        // Congo Brazzaville numbers (9 digits starting with 0, remove 0 and add 242)
        if (cleanNumber.length === 9 && cleanNumber.startsWith('0') &&
            (cleanNumber.startsWith('05') || cleanNumber.startsWith('06'))) {
            return '242' + cleanNumber.substring(1);
        }

        // Gabon numbers (8 digits starting with 0, remove 0 and add 241)
        if (cleanNumber.length === 8 && cleanNumber.startsWith('0') &&
            (cleanNumber.startsWith('05') || cleanNumber.startsWith('06') ||
                cleanNumber.startsWith('07'))) {
            return '241' + cleanNumber.substring(1);
        }

        // West African 8-digit patterns - Use smart defaults based on your user base
        if (cleanNumber.length === 8) {
            // Burkina Faso (5X patterns)
            if (cleanNumber.startsWith('5')) {
                return '226' + cleanNumber;
            }
            // Benin (4X patterns)
            if (cleanNumber.startsWith('4')) {
                return '229' + cleanNumber;
            }
            // Tunisia (3X patterns)
            if (cleanNumber.startsWith('3')) {
                return '216' + cleanNumber;
            }
            // Mali (default for 2X, 6X, 7X, 9X patterns - most common in your region)
            if (cleanNumber.startsWith('2') || cleanNumber.startsWith('6') ||
                cleanNumber.startsWith('7') || cleanNumber.startsWith('9')) {
                return '223' + cleanNumber;
            }
        }

        // 10-digit numbers starting with 0 - Smart routing based on common patterns
        if (cleanNumber.length === 10 && cleanNumber.startsWith('0')) {
            const prefix = cleanNumber.substring(0, 3);

            // Very specific patterns first to avoid conflicts

            // Ethiopia (091-099) - Very specific pattern
            if (prefix >= '091' && prefix <= '099') {
                return '251' + cleanNumber.substring(1);
            }

            // Ghana (specific mobile patterns)
            if (prefix === '020' || prefix === '023' || prefix === '024' ||
                prefix === '026' || prefix === '027' || prefix === '028' ||
                prefix === '050' || prefix === '054' || prefix === '055' ||
                prefix === '056' || prefix === '057' || prefix === '059') {
                return '233' + cleanNumber.substring(1);
            }

            // Morocco (06X patterns)
            if (prefix >= '061' && prefix <= '069') {
                return '212' + cleanNumber.substring(1);
            }

            // Algeria (specific patterns)
            if (prefix === '055' || prefix === '056' || prefix === '057' ||
                prefix === '069' || prefix === '077' || prefix === '079') {
                return '213' + cleanNumber.substring(1);
            }

            // For conflicting 07X patterns, use geographic/usage-based defaults
            if (prefix >= '070' && prefix <= '079') {
                // Kenya is very common for 07X patterns in East Africa
                return '254' + cleanNumber.substring(1);
            }

            // For 08X patterns
            if (prefix >= '080' && prefix <= '089') {
                // Rwanda for 08X patterns
                return '250' + cleanNumber.substring(1);
            }

            // For 03X patterns (Uganda)
            if (prefix >= '030' && prefix <= '039') {
                return '256' + cleanNumber.substring(1);
            }

            // For 06X patterns not caught by Morocco
            if (prefix >= '060' && prefix <= '069') {
                // Tanzania for remaining 06X
                return '255' + cleanNumber.substring(1);
            }

            // For remaining patterns, default to Côte d'Ivoire (broad coverage)
            // This covers most West African patterns not caught above
            return '225' + cleanNumber.substring(1);
        }

        // UK numbers (11 digits starting with 0, remove 0 and add 44)
        if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) {
            return '44' + cleanNumber.substring(1);
        }

        // French numbers (10 digits starting with 0, remove 0 and add 33)
        if (cleanNumber.length === 10 && cleanNumber.startsWith('0')) {
            return '33' + cleanNumber.substring(1);
        }

        // US/Canada numbers (10 digits, no country code)
        // More flexible pattern for US numbers
        if (cleanNumber.length === 10 && /^[2-9]\d{9}$/.test(cleanNumber)) {
            return '1' + cleanNumber;
        }

        // If we can't determine the country, log a warning and return as-is
        // This prevents breaking existing functionality
        log.warn(`Unable to determine country code for phone number: ${phoneNumber} (cleaned: ${cleanNumber})`);
        return cleanNumber;
    }

    /**
     * Upload media to WhatsApp servers
     */
    private async uploadMedia(buffer: Buffer, mimetype: string): Promise<string> {
        try {
            // Validate file type
            this.validateFileType(mimetype);

            // Validate file size
            this.validateFileSize(buffer.length, mimetype);

            log.info('Uploading media to WhatsApp servers', {
                size: buffer.length,
                mimetype
            });

            // Create form data for upload
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', buffer, {
                contentType: mimetype,
                filename: 'media_file'
            });
            form.append('messaging_product', 'whatsapp');

            const response = await this.httpClient.post(
                `/${WHATSAPP_API_ENDPOINTS.MEDIA}`,
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                    }
                }
            );

            const mediaId = response.data.id;
            log.info('Media uploaded successfully', { mediaId });

            return mediaId;
        } catch (error) {
            log.error('Failed to upload media:', error);
            throw error;
        }
    }

    /**
     * Validate file type
     */
    private validateFileType(mimetype: string): void {
        let supportedTypes: readonly string[];

        if (mimetype.startsWith('image/')) {
            supportedTypes = MEDIA_CONFIG.SUPPORTED_TYPES.IMAGE;
        } else if (mimetype.startsWith('video/')) {
            supportedTypes = MEDIA_CONFIG.SUPPORTED_TYPES.VIDEO;
        } else if (mimetype.startsWith('audio/')) {
            supportedTypes = MEDIA_CONFIG.SUPPORTED_TYPES.AUDIO;
        } else {
            supportedTypes = MEDIA_CONFIG.SUPPORTED_TYPES.DOCUMENT;
        }

        if (!supportedTypes.includes(mimetype)) {
            throw new Error(`Unsupported file type: ${mimetype}. Supported types: ${supportedTypes.join(', ')}`);
        }
    }

    /**
     * Validate file size
     */
    private validateFileSize(size: number, mimetype: string): void {
        let maxSize: number;

        if (mimetype.startsWith('image/')) {
            maxSize = MEDIA_CONFIG.MAX_FILE_SIZE.IMAGE;
        } else if (mimetype.startsWith('video/')) {
            maxSize = MEDIA_CONFIG.MAX_FILE_SIZE.VIDEO;
        } else if (mimetype.startsWith('audio/')) {
            maxSize = MEDIA_CONFIG.MAX_FILE_SIZE.AUDIO;
        } else {
            maxSize = MEDIA_CONFIG.MAX_FILE_SIZE.DOCUMENT;
        }

        if (size > maxSize) {
            throw new Error(`File size (${size} bytes) exceeds maximum allowed size (${maxSize} bytes) for ${mimetype}`);
        }
    }

    /**
     * Send a text message via WhatsApp Cloud API
     * @param params.phoneNumber Recipient phone number
     * @param params.message Text message content
     * @param params.previewUrl Whether to show URL previews in the message (optional)
     * @returns Promise resolving to boolean indicating success
     */
    public async sendTextMessage({
        phoneNumber,
        message,
        previewUrl = DEFAULTS.PREVIEW_URL
    }: {
        phoneNumber: string,
        message: string,
        previewUrl?: boolean
    }): Promise<boolean> {
        const result = await this.sendTextMessageEnhanced({ phoneNumber, message, previewUrl });
        return result.success;
    }

    /**
     * Send multiple text messages via WhatsApp Cloud API with rate limiting
     * @param params.phoneNumber Recipient phone number
     * @param params.messages Array of text message contents
     * @param params.delayBetweenMessages Delay between messages in milliseconds (default: 1000ms)
     * @param params.previewUrl Whether to show URL previews in messages (default: false)
     * @returns Promise resolving to boolean indicating success
     */
    public async sendMultipleTextMessages({
        phoneNumber,
        messages,
        delayBetweenMessages = 1000,
        previewUrl = DEFAULTS.PREVIEW_URL
    }: {
        phoneNumber: string,
        messages: string[],
        delayBetweenMessages?: number,
        previewUrl?: boolean
    }): Promise<boolean> {
        const result = await this.sendMultipleTextMessagesEnhanced({
            phoneNumber,
            messages,
            delayBetweenMessages,
            previewUrl
        });
        return result.success;
    }

    /**
     * Send a file message via WhatsApp Cloud API
     * @param params.phoneNumber Recipient phone number
     * @param params.buffer File buffer
     * @param params.mimetype File MIME type
     * @param params.fileName Optional file name
     * @param params.caption Optional caption for the file
     * @returns Promise resolving to boolean indicating success
     */
    public async sendFileMessage({
        phoneNumber,
        buffer,
        mimetype,
        fileName,
        caption
    }: {
        phoneNumber: string,
        buffer: Buffer,
        mimetype: string,
        fileName?: string,
        caption?: string
    }): Promise<boolean> {
        const result = await this.sendFileMessageEnhanced({
            phoneNumber,
            buffer,
            mimetype,
            fileName,
            caption
        });
        return result.success;
    }

    /**
     * Send transaction notification via WhatsApp
     */
    public async sendTransactionNotification(data: TransactionData): Promise<boolean> {
        const message = `🔔 Transaction Alert\n\nHi ${data.name},\n\nTransaction ID: ${data.transactionId}\nType: ${data.transactionType}\nAmount: ${data.amount} ${data.currency}\nDate: ${data.date}\n\nThank you for using our service!`;

        return this.sendTextMessage({
            phoneNumber: data.phoneNumber,
            message
        });
    }

    // Enhanced methods that return detailed results with message IDs

    /**
     * Send a text message via WhatsApp Cloud API (Enhanced version with message ID tracking)
     * @param params.phoneNumber Recipient phone number
     * @param params.message Text message content
     * @param params.previewUrl Whether to show URL previews in the message (optional)
     * @returns Promise resolving to detailed result with message ID
     */
    public async sendTextMessageEnhanced({
        phoneNumber,
        message,
        previewUrl = DEFAULTS.PREVIEW_URL
    }: {
        phoneNumber: string,
        message: string,
        previewUrl?: boolean
    }): Promise<WhatsAppSendResult> {
        if (!this.isReady) {
            return {
                success: false,
                error: 'WhatsApp Cloud API service not ready. Cannot send message.'
            };
        }

        if (!this.validatePhoneNumber(phoneNumber)) {
            return {
                success: false,
                error: `Invalid phone number format: ${phoneNumber}`
            };
        }

        if (!message || message.trim() === '') {
            return {
                success: false,
                error: 'Message cannot be empty'
            };
        }

        // Check message length (WhatsApp has a 4096 character limit)
        if (message.length > 4096) {
            return {
                success: false,
                error: `Message too long (${message.length} characters). Maximum is 4096 characters.`
            };
        }

        try {
            const originalPhoneNumber = phoneNumber;
            const formattedPhoneNumber = this.formatPhoneNumber(phoneNumber);

            log.info(`WhatsApp Message Details:`, {
                original: originalPhoneNumber,
                formatted: formattedPhoneNumber,
                messageLength: message.length,
                timestamp: new Date().toISOString()
            });

            const messageData: WhatsAppMessage = {
                messaging_product: 'whatsapp',
                to: formattedPhoneNumber,
                type: MESSAGE_TYPES.TEXT,
                text: {
                    body: message,
                    preview_url: previewUrl
                }
            };

            // Use retry logic for the API call
            const response = await withRetry(
                async () => {
                    return this.httpClient.post(
                        `/${this.phoneNumberId}/${WHATSAPP_API_ENDPOINTS.MESSAGES}`,
                        messageData
                    );
                },
                RETRY_CONFIG.MAX_RETRIES,
                RETRY_CONFIG.BASE_DELAY
            );

            const responseData = response.data as WhatsAppResponse;

            if (responseData.messages && responseData.messages.length > 0) {
                const messageId = responseData.messages[0].id;
                log.info(`WhatsApp API Response:`, {
                    messageId,
                    recipient: formattedPhoneNumber,
                    original: originalPhoneNumber,
                    status: 'accepted',
                    timestamp: new Date().toISOString()
                });
                return {
                    success: true,
                    messageId
                };
            }

            log.warn(`WhatsApp message to ${formattedPhoneNumber} failed: No message ID in response`);
            return {
                success: false,
                error: 'No message ID in response'
            };
        } catch (error) {
            const whatsappError = defaultWhatsAppErrorHandler.processError(error, { phoneNumber });
            log.error(`WhatsApp Send Error:`, {
                original: phoneNumber,
                formatted: this.formatPhoneNumber(phoneNumber),
                error: whatsappError.message,
                errorCode: whatsappError.code,
                timestamp: new Date().toISOString(),
                fullError: error
            });
            return {
                success: false,
                error: whatsappError.message || 'Unknown error occurred'
            };
        }
    }

    /**
     * Send multiple text messages via WhatsApp Cloud API with rate limiting (Enhanced version)
     * @param params.phoneNumber Recipient phone number
     * @param params.messages Array of text message contents
     * @param params.delayBetweenMessages Delay between messages in milliseconds (default: 1000ms)
     * @param params.previewUrl Whether to show URL previews in messages (default: false)
     * @returns Promise resolving to detailed result with message IDs
     */
    public async sendMultipleTextMessagesEnhanced({
        phoneNumber,
        messages,
        delayBetweenMessages = 1000,
        previewUrl = DEFAULTS.PREVIEW_URL
    }: {
        phoneNumber: string,
        messages: string[],
        delayBetweenMessages?: number,
        previewUrl?: boolean
    }): Promise<WhatsAppSendResult> {
        if (!this.isReady) {
            return {
                success: false,
                error: 'WhatsApp Cloud API service not ready. Cannot send messages.',
                sentCount: 0,
                totalCount: messages ? messages.length : 0
            };
        }

        if (!this.validatePhoneNumber(phoneNumber)) {
            return {
                success: false,
                error: `Invalid phone number format: ${phoneNumber}`,
                sentCount: 0,
                totalCount: messages ? messages.length : 0
            };
        }

        if (!messages || messages.length === 0) {
            return {
                success: false,
                error: 'No messages provided to send.',
                sentCount: 0,
                totalCount: 0
            };
        }

        // Filter out invalid messages
        const validMessages = messages.filter(msg => msg && typeof msg === 'string' && msg.trim() !== '');

        if (validMessages.length === 0) {
            return {
                success: false,
                error: 'No valid messages to send after filtering.',
                sentCount: 0,
                totalCount: messages.length
            };
        }

        // Check for messages that exceed length limit
        const oversizedMessages = validMessages.filter(msg => msg.length > 4096);
        if (oversizedMessages.length > 0) {
            return {
                success: false,
                error: `${oversizedMessages.length} messages exceed the maximum length of 4096 characters.`,
                sentCount: 0,
                totalCount: validMessages.length
            };
        }

        try {
            const formattedPhoneNumber = this.formatPhoneNumber(phoneNumber);

            log.info(`Sending ${validMessages.length} WhatsApp messages to ${formattedPhoneNumber}`);

            let successCount = 0;
            const messageIds: string[] = [];
            const errors: string[] = [];

            // Send messages sequentially with delay
            for (let i = 0; i < validMessages.length; i++) {
                const message = validMessages[i];

                log.debug(`Sending message ${i + 1}/${validMessages.length} to ${formattedPhoneNumber}`);

                const result = await this.sendTextMessageEnhanced({
                    phoneNumber: formattedPhoneNumber,
                    message,
                    previewUrl
                });

                if (result.success && result.messageId) {
                    messageIds.push(result.messageId);
                    successCount++;
                } else {
                    errors.push(`Message ${i + 1}: ${result.error || 'Unknown error'}`);
                }

                // Add delay between messages (except for the last one)
                if (i < validMessages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
                }
            }

            const success = successCount > 0;
            log.info(`Completed sending ${validMessages.length} WhatsApp messages to ${formattedPhoneNumber}`, {
                successCount,
                errorCount: errors.length,
                messageIds: messageIds.length > 0 ? messageIds : 'none'
            });

            if (errors.length > 0) {
                log.warn(`Errors encountered while sending messages to ${formattedPhoneNumber}:`, errors);
            }

            return {
                success,
                messageIds,
                sentCount: successCount,
                totalCount: validMessages.length,
                error: errors.length > 0 ? errors.join('; ') : undefined
            };
        } catch (error) {
            const whatsappError = defaultWhatsAppErrorHandler.processError(error, { phoneNumber });
            log.error(`Failed to send multiple WhatsApp messages to ${phoneNumber}:`, whatsappError);
            return {
                success: false,
                error: whatsappError.message || 'Unknown error occurred',
                sentCount: 0,
                totalCount: validMessages.length
            };
        }
    }

    /**
     * Send a file message via WhatsApp Cloud API (Enhanced version)
     * @param params.phoneNumber Recipient phone number
     * @param params.buffer File buffer
     * @param params.mimetype File MIME type
     * @param params.fileName Optional file name
     * @param params.caption Optional caption for the file
     * @returns Promise resolving to detailed result with message ID
     */
    public async sendFileMessageEnhanced({
        phoneNumber,
        buffer,
        mimetype,
        fileName,
        caption
    }: {
        phoneNumber: string,
        buffer: Buffer,
        mimetype: string,
        fileName?: string,
        caption?: string
    }): Promise<WhatsAppSendResult> {
        if (!this.isReady) {
            return {
                success: false,
                error: 'WhatsApp Cloud API service not ready. Cannot send file message.'
            };
        }

        if (!this.validatePhoneNumber(phoneNumber)) {
            return {
                success: false,
                error: `Invalid phone number format: ${phoneNumber}`
            };
        }

        if (!buffer || buffer.length === 0) {
            return {
                success: false,
                error: 'Invalid file buffer'
            };
        }

        if (!mimetype || mimetype.trim() === '') {
            return {
                success: false,
                error: 'Invalid mimetype'
            };
        }

        try {
            const formattedPhoneNumber = this.formatPhoneNumber(phoneNumber);

            log.info(`Sending WhatsApp file message to ${formattedPhoneNumber}`, {
                mimeType: mimetype,
                fileSize: buffer.length,
                fileName: fileName || 'file'
            });

            // Determine message type and prepare message data
            let messageData: WhatsAppMessage;

            // First upload the media to WhatsApp servers
            const mediaId = await this.uploadMedia(buffer, mimetype);

            // Create message data based on media type
            if (mimetype.startsWith('image/')) {
                messageData = {
                    messaging_product: 'whatsapp',
                    to: formattedPhoneNumber,
                    type: MESSAGE_TYPES.IMAGE,
                    image: {
                        id: mediaId,
                        caption: caption
                    }
                };
            } else if (mimetype.startsWith('video/')) {
                messageData = {
                    messaging_product: 'whatsapp',
                    to: formattedPhoneNumber,
                    type: MESSAGE_TYPES.VIDEO,
                    video: {
                        id: mediaId,
                        caption: caption
                    }
                };
            } else if (mimetype.startsWith('audio/')) {
                messageData = {
                    messaging_product: 'whatsapp',
                    to: formattedPhoneNumber,
                    type: MESSAGE_TYPES.AUDIO,
                    audio: {
                        id: mediaId
                    }
                };
            } else {
                messageData = {
                    messaging_product: 'whatsapp',
                    to: formattedPhoneNumber,
                    type: MESSAGE_TYPES.DOCUMENT,
                    document: {
                        id: mediaId,
                        filename: fileName || 'document',
                        caption: caption
                    }
                };
            }

            // Send the message with the uploaded media
            const response = await withRetry(
                async () => {
                    return this.httpClient.post(
                        `/${this.phoneNumberId}/${WHATSAPP_API_ENDPOINTS.MESSAGES}`,
                        messageData
                    );
                },
                RETRY_CONFIG.MAX_RETRIES,
                RETRY_CONFIG.BASE_DELAY
            );

            const responseData = response.data as WhatsAppResponse;

            if (responseData.messages && responseData.messages.length > 0) {
                const messageId = responseData.messages[0].id;
                log.info(`WhatsApp file message sent successfully to ${formattedPhoneNumber}, message ID: ${messageId}`);
                return {
                    success: true,
                    messageId
                };
            }

            log.warn(`WhatsApp file message to ${formattedPhoneNumber} failed: No message ID in response`);
            return {
                success: false,
                error: 'No message ID in response'
            };

        } catch (error) {
            const whatsappError = defaultWhatsAppErrorHandler.processError(error, { phoneNumber });
            log.error(`Failed to send WhatsApp file message to ${phoneNumber}:`, whatsappError);
            return {
                success: false,
                error: whatsappError.message || 'Unknown error occurred'
            };
        }
    }
}

// Export singleton instance
export default new WhatsAppCloudService();