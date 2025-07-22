#!/usr/bin/env node

/**
 * Validation script for WhatsApp Cloud API setup
 * This script validates that all required components are properly configured
 */

import { validateWhatsAppConfig, getSanitizedWhatsAppConfig } from './whatsapp-config-validator';
import { initializeWhatsAppConfig } from './whatsapp-config-initializer';
import config from '../config';
import logger from './logger';

const log = logger.getLogger('WhatsAppSetupValidator');

/**
 * Validates the complete WhatsApp Cloud API setup
 */
export const validateWhatsAppSetup = (): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    summary: any;
} => {
    log.info('Starting WhatsApp Cloud API setup validation...');

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
        // 1. Check if required dependencies are available
        log.info('Checking dependencies...');
        
        try {
            require('axios');
            log.info('✓ axios dependency available');
        } catch (error) {
            errors.push('axios dependency not found');
        }

        try {
            require('crypto');
            log.info('✓ crypto (Node.js built-in) available');
        } catch (error) {
            errors.push('crypto module not available');
        }

        // 2. Check configuration
        log.info('Validating configuration...');
        const configValidation = validateWhatsAppConfig();
        
        if (!configValidation.isValid) {
            errors.push(...configValidation.errors);
        }
        
        warnings.push(...configValidation.warnings);

        // 3. Check environment variables
        log.info('Checking environment variables...');
        const requiredEnvVars = [
            'WHATSAPP_ACCESS_TOKEN',
            'WHATSAPP_PHONE_NUMBER_ID',
            'WHATSAPP_BUSINESS_ACCOUNT_ID',
            'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
        ];

        if (config.whatsapp.enableCloudApi) {
            for (const envVar of requiredEnvVars) {
                if (!process.env[envVar]) {
                    errors.push(`Missing required environment variable: ${envVar}`);
                } else {
                    log.info(`✓ ${envVar} is set`);
                }
            }
        } else {
            warnings.push('WhatsApp Cloud API is disabled (WHATSAPP_ENABLE_CLOUD_API=false)');
        }

        // 4. Check types and constants
        log.info('Checking types and constants...');
        try {
            const { WHATSAPP_ERROR_CODES, RETRY_CONFIG } = require('../constants/whatsapp-cloud-api.constants');
            const { WhatsAppCloudConfig } = require('../types/whatsapp-cloud-api.types');
            log.info('✓ WhatsApp Cloud API types and constants available');
        } catch (error) {
            errors.push('WhatsApp Cloud API types or constants not available');
        }

        // 5. Check utilities
        log.info('Checking utilities...');
        try {
            const { createWhatsAppHttpClient } = require('./http-client');
            const { WhatsAppErrorHandler } = require('./whatsapp-error-handler');
            log.info('✓ WhatsApp Cloud API utilities available');
        } catch (error) {
            errors.push('WhatsApp Cloud API utilities not available');
        }

        // 6. Generate summary
        const sanitizedConfig = getSanitizedWhatsAppConfig();
        const summary = {
            cloudApiEnabled: config.whatsapp.enableCloudApi,
            configuration: sanitizedConfig,
            dependenciesOk: errors.filter(e => e.includes('dependency')).length === 0,
            configurationValid: configValidation.isValid,
            environmentVariablesSet: config.whatsapp.enableCloudApi ? 
                requiredEnvVars.every(env => process.env[env]) : true
        };

        const isValid = errors.length === 0;

        log.info(`Validation completed. Valid: ${isValid}, Errors: ${errors.length}, Warnings: ${warnings.length}`);

        return {
            isValid,
            errors,
            warnings,
            summary
        };

    } catch (error) {
        const errorMessage = `Validation failed with error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(errorMessage);
        errors.push(errorMessage);

        return {
            isValid: false,
            errors,
            warnings,
            summary: { error: errorMessage }
        };
    }
};

/**
 * Run validation if this script is executed directly
 */
if (require.main === module) {
    const result = validateWhatsAppSetup();
    
    console.log('\n=== WhatsApp Cloud API Setup Validation ===\n');
    
    if (result.isValid) {
        console.log('✅ Setup validation PASSED');
    } else {
        console.log('❌ Setup validation FAILED');
    }
    
    if (result.errors.length > 0) {
        console.log('\n🚨 Errors:');
        result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
    }
    
    console.log('\n📊 Summary:');
    console.log(JSON.stringify(result.summary, null, 2));
    
    process.exit(result.isValid ? 0 : 1);
}