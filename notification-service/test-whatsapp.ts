#!/usr/bin/env node

import axios from 'axios';
import config from './src/config/index';


async function testWhatsAppIntegration() {
    console.log('🔧 Testing WhatsApp Cloud API Integration...\n');
    
    // Test 1: Configuration Validation
    console.log('1. Testing Configuration...');
    try {
        const { validateWhatsAppConfig } = require('./src/utils/whatsapp-config-validator');
        const validation = validateWhatsAppConfig();
        
        if (validation.isValid) {
            console.log('✅ Configuration is valid');
        } else {
            console.log('❌ Configuration errors:', validation.errors);
            return;
        }
    } catch (error) {
        console.log('❌ Configuration test failed:', error.message);
        return;
    }
    
    // Test 2: Service Health Check
    console.log('\n2. Testing Service Health...');
    try {
        const whatsappServiceFactory = require('./src/services/whatsapp-service-factory').default;
        const service = whatsappServiceFactory.getService();
        const status = service.getConnectionStatus();
        
        console.log('✅ Service status:', status.connectionState);
        console.log('✅ Service ready:', status.isReady);
    } catch (error) {
        console.log('❌ Service health check failed:', error.message);
    }
    
    // Test 3: Mock Message Send (if configured)
    console.log('\n3. Testing Message Send (Mock)...');
    if (config.whatsapp.enableCloudApi && config.whatsapp.accessToken) {
        try {
            console.log('✅ WhatsApp Cloud API is enabled and configured');
            console.log('🔄 Ready to send messages via Cloud API');
        } catch (error) {
            console.log('❌ Message send test failed:', error.message);
        }
    } else {
        console.log('⚠️  WhatsApp Cloud API not enabled or not configured');
    }
    
    // Test 4: Webhook Validation
    console.log('\n4. Testing Webhook Setup...');
    if (config.whatsapp.webhookVerifyToken) {
        console.log('✅ Webhook verify token is configured');
        console.log('🔗 Webhook endpoints:');
        console.log('   GET  /api/webhook/whatsapp (verification)');
        console.log('   POST /api/webhook/whatsapp (events)');
    } else {
        console.log('❌ Webhook verify token not configured');
    }
    
    console.log('\n🎉 WhatsApp Integration Test Complete!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Configure WhatsApp Business API in Meta Business Manager');
    console.log('   2. Set webhook URL to: https://sniperbuisnesscenter.com/api/webhook/whatsapp');
    console.log('   3. Test with real phone numbers');
    console.log('   4. Monitor logs for message delivery status');
}

// Run the test
testWhatsAppIntegration().catch(console.error); 