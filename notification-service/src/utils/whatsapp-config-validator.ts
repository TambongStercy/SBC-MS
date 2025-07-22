import { ConfigValidationResult } from '../types/whatsapp-cloud-api.types';
import config from '../config';
import logger from './logger';

/**
 * Validates WhatsApp Cloud API configuration
 * @returns ConfigValidationResult with validation status and any errors/warnings
 */
export const validateWhatsAppConfig = (): ConfigValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if Cloud API is enabled
    if (!config.whatsapp.enableCloudApi) {
        warnings.push('WhatsApp Cloud API is disabled. Using Bailey implementation.');
        return {
            isValid: true,
            errors,
            warnings
        };
    }

    // Required fields validation
    const requiredFields = [
        { key: 'accessToken', value: config.whatsapp.accessToken, name: 'WHATSAPP_ACCESS_TOKEN' },
        { key: 'phoneNumberId', value: config.whatsapp.phoneNumberId, name: 'WHATSAPP_PHONE_NUMBER_ID' },
        { key: 'businessAccountId', value: config.whatsapp.businessAccountId, name: 'WHATSAPP_BUSINESS_ACCOUNT_ID' },
        { key: 'webhookVerifyToken', value: config.whatsapp.webhookVerifyToken, name: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' }
    ];

    // Check for missing required fields
    for (const field of requiredFields) {
        if (!field.value || field.value.trim() === '') {
            errors.push(`Missing required WhatsApp Cloud API configuration: ${field.name}`);
        }
    }

    // Validate access token format (should start with EAA and be at least 100 characters)
    if (config.whatsapp.accessToken) {
        if (!config.whatsapp.accessToken.startsWith('EAA')) {
            warnings.push('WhatsApp access token does not follow expected format (should start with EAA)');
        }
        if (config.whatsapp.accessToken.length < 100) {
            warnings.push('WhatsApp access token appears to be too short (should be at least 100 characters)');
        }
    }

    // Validate phone number ID format (should be numeric)
    if (config.whatsapp.phoneNumberId) {
        if (!/^\d+$/.test(config.whatsapp.phoneNumberId)) {
            errors.push('WhatsApp phone number ID should contain only digits');
        }
    }

    // Validate business account ID format (should be numeric)
    if (config.whatsapp.businessAccountId) {
        if (!/^\d+$/.test(config.whatsapp.businessAccountId)) {
            errors.push('WhatsApp business account ID should contain only digits');
        }
    }

    // Validate API version format
    if (config.whatsapp.apiVersion) {
        if (!/^v\d+\.\d+$/.test(config.whatsapp.apiVersion)) {
            warnings.push('WhatsApp API version should follow format vX.Y (e.g., v18.0)');
        }
    }

    // Validate API base URL
    if (config.whatsapp.apiBaseUrl) {
        try {
            new URL(config.whatsapp.apiBaseUrl);
        } catch {
            errors.push('WhatsApp API base URL is not a valid URL');
        }
    }

    // Validate webhook verify token (should be at least 32 characters for security)
    if (config.whatsapp.webhookVerifyToken) {
        if (config.whatsapp.webhookVerifyToken.length < 32) {
            warnings.push('WhatsApp webhook verify token should be at least 32 characters for security');
        }
    }

    const isValid = errors.length === 0;

    // Log validation results
    if (!isValid) {
        logger.error('WhatsApp Cloud API configuration validation failed:', { errors });
    }
    
    if (warnings.length > 0) {
        logger.warn('WhatsApp Cloud API configuration warnings:', { warnings });
    }

    if (isValid && errors.length === 0 && warnings.length === 0) {
        logger.info('WhatsApp Cloud API configuration validation passed');
    }

    return {
        isValid,
        errors,
        warnings
    };
};

/**
 * Validates individual configuration values
 * @param key Configuration key
 * @param value Configuration value
 * @returns Validation error message or null if valid
 */
export const validateConfigValue = (key: string, value: string): string | null => {
    switch (key) {
        case 'accessToken':
            if (!value) return 'Access token is required';
            if (!value.startsWith('EAA')) return 'Access token should start with EAA';
            if (value.length < 100) return 'Access token appears to be too short';
            return null;

        case 'phoneNumberId':
            if (!value) return 'Phone number ID is required';
            if (!/^\d+$/.test(value)) return 'Phone number ID should contain only digits';
            return null;

        case 'businessAccountId':
            if (!value) return 'Business account ID is required';
            if (!/^\d+$/.test(value)) return 'Business account ID should contain only digits';
            return null;

        case 'webhookVerifyToken':
            if (!value) return 'Webhook verify token is required';
            if (value.length < 32) return 'Webhook verify token should be at least 32 characters';
            return null;

        case 'apiVersion':
            if (!value) return 'API version is required';
            if (!/^v\d+\.\d+$/.test(value)) return 'API version should follow format vX.Y';
            return null;

        case 'apiBaseUrl':
            if (!value) return 'API base URL is required';
            try {
                new URL(value);
                return null;
            } catch {
                return 'API base URL is not a valid URL';
            }

        default:
            return null;
    }
};

/**
 * Checks if WhatsApp Cloud API is properly configured and enabled
 * @returns boolean indicating if Cloud API can be used
 */
export const isWhatsAppCloudApiReady = (): boolean => {
    if (!config.whatsapp.enableCloudApi) {
        return false;
    }

    const validation = validateWhatsAppConfig();
    return validation.isValid;
};

/**
 * Gets a sanitized version of the configuration for logging (removes sensitive data)
 * @returns Sanitized configuration object
 */
export const getSanitizedWhatsAppConfig = () => {
    return {
        phoneNumberId: config.whatsapp.phoneNumberId,
        businessAccountId: config.whatsapp.businessAccountId,
        apiVersion: config.whatsapp.apiVersion,
        apiBaseUrl: config.whatsapp.apiBaseUrl,
        enableCloudApi: config.whatsapp.enableCloudApi,
        accessToken: config.whatsapp.accessToken ? `${config.whatsapp.accessToken.substring(0, 10)}...` : 'Not set',
        webhookVerifyToken: config.whatsapp.webhookVerifyToken ? 'Set' : 'Not set'
    };
};