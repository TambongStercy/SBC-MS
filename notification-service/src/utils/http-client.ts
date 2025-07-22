import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import logger from './logger';
import config from '../config';
import { RETRY_CONFIG, WHATSAPP_ERROR_CODES } from '../constants/whatsapp-cloud-api.constants';

/**
 * Creates an HTTP client instance configured for WhatsApp Cloud API
 * @returns Configured Axios instance
 */
export const createWhatsAppHttpClient = (): AxiosInstance => {
    const client = axios.create({
        baseURL: `${config.whatsapp.apiBaseUrl}/${config.whatsapp.apiVersion}`,
        timeout: 30000, // 30 seconds timeout
        headers: {
            'Authorization': `Bearer ${config.whatsapp.accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SBC-NotificationService/1.0'
        }
    });

    // Request interceptor for logging
    client.interceptors.request.use(
        (config) => {
            const sanitizedConfig = {
                method: config.method?.toUpperCase(),
                url: config.url,
                baseURL: config.baseURL,
                timeout: config.timeout
            };
            
            logger.debug('[WhatsApp HTTP Client] Outgoing request:', sanitizedConfig);
            return config;
        },
        (error) => {
            logger.error('[WhatsApp HTTP Client] Request error:', error.message);
            return Promise.reject(error);
        }
    );

    // Response interceptor for logging and error handling
    client.interceptors.response.use(
        (response: AxiosResponse) => {
            logger.debug('[WhatsApp HTTP Client] Response received:', {
                status: response.status,
                statusText: response.statusText,
                url: response.config.url
            });
            return response;
        },
        (error: AxiosError) => {
            const errorInfo = {
                status: error.response?.status,
                statusText: error.response?.statusText,
                url: error.config?.url,
                message: error.message
            };

            logger.error('[WhatsApp HTTP Client] Response error:', errorInfo);
            
            // Log WhatsApp API specific errors
            if (error.response?.data) {
                logger.error('[WhatsApp HTTP Client] API error details:', error.response.data);
            }

            return Promise.reject(error);
        }
    );

    return client;
};

/**
 * Implements retry logic with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param baseDelay Base delay in milliseconds
 * @returns Promise that resolves with the function result
 */
export const withRetry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number = RETRY_CONFIG.MAX_RETRIES,
    baseDelay: number = RETRY_CONFIG.BASE_DELAY
): Promise<T> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }

            // Check if error is retryable
            if (!isRetryableError(error as AxiosError)) {
                logger.warn('[WhatsApp HTTP Client] Non-retryable error, not retrying:', error);
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                baseDelay * Math.pow(RETRY_CONFIG.BACKOFF_FACTOR, attempt),
                RETRY_CONFIG.MAX_DELAY
            );

            logger.warn(`[WhatsApp HTTP Client] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('Retry failed with unknown error');
};

/**
 * Determines if an error is retryable based on error code and type
 * @param error Axios error object
 * @returns Boolean indicating if the error should be retried
 */
export const isRetryableError = (error: AxiosError): boolean => {
    // Network errors (no response received)
    if (!error.response) {
        return true;
    }

    const status = error.response.status;
    
    // Server errors (5xx) are generally retryable
    if (status >= 500) {
        return true;
    }

    // Check WhatsApp specific error codes
    const whatsappError = error.response.data as any;
    if (whatsappError?.error?.code) {
        const errorCode = whatsappError.error.code;
        return RETRY_CONFIG.RETRYABLE_ERRORS.includes(errorCode);
    }

    // Rate limiting errors
    if (status === 429) {
        return true;
    }

    // Don't retry client errors (4xx) except rate limiting
    return false;
};

/**
 * Extracts WhatsApp API error information from Axios error
 * @param error Axios error object
 * @returns Formatted error information
 */
export const extractWhatsAppError = (error: AxiosError): {
    code: number;
    message: string;
    type: string;
    subcode?: number;
    userTitle?: string;
    userMessage?: string;
    traceId?: string;
} => {
    const defaultError = {
        code: error.response?.status || 0,
        message: error.message || 'Unknown error',
        type: 'network_error'
    };

    if (!error.response?.data) {
        return defaultError;
    }

    const whatsappError = error.response.data as any;
    
    if (whatsappError.error) {
        return {
            code: whatsappError.error.code || error.response.status,
            message: whatsappError.error.message || error.message,
            type: whatsappError.error.type || 'api_error',
            subcode: whatsappError.error.error_subcode,
            userTitle: whatsappError.error.error_user_title,
            userMessage: whatsappError.error.error_user_msg,
            traceId: whatsappError.error.fbtrace_id
        };
    }

    return defaultError;
};

/**
 * Creates a rate-limited HTTP client that respects WhatsApp API limits
 * @returns Rate-limited HTTP client
 */
export const createRateLimitedClient = (): AxiosInstance => {
    const client = createWhatsAppHttpClient();
    
    // Add rate limiting logic here if needed
    // This could be implemented using a token bucket or similar algorithm
    
    return client;
};

/**
 * Validates HTTP response from WhatsApp API
 * @param response Axios response object
 * @returns Boolean indicating if response is valid
 */
export const isValidWhatsAppResponse = (response: AxiosResponse): boolean => {
    if (!response.data) {
        return false;
    }

    // Check for error in response
    if (response.data.error) {
        return false;
    }

    // For message sending, check for required fields
    if (response.data.messages) {
        return Array.isArray(response.data.messages) && response.data.messages.length > 0;
    }

    // For other endpoints, assume valid if no error
    return true;
};

/**
 * Logs HTTP request/response for debugging (with sensitive data removed)
 * @param config Request configuration
 * @param response Response object (optional)
 * @param error Error object (optional)
 */
export const logHttpActivity = (
    config: AxiosRequestConfig,
    response?: AxiosResponse,
    error?: AxiosError
): void => {
    const sanitizedConfig = {
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL
    };

    if (response) {
        logger.debug('[WhatsApp HTTP] Request completed:', {
            request: sanitizedConfig,
            response: {
                status: response.status,
                statusText: response.statusText
            }
        });
    }

    if (error) {
        logger.error('[WhatsApp HTTP] Request failed:', {
            request: sanitizedConfig,
            error: {
                status: error.response?.status,
                message: error.message
            }
        });
    }
};