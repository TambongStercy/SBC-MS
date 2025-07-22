import { AxiosError } from 'axios';
import { WhatsAppError, WhatsAppErrorDetails, RetryConfig } from '../types/whatsapp-cloud-api.types';
import { WHATSAPP_ERROR_CODES, RETRY_CONFIG } from '../constants/whatsapp-cloud-api.constants';
import logger from './logger';

const log = logger.getLogger('WhatsAppErrorHandler');

/**
 * Custom error class for WhatsApp Cloud API errors
 */
export class WhatsAppApiError extends Error {
    public readonly code: number;
    public readonly type: string;
    public readonly subcode?: number;
    public readonly userTitle?: string;
    public readonly userMessage?: string;
    public readonly traceId?: string;
    public readonly isRetryable: boolean;

    constructor(error: WhatsAppError['error']) {
        super(error.message);
        this.name = 'WhatsAppApiError';
        this.code = error.code;
        this.type = error.type;
        this.subcode = error.error_subcode;
        this.userTitle = error.error_user_title;
        this.userMessage = error.error_user_msg;
        this.traceId = error.fbtrace_id;
        this.isRetryable = this.determineRetryability(error.code);
    }

    private determineRetryability(code: number): boolean {
        return RETRY_CONFIG.RETRYABLE_ERRORS.includes(code as any);
    }

    /**
     * Get user-friendly error message
     */
    getUserFriendlyMessage(): string {
        if (this.userMessage) {
            return this.userMessage;
        }

        switch (this.code) {
            case WHATSAPP_ERROR_CODES.INVALID_PHONE_NUMBER:
                return 'The phone number provided is not valid.';
            case WHATSAPP_ERROR_CODES.PHONE_NUMBER_NOT_WHATSAPP:
                return 'This phone number is not registered with WhatsApp.';
            case WHATSAPP_ERROR_CODES.MESSAGE_UNDELIVERABLE:
                return 'Message could not be delivered to this number.';
            case WHATSAPP_ERROR_CODES.RATE_LIMIT_HIT:
                return 'Too many messages sent. Please try again later.';
            case WHATSAPP_ERROR_CODES.TEMPLATE_NOT_FOUND:
                return 'Message template not found or not approved.';
            case WHATSAPP_ERROR_CODES.INVALID_ACCESS_TOKEN:
                return 'WhatsApp API authentication failed.';
            case WHATSAPP_ERROR_CODES.BUSINESS_NOT_VERIFIED:
                return 'WhatsApp Business account is not verified.';
            default:
                return this.message || 'An error occurred while sending the WhatsApp message.';
        }
    }

    /**
     * Get error category for monitoring and alerting
     */
    getErrorCategory(): 'authentication' | 'rate_limit' | 'validation' | 'business' | 'temporary' | 'unknown' {
        switch (this.code) {
            case WHATSAPP_ERROR_CODES.INVALID_ACCESS_TOKEN:
            case WHATSAPP_ERROR_CODES.ACCESS_TOKEN_EXPIRED:
                return 'authentication';
            
            case WHATSAPP_ERROR_CODES.RATE_LIMIT_HIT:
            case WHATSAPP_ERROR_CODES.TOO_MANY_REQUESTS:
            case WHATSAPP_ERROR_CODES.SPAM_RATE_LIMIT:
                return 'rate_limit';
            
            case WHATSAPP_ERROR_CODES.INVALID_PHONE_NUMBER:
            case WHATSAPP_ERROR_CODES.PHONE_NUMBER_NOT_WHATSAPP:
            case WHATSAPP_ERROR_CODES.MESSAGE_UNDELIVERABLE:
                return 'validation';
            
            case WHATSAPP_ERROR_CODES.BUSINESS_NOT_VERIFIED:
            case WHATSAPP_ERROR_CODES.PHONE_NUMBER_NOT_REGISTERED:
                return 'business';
            
            case WHATSAPP_ERROR_CODES.INTERNAL_ERROR:
            case WHATSAPP_ERROR_CODES.TEMPORARY_BLOCKING:
                return 'temporary';
            
            default:
                return 'unknown';
        }
    }
}

/**
 * Handles and processes WhatsApp Cloud API errors
 */
export class WhatsAppErrorHandler {
    private retryConfig: RetryConfig;

    constructor(retryConfig?: Partial<RetryConfig>) {
        this.retryConfig = {
            maxRetries: RETRY_CONFIG.MAX_RETRIES,
            baseDelay: RETRY_CONFIG.BASE_DELAY,
            maxDelay: RETRY_CONFIG.MAX_DELAY,
            backoffFactor: RETRY_CONFIG.BACKOFF_FACTOR,
            ...retryConfig
        };
    }

    /**
     * Process an error from WhatsApp Cloud API
     */
    processError(error: unknown, context?: { phoneNumber?: string; messageId?: string }): WhatsAppApiError {
        let whatsappError: WhatsAppApiError;

        if (this.isAxiosError(error)) {
            whatsappError = this.handleAxiosError(error);
        } else if (this.isWhatsAppApiError(error)) {
            whatsappError = error;
        } else {
            // Generic error
            whatsappError = new WhatsAppApiError({
                message: error instanceof Error ? error.message : 'Unknown error occurred',
                type: 'UnknownError',
                code: WHATSAPP_ERROR_CODES.INTERNAL_ERROR,
                fbtrace_id: 'unknown'
            });
        }

        // Log the error with context
        this.logError(whatsappError, context);

        return whatsappError;
    }

    /**
     * Handle Axios HTTP errors
     */
    private handleAxiosError(error: AxiosError): WhatsAppApiError {
        if (error.response?.data && this.isWhatsAppErrorResponse(error.response.data)) {
            return new WhatsAppApiError(error.response.data.error);
        }

        // Handle HTTP status codes
        const statusCode = error.response?.status || 0;
        let whatsappErrorCode: number = WHATSAPP_ERROR_CODES.INTERNAL_ERROR;
        let message = error.message;

        switch (statusCode) {
            case 401:
                whatsappErrorCode = WHATSAPP_ERROR_CODES.INVALID_ACCESS_TOKEN;
                message = 'Invalid or expired access token';
                break;
            case 429:
                whatsappErrorCode = WHATSAPP_ERROR_CODES.RATE_LIMIT_HIT;
                message = 'Rate limit exceeded';
                break;
            case 400:
                message = 'Bad request - invalid parameters';
                break;
            case 404:
                message = 'API endpoint not found';
                break;
            case 500:
            case 502:
            case 503:
            case 504:
                message = 'WhatsApp API server error';
                break;
        }

        return new WhatsAppApiError({
            message,
            type: 'HttpError',
            code: whatsappErrorCode,
            fbtrace_id: error.response?.headers?.['x-fb-trace-id'] || 'unknown'
        });
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(attempt: number): number {
        const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffFactor, attempt - 1),
            this.retryConfig.maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.1 * delay;
        return Math.floor(delay + jitter);
    }

    /**
     * Determine if an error should be retried
     */
    shouldRetry(error: WhatsAppApiError, attempt: number): boolean {
        if (attempt >= this.retryConfig.maxRetries) {
            return false;
        }

        return error.isRetryable;
    }

    /**
     * Get retry information for an error
     */
    getRetryInfo(error: WhatsAppApiError, attempt: number): { shouldRetry: boolean; delay: number } {
        const shouldRetry = this.shouldRetry(error, attempt);
        const delay = shouldRetry ? this.calculateRetryDelay(attempt) : 0;

        return { shouldRetry, delay };
    }

    /**
     * Log error with appropriate level and context
     */
    private logError(error: WhatsAppApiError, context?: { phoneNumber?: string; messageId?: string }): void {
        const errorInfo = {
            code: error.code,
            type: error.type,
            message: error.message,
            category: error.getErrorCategory(),
            isRetryable: error.isRetryable,
            traceId: error.traceId,
            context
        };

        switch (error.getErrorCategory()) {
            case 'authentication':
                log.error('WhatsApp authentication error', errorInfo);
                break;
            case 'rate_limit':
                log.warn('WhatsApp rate limit error', errorInfo);
                break;
            case 'validation':
                log.warn('WhatsApp validation error', errorInfo);
                break;
            case 'business':
                log.error('WhatsApp business configuration error', errorInfo);
                break;
            case 'temporary':
                log.warn('WhatsApp temporary error', errorInfo);
                break;
            default:
                log.error('WhatsApp unknown error', errorInfo);
        }
    }

    /**
     * Type guards
     */
    private isAxiosError(error: unknown): error is AxiosError {
        return error instanceof Error && 'isAxiosError' in error && error.isAxiosError === true;
    }

    private isWhatsAppApiError(error: unknown): error is WhatsAppApiError {
        return error instanceof WhatsAppApiError;
    }

    private isWhatsAppErrorResponse(data: any): data is WhatsAppError {
        return data && typeof data === 'object' && data.error && typeof data.error.code === 'number';
    }
}

/**
 * Default error handler instance
 */
export const defaultWhatsAppErrorHandler = new WhatsAppErrorHandler();

/**
 * Utility function to create user-friendly error messages
 */
export const createUserFriendlyErrorMessage = (error: unknown): string => {
    const processedError = defaultWhatsAppErrorHandler.processError(error);
    return processedError.getUserFriendlyMessage();
};

/**
 * Utility function to check if an error is retryable
 */
export const isRetryableError = (error: unknown): boolean => {
    const processedError = defaultWhatsAppErrorHandler.processError(error);
    return processedError.isRetryable;
};

/**
 * Utility function to get error category
 */
export const getErrorCategory = (error: unknown): string => {
    const processedError = defaultWhatsAppErrorHandler.processError(error);
    return processedError.getErrorCategory();
};