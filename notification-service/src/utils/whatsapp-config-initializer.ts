import { validateWhatsAppConfig, getSanitizedWhatsAppConfig } from './whatsapp-config-validator';
import logger from './logger';
import config from '../config';

/**
 * Initializes and validates WhatsApp Cloud API configuration on startup
 * This function should be called during application initialization
 */
export const initializeWhatsAppConfig = (): void => {
    logger.info('Initializing WhatsApp configuration...');

    // Log sanitized configuration for debugging
    const sanitizedConfig = getSanitizedWhatsAppConfig();
    logger.info('WhatsApp configuration loaded:', sanitizedConfig);

    // Validate configuration
    const validation = validateWhatsAppConfig();

    if (!config.whatsapp.enableCloudApi) {
        logger.info('WhatsApp Cloud API is disabled. Will use Bailey implementation.');
        return;
    }

    if (!validation.isValid) {
        logger.error('WhatsApp Cloud API configuration validation failed:', {
            errors: validation.errors
        });
        
        // In production, exit if configuration is invalid
        if (config.nodeEnv === 'production') {
            logger.error('Exiting due to invalid WhatsApp Cloud API configuration in production');
            process.exit(1);
        } else {
            logger.warn('WhatsApp Cloud API will be disabled due to invalid configuration');
        }
    } else {
        logger.info('WhatsApp Cloud API configuration validated successfully');
        
        if (validation.warnings.length > 0) {
            logger.warn('WhatsApp Cloud API configuration warnings:', {
                warnings: validation.warnings
            });
        }
    }
};

/**
 * Checks if the current configuration allows WhatsApp Cloud API usage
 * @returns boolean indicating if Cloud API can be used
 */
export const canUseWhatsAppCloudApi = (): boolean => {
    if (!config.whatsapp.enableCloudApi) {
        return false;
    }

    const validation = validateWhatsAppConfig();
    return validation.isValid;
};

/**
 * Gets configuration errors for debugging purposes
 * @returns Array of configuration error messages
 */
export const getConfigurationErrors = (): string[] => {
    const validation = validateWhatsAppConfig();
    return validation.errors;
};

/**
 * Gets configuration warnings for debugging purposes
 * @returns Array of configuration warning messages
 */
export const getConfigurationWarnings = (): string[] => {
    const validation = validateWhatsAppConfig();
    return validation.warnings;
};

/**
 * Validates a specific configuration value
 * Used for runtime configuration updates
 * @param key Configuration key to validate
 * @param value New value to validate
 * @returns Validation result with error message if invalid
 */
export const validateConfigurationValue = (key: string, value: string): { isValid: boolean; error?: string } => {
    // Import the validator function
    const { validateConfigValue } = require('./whatsapp-config-validator');
    
    const error = validateConfigValue(key, value);
    return {
        isValid: error === null,
        error: error || undefined
    };
};

/**
 * Logs current WhatsApp configuration status
 * Useful for health checks and debugging
 */
export const logWhatsAppConfigStatus = (): void => {
    const sanitizedConfig = getSanitizedWhatsAppConfig();
    const validation = validateWhatsAppConfig();
    
    logger.info('WhatsApp Configuration Status:', {
        config: sanitizedConfig,
        isValid: validation.isValid,
        canUseCloudApi: canUseWhatsAppCloudApi(),
        errors: validation.errors,
        warnings: validation.warnings
    });
};