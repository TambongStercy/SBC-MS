/**
 * WhatsApp Cloud API Constants
 * Contains all constants used throughout the WhatsApp Cloud API implementation
 */

// API Endpoints
export const WHATSAPP_API_ENDPOINTS = {
    MESSAGES: 'messages',
    MEDIA: 'media',
    PHONE_NUMBERS: 'phone_numbers',
    BUSINESS_PROFILES: 'whatsapp_business_profiles',
    MESSAGE_TEMPLATES: 'message_templates'
} as const;

// Message Types
export const MESSAGE_TYPES = {
    TEXT: 'text',
    TEMPLATE: 'template',
    IMAGE: 'image',
    DOCUMENT: 'document',
    AUDIO: 'audio',
    VIDEO: 'video'
} as const;

// Message Status
export const MESSAGE_STATUS = {
    ACCEPTED: 'accepted',
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed'
} as const;

// Template Categories
export const TEMPLATE_CATEGORIES = {
    AUTHENTICATION: 'AUTHENTICATION',
    MARKETING: 'MARKETING',
    UTILITY: 'UTILITY'
} as const;

// Template Status
export const TEMPLATE_STATUS = {
    APPROVED: 'APPROVED',
    PENDING: 'PENDING',
    REJECTED: 'REJECTED'
} as const;

// Error Codes
export const WHATSAPP_ERROR_CODES = {
    // Authentication errors
    INVALID_ACCESS_TOKEN: 190,
    ACCESS_TOKEN_EXPIRED: 463,
    
    // Rate limiting
    RATE_LIMIT_HIT: 4,
    TOO_MANY_REQUESTS: 80007,
    
    // Message errors
    INVALID_PHONE_NUMBER: 131026,
    PHONE_NUMBER_NOT_WHATSAPP: 131051,
    MESSAGE_UNDELIVERABLE: 131047,
    TEMPLATE_NOT_FOUND: 132000,
    TEMPLATE_PAUSED: 132001,
    TEMPLATE_DISABLED: 132005,
    
    // Media errors
    MEDIA_DOWNLOAD_ERROR: 130429,
    MEDIA_UPLOAD_ERROR: 130472,
    UNSUPPORTED_MEDIA_TYPE: 130473,
    
    // Business errors
    BUSINESS_NOT_VERIFIED: 131009,
    PHONE_NUMBER_NOT_REGISTERED: 131031,
    
    // Generic errors
    INTERNAL_ERROR: 1,
    TEMPORARY_BLOCKING: 368,
    SPAM_RATE_LIMIT: 131008
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    BASE_DELAY: 1000, // 1 second
    MAX_DELAY: 30000, // 30 seconds
    BACKOFF_FACTOR: 2,
    
    // Retryable error codes
    RETRYABLE_ERRORS: [
        WHATSAPP_ERROR_CODES.RATE_LIMIT_HIT,
        WHATSAPP_ERROR_CODES.TOO_MANY_REQUESTS,
        WHATSAPP_ERROR_CODES.INTERNAL_ERROR,
        WHATSAPP_ERROR_CODES.TEMPORARY_BLOCKING
    ]
} as const;

// Rate Limiting
export const RATE_LIMITS = {
    MESSAGES_PER_SECOND: 1000,
    MESSAGES_PER_MINUTE: 60000,
    MESSAGES_PER_HOUR: 3600000,
    
    // Webhook processing
    WEBHOOK_PROCESSING_TIMEOUT: 20000, // 20 seconds
    WEBHOOK_RETRY_DELAY: 5000 // 5 seconds
} as const;

// Media Configuration
export const MEDIA_CONFIG = {
    MAX_FILE_SIZE: {
        IMAGE: 5 * 1024 * 1024, // 5MB
        DOCUMENT: 100 * 1024 * 1024, // 100MB
        AUDIO: 16 * 1024 * 1024, // 16MB
        VIDEO: 16 * 1024 * 1024 // 16MB
    },
    SUPPORTED_TYPES: {
        IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
        DOCUMENT: ['application/pdf', 'application/vnd.ms-powerpoint', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'],
        AUDIO: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
        VIDEO: ['video/mp4', 'video/3gp']
    }
} as const;

// Webhook Configuration
export const WEBHOOK_CONFIG = {
    VERIFY_TOKEN_MIN_LENGTH: 32,
    SIGNATURE_HEADER: 'x-hub-signature-256',
    CHALLENGE_PARAM: 'hub.challenge',
    VERIFY_TOKEN_PARAM: 'hub.verify_token',
    MODE_PARAM: 'hub.mode',
    SUBSCRIBE_MODE: 'subscribe'
} as const;

// Phone Number Validation
export const PHONE_VALIDATION = {
    MIN_LENGTH: 10,
    MAX_LENGTH: 15,
    COUNTRY_CODE_REGEX: /^\+?[1-9]\d{1,14}$/
} as const;

// Template Parameter Limits
export const TEMPLATE_LIMITS = {
    MAX_COMPONENTS: 10,
    MAX_PARAMETERS_PER_COMPONENT: 10,
    MAX_HEADER_PARAMETERS: 1,
    MAX_BODY_PARAMETERS: 10,
    MAX_BUTTON_PARAMETERS: 1
} as const;

// Health Check Configuration
export const HEALTH_CHECK = {
    TIMEOUT: 10000, // 10 seconds
    RETRY_INTERVAL: 30000, // 30 seconds
    MAX_CONSECUTIVE_FAILURES: 5
} as const;

// Logging Configuration
export const LOGGING = {
    MAX_MESSAGE_LENGTH_IN_LOGS: 100,
    SENSITIVE_FIELDS: ['access_token', 'webhook_verify_token'],
    LOG_LEVELS: {
        ERROR: 'error',
        WARN: 'warn',
        INFO: 'info',
        DEBUG: 'debug'
    }
} as const;

// Default Values
export const DEFAULTS = {
    API_VERSION: 'v18.0',
    API_BASE_URL: 'https://graph.facebook.com',
    MESSAGING_PRODUCT: 'whatsapp',
    LANGUAGE_CODE: 'en_US',
    PREVIEW_URL: false
} as const;

// Feature Flags
export const FEATURE_FLAGS = {
    ENABLE_CLOUD_API: 'WHATSAPP_ENABLE_CLOUD_API',
    ENABLE_WEBHOOK_VALIDATION: 'WHATSAPP_ENABLE_WEBHOOK_VALIDATION',
    ENABLE_RATE_LIMITING: 'WHATSAPP_ENABLE_RATE_LIMITING',
    ENABLE_RETRY_LOGIC: 'WHATSAPP_ENABLE_RETRY_LOGIC'
} as const;