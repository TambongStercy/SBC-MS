import { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import logger from '../utils/logger';
import config from '../config';
import {
    createWhatsAppHttpClient,
    withRetry,
    isRetryableError,
    extractWhatsAppError
} from '../utils/http-client';
import {
    WhatsAppCloudConfig,
    WhatsAppMessage,
    WhatsAppResponse,
    WhatsAppError,
    WhatsAppHealthStatus,
    MediaUploadResponse,
    MediaUploadRequest,
    PhoneNumberInfo,
    RateLimitInfo,
    RetryConfig
} from '../types/whatsapp-cloud-api.types';
import {
    WHATSAPP_API_ENDPOINTS,
    MESSAGE_TYPES,
    RETRY_CONFIG,
    RATE_LIMITS,
    MEDIA_CONFIG,
    PHONE_VALIDATION,
    DEFAULTS
} from '../constants/whatsapp-cloud-api.constants';

const log = logger.getLogger('WhatsAppCloudAPIClient');

/**
 * WhatsApp Cloud API Client
 * Handles all communication with the WhatsApp Business Cloud API
 */
export class WhatsAppCloudAPIClient {
    private httpClient: AxiosInstance;
    private config: WhatsAppCloudConfig;
    private rateLimitInfo: RateLimitInfo | null = null;
    private lastHealthCheck: Date | null = null;
    private isHealthy: boolean = false;

    constructor(customConfig?: Partial<WhatsAppCloudConfig>) {
        // Initialize configuration
        this.config = {
            accessToken: config.whatsapp.accessToken,
            phoneNumberId: config.whatsapp.phoneNumberId,
            businessAccountId: config.whatsapp.businessAccountId,
            webhookVerifyToken: config.whatsapp.webhookVerifyToken,
            apiVersion: config.whatsapp.apiVersion || DEFAULTS.API_VERSION,
            apiBaseUrl: config.whatsapp.apiBaseUrl || DEFAULTS.API_BASE_URL,
            ...customConfig
        };

        // Validate configuration
        this.validateConfiguration();

        // Initialize HTTP client
        this.httpClient = createWhatsAppHttpClient();

        // Add response interceptor to track rate limiting
        this.httpClient.interceptors.response.use(
            (response) => {
                this.updateRateLimitInfo(response);
                return response;
            },
            (error) => {
                this.updateRateLimitInfo(error.response);
                return Promise.reject(error);
            }
        );

        log.info('WhatsApp Cloud API Client initialized', {
            phoneNumberId: this.config.phoneNumberId,
            apiVersion: this.config.apiVersion,
            baseUrl: this.config.apiBaseUrl
        });
    }

    /**
     * Validates the WhatsApp Cloud API configuration
     * @throws Error if configuration is invalid
     */
    private validateConfiguration(): void {
        const requiredFields: (keyof WhatsAppCloudConfig)[] = [
            'accessToken',
            'phoneNumberId',
            'businessAccountId',
            'webhookVerifyToken'
        ];

        const missingFields = requiredFields.filter(field => !this.config[field]);

        if (missingFields.length > 0) {
            throw new Error(`Missing required WhatsApp Cloud API configuration: ${missingFields.join(', ')}`);
        }

        // Validate phone number ID format
        if (!/^\d+$/.test(this.config.phoneNumberId)) {
            throw new Error('Invalid phone number ID format. Must be numeric.');
        }

        // Validate business account ID format
        if (!/^\d+$/.test(this.config.businessAccountId)) {
            throw new Error('Invalid business account ID format. Must be numeric.');
        }

        // Validate webhook verify token length
        if (this.config.webhookVerifyToken.length < 32) {
            log.warn('Webhook verify token should be at least 32 characters for security');
        }

        log.debug('WhatsApp Cloud API configuration validated successfully');
    }

    /**
     * Updates rate limit information from response headers
     * @param response Axios response object
     */
    private updateRateLimitInfo(response?: AxiosResponse): void {
        if (!response?.headers) return;

        const limit = response.headers['x-ratelimit-limit'];
        const remaining = response.headers['x-ratelimit-remaining'];
        const reset = response.headers['x-ratelimit-reset'];

        if (limit && remaining && reset) {
            this.rateLimitInfo = {
                limit: parseInt(limit, 10),
                remaining: parseInt(remaining, 10),
                resetTime: parseInt(reset, 10)
            };

            log.debug('Rate limit info updated', this.rateLimitInfo);
        }
    }

    /**
     * Validates phone number format
     * @param phoneNumber Phone number to validate
     * @returns Boolean indicating if phone number is valid
     */
    private validatePhoneNumber(phoneNumber: string): boolean {
        // Remove any non-digit characters except +
        const cleanNumber = phoneNumber.replace(/[^\d+]/g, '');

        // Check if it matches the expected format
        if (!PHONE_VALIDATION.COUNTRY_CODE_REGEX.test(cleanNumber)) {
            return false;
        }

        // Check length constraints
        const numberWithoutPlus = cleanNumber.replace('+', '');
        return numberWithoutPlus.length >= PHONE_VALIDATION.MIN_LENGTH &&
            numberWithoutPlus.length <= PHONE_VALIDATION.MAX_LENGTH;
    }

    /**
     * Formats phone number for WhatsApp API
     * @param phoneNumber Phone number to format
     * @returns Formatted phone number
     */
    private formatPhoneNumber(phoneNumber: string): string {
        // Remove any non-digit characters except +
        let formatted = phoneNumber.replace(/[^\d+]/g, '');

        // Add + if not present
        if (!formatted.startsWith('+')) {
            formatted = '+' + formatted;
        }

        return formatted;
    }

    /**
     * Makes an authenticated request to the WhatsApp API
     * @param endpoint API endpoint
     * @param method HTTP method
     * @param data Request data
     * @returns Promise resolving to API response
     */
    private async makeRequest<T = any>(
        endpoint: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
        data?: any
    ): Promise<T> {
        const url = `/${this.config.phoneNumberId}/${endpoint}`;

        log.debug(`Making ${method} request to ${url}`, {
            endpoint,
            method,
            hasData: !!data
        });

        try {
            const response = await withRetry(async () => {
                switch (method) {
                    case 'POST':
                        return await this.httpClient.post<T>(url, data);
                    case 'PUT':
                        return await this.httpClient.put<T>(url, data);
                    case 'DELETE':
                        return await this.httpClient.delete<T>(url);
                    default:
                        return await this.httpClient.get<T>(url);
                }
            });

            log.debug(`Request to ${url} completed successfully`, {
                status: response.status,
                statusText: response.statusText
            });

            return response.data;
        } catch (error) {
            const whatsappError = extractWhatsAppError(error as AxiosError);

            log.error(`Request to ${url} failed`, {
                error: whatsappError,
                endpoint,
                method
            });

            throw new Error(`WhatsApp API request failed: ${whatsappError.message} (Code: ${whatsappError.code})`);
        }
    }

    /**
     * Performs health check on the WhatsApp API
     * @returns Promise resolving to health status
     */
    public async healthCheck(): Promise<WhatsAppHealthStatus> {
        try {
            log.debug('Performing WhatsApp API health check');

            // Try to get phone number info as a health check
            const phoneInfo = await this.makeRequest<PhoneNumberInfo>('', 'GET');

            this.isHealthy = true;
            this.lastHealthCheck = new Date();

            const status: WhatsAppHealthStatus = {
                isConnected: true,
                phoneNumberId: this.config.phoneNumberId,
                businessAccountId: this.config.businessAccountId,
                lastChecked: this.lastHealthCheck
            };

            log.info('WhatsApp API health check passed', status);
            return status;

        } catch (error) {
            this.isHealthy = false;
            this.lastHealthCheck = new Date();

            const status: WhatsAppHealthStatus = {
                isConnected: false,
                phoneNumberId: this.config.phoneNumberId,
                businessAccountId: this.config.businessAccountId,
                lastChecked: this.lastHealthCheck,
                error: error instanceof Error ? error.message : 'Unknown error'
            };

            log.error('WhatsApp API health check failed', status);
            return status;
        }
    }

    /**
     * Gets current rate limit information
     * @returns Current rate limit info or null if not available
     */
    public getRateLimitInfo(): RateLimitInfo | null {
        return this.rateLimitInfo;
    }

    /**
     * Gets current configuration (with sensitive data masked)
     * @returns Masked configuration object
     */
    public getConfiguration(): Partial<WhatsAppCloudConfig> {
        return {
            phoneNumberId: this.config.phoneNumberId,
            businessAccountId: this.config.businessAccountId,
            apiVersion: this.config.apiVersion,
            apiBaseUrl: this.config.apiBaseUrl,
            accessToken: this.config.accessToken ? '***masked***' : '',
            webhookVerifyToken: this.config.webhookVerifyToken ? '***masked***' : ''
        };
    }

    /**
     * Checks if the client is ready to send messages
     * @returns Boolean indicating readiness
     */
    public isReady(): boolean {
        return this.isHealthy && !!this.config.accessToken && !!this.config.phoneNumberId;
    }

    /**
     * Gets connection status information
     * @returns Connection status object
     */
    public getConnectionStatus(): {
        isReady: boolean;
        isHealthy: boolean;
        lastHealthCheck: Date | null;
        rateLimitInfo: RateLimitInfo | null;
        configuration: Partial<WhatsAppCloudConfig>;
    } {
        return {
            isReady: this.isReady(),
            isHealthy: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck,
            rateLimitInfo: this.rateLimitInfo,
            configuration: this.getConfiguration()
        };
    }

    /**
     * Sends a text message via WhatsApp Cloud API
     * @param to Recipient phone number
     * @param text Message text
     * @param previewUrl Whether to show URL preview
     * @returns Promise resolving to message response
     */
    public async sendTextMessage(
        to: string,
        text: string,
        previewUrl: boolean = DEFAULTS.PREVIEW_URL
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!text || text.trim().length === 0) {
            throw new Error('Message text cannot be empty');
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp',
            to: formattedPhone,
            type: MESSAGE_TYPES.TEXT as 'text',
            text: {
                body: text.trim(),
                preview_url: previewUrl
            }
        };

        log.info('Sending text message via WhatsApp Cloud API', {
            to: formattedPhone,
            textLength: text.length,
            previewUrl
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Text message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id
            });

            return response;
        } catch (error) {
            log.error('Failed to send text message', {
                to: formattedPhone,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends multiple text messages with rate limiting
     * @param to Recipient phone number
     * @param messages Array of message texts
     * @param delayBetweenMessages Delay between messages in milliseconds
     * @returns Promise resolving to array of message responses
     */
    public async sendMultipleTextMessages(
        to: string,
        messages: string[],
        delayBetweenMessages: number = 1000
    ): Promise<WhatsAppResponse[]> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!messages || messages.length === 0) {
            throw new Error('Messages array cannot be empty');
        }

        const validMessages = messages.filter(msg => msg && msg.trim().length > 0);
        if (validMessages.length === 0) {
            throw new Error('No valid messages found');
        }

        log.info('Sending multiple text messages via WhatsApp Cloud API', {
            to,
            messageCount: validMessages.length,
            delayBetweenMessages
        });

        const responses: WhatsAppResponse[] = [];
        const formattedPhone = this.formatPhoneNumber(to);

        try {
            for (let i = 0; i < validMessages.length; i++) {
                const message = validMessages[i];

                log.debug(`Sending message ${i + 1}/${validMessages.length}`, {
                    to: formattedPhone,
                    messageIndex: i
                });

                const response = await this.sendTextMessage(formattedPhone, message);
                responses.push(response);

                // Add delay between messages (except for the last one)
                if (i < validMessages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
                }
            }

            log.info('All text messages sent successfully', {
                to: formattedPhone,
                totalSent: responses.length,
                messageIds: responses.map(r => r.messages?.[0]?.id).filter(Boolean)
            });

            return responses;
        } catch (error) {
            log.error('Failed to send multiple text messages', {
                to: formattedPhone,
                totalMessages: validMessages.length,
                sentCount: responses.length,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Uploads media to WhatsApp servers
     * @param file File buffer or path
     * @param type Media type (image, document, audio, video)
     * @returns Promise resolving to media upload response
     */
    public async uploadMedia(file: Buffer | string, type: string): Promise<MediaUploadResponse> {
        log.info('Uploading media to WhatsApp servers', {
            type,
            isBuffer: Buffer.isBuffer(file),
            size: Buffer.isBuffer(file) ? file.length : 'unknown'
        });

        const uploadRequest: MediaUploadRequest = {
            file,
            type,
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp'
        };

        try {
            const response = await this.makeRequest<MediaUploadResponse>(
                WHATSAPP_API_ENDPOINTS.MEDIA,
                'POST',
                uploadRequest
            );

            log.info('Media uploaded successfully', {
                mediaId: response.id,
                type
            });

            return response;
        } catch (error) {
            log.error('Failed to upload media', {
                type,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends an image message via WhatsApp Cloud API
     * @param to Recipient phone number
     * @param imageUrl Image URL or media ID
     * @param caption Optional caption
     * @returns Promise resolving to message response
     */
    public async sendImageMessage(
        to: string,
        imageUrl: string,
        caption?: string
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!imageUrl || imageUrl.trim().length === 0) {
            throw new Error('Image URL cannot be empty');
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp',
            to: formattedPhone,
            type: MESSAGE_TYPES.IMAGE as 'image',
            image: {
                link: imageUrl.trim(),
                caption: caption?.trim()
            }
        };

        log.info('Sending image message via WhatsApp Cloud API', {
            to: formattedPhone,
            imageUrl,
            hasCaption: !!caption
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Image message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id
            });

            return response;
        } catch (error) {
            log.error('Failed to send image message', {
                to: formattedPhone,
                imageUrl,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends a document message via WhatsApp Cloud API
     * @param to Recipient phone number
     * @param documentUrl Document URL or media ID
     * @param filename Document filename
     * @param caption Optional caption
     * @returns Promise resolving to message response
     */
    public async sendDocumentMessage(
        to: string,
        documentUrl: string,
        filename?: string,
        caption?: string
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!documentUrl || documentUrl.trim().length === 0) {
            throw new Error('Document URL cannot be empty');
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp',
            to: formattedPhone,
            type: MESSAGE_TYPES.DOCUMENT as 'document',
            document: {
                link: documentUrl.trim(),
                filename: filename?.trim(),
                caption: caption?.trim()
            }
        };

        log.info('Sending document message via WhatsApp Cloud API', {
            to: formattedPhone,
            documentUrl,
            filename,
            hasCaption: !!caption
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Document message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id
            });

            return response;
        } catch (error) {
            log.error('Failed to send document message', {
                to: formattedPhone,
                documentUrl,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends a video message via WhatsApp Cloud API
     * @param to Recipient phone number
     * @param videoUrl Video URL or media ID
     * @param caption Optional caption
     * @returns Promise resolving to message response
     */
    public async sendVideoMessage(
        to: string,
        videoUrl: string,
        caption?: string
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!videoUrl || videoUrl.trim().length === 0) {
            throw new Error('Video URL cannot be empty');
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp',
            to: formattedPhone,
            type: MESSAGE_TYPES.VIDEO as 'video',
            video: {
                link: videoUrl.trim(),
                caption: caption?.trim()
            }
        };

        log.info('Sending video message via WhatsApp Cloud API', {
            to: formattedPhone,
            videoUrl,
            hasCaption: !!caption
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Video message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id
            });

            return response;
        } catch (error) {
            log.error('Failed to send video message', {
                to: formattedPhone,
                videoUrl,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends an audio message via WhatsApp Cloud API
     * @param to Recipient phone number
     * @param audioUrl Audio URL or media ID
     * @returns Promise resolving to message response
     */
    public async sendAudioMessage(
        to: string,
        audioUrl: string
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        if (!audioUrl || audioUrl.trim().length === 0) {
            throw new Error('Audio URL cannot be empty');
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: DEFAULTS.MESSAGING_PRODUCT as 'whatsapp',
            to: formattedPhone,
            type: MESSAGE_TYPES.AUDIO as 'audio',
            audio: {
                link: audioUrl.trim()
            }
        };

        log.info('Sending audio message via WhatsApp Cloud API', {
            to: formattedPhone,
            audioUrl
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Audio message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id
            });

            return response;
        } catch (error) {
            log.error('Failed to send audio message', {
                to: formattedPhone,
                audioUrl,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Sends a template message via WhatsApp Cloud API.
     * @param to Recipient phone number
     * @param templateName The name of the template
     * @param languageCode The language of the template
     * @param components The components of the template (header, body, buttons)
     * @returns Promise resolving to message response
     */
    public async sendTemplateMessage(
        to: string,
        templateName: string,
        languageCode: string,
        components: any[] // We'll use any for now, but this should be typed
    ): Promise<WhatsAppResponse> {
        if (!this.validatePhoneNumber(to)) {
            throw new Error(`Invalid phone number format: ${to}`);
        }

        const formattedPhone = this.formatPhoneNumber(to);

        const message: WhatsAppMessage = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode,
                },
                components: components,
            },
        };

        log.info('Sending template message via WhatsApp Cloud API', {
            to: formattedPhone,
            templateName,
        });

        try {
            const response = await this.makeRequest<WhatsAppResponse>(
                WHATSAPP_API_ENDPOINTS.MESSAGES,
                'POST',
                message
            );

            log.info('Template message sent successfully', {
                to: formattedPhone,
                messageId: response.messages?.[0]?.id,
                waId: response.contacts?.[0]?.wa_id,
            });

            return response;
        } catch (error) {
            log.error('Failed to send template message', {
                to: formattedPhone,
                templateName,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }
}