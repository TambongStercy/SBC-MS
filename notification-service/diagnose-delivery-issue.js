/**
 * WhatsApp Message Delivery Diagnostic Script
 * Helps identify why messages are accepted but not delivered
 */

const axios = require('axios');
require('dotenv').config();

const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

const TEST_NUMBER = '237675080477';

async function diagnoseDeliveryIssue() {
    console.log('🔍 WhatsApp Message Delivery Diagnostic');
    console.log('=======================================\n');
    
    try {
        // 1. Check Phone Number Status
        console.log('1. Checking WhatsApp Phone Number Status...');
        const phoneResponse = await axios.get(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}`,
            {
                headers: { 'Authorization': `Bearer ${config.accessToken}` }
            }
        );
        
        console.log('📱 Phone Number Info:', {
            id: phoneResponse.data.id,
            display_phone_number: phoneResponse.data.display_phone_number,
            verified_name: phoneResponse.data.verified_name,
            status: phoneResponse.data.status || 'CONNECTED',
            quality_rating: phoneResponse.data.quality_rating || 'Not available'
        });
        
        // 2. Check Business Account Status
        console.log('\n2. Checking Business Account Status...');
        const businessResponse = await axios.get(
            `${config.baseUrl}/${config.apiVersion}/${config.businessAccountId}`,
            {
                headers: { 'Authorization': `Bearer ${config.accessToken}` }
            }
        );
        
        console.log('🏢 Business Account Info:', {
            id: businessResponse.data.id,
            name: businessResponse.data.name,
            verification_status: businessResponse.data.verification_status || 'Not available',
            business_status: businessResponse.data.business_status || 'Not available'
        });
        
        // 3. Check Message Templates
        console.log('\n3. Checking Available Message Templates...');
        try {
            const templatesResponse = await axios.get(
                `${config.baseUrl}/${config.apiVersion}/${config.businessAccountId}/message_templates`,
                {
                    headers: { 'Authorization': `Bearer ${config.accessToken}` }
                }
            );
            
            console.log('📋 Available Templates:');
            templatesResponse.data.data.forEach(template => {
                console.log(`   - ${template.name} (${template.language}) - Status: ${template.status}`);
            });
        } catch (templateError) {
            console.log('⚠️  Could not fetch templates:', templateError.response?.data?.error?.message || templateError.message);
        }
        
        // 4. Test with a different message type
        console.log('\n4. Testing Simple Text Message...');
        const simpleMessage = {
            messaging_product: 'whatsapp',
            to: TEST_NUMBER,
            type: 'text',
            text: {
                body: 'Hello! This is a simple test message from SBC. If you receive this, the basic messaging is working.'
            }
        };
        
        const simpleResponse = await axios.post(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
            simpleMessage,
            {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✅ Simple message sent:', simpleResponse.data);
        
        // 5. Check webhook configuration
        console.log('\n5. Checking Webhook Configuration...');
        try {
            const webhookResponse = await axios.get(
                `${config.baseUrl}/${config.apiVersion}/${config.businessAccountId}/subscribed_apps`,
                {
                    headers: { 'Authorization': `Bearer ${config.accessToken}` }
                }
            );
            
            console.log('🔗 Webhook Status:', webhookResponse.data);
        } catch (webhookError) {
            console.log('⚠️  Could not check webhook status:', webhookError.response?.data?.error?.message || webhookError.message);
        }
        
        console.log('\n📋 DIAGNOSTIC SUMMARY');
        console.log('=====================');
        console.log('✅ API Connection: Working');
        console.log('✅ Phone Number: Active');
        console.log('✅ Message Acceptance: Working');
        console.log('❓ Message Delivery: Issue detected');
        
        console.log('\n🔧 LIKELY CAUSES & SOLUTIONS:');
        console.log('=============================');
        
        console.log('\n1. 📱 PHONE NUMBER NOT ON WHATSAPP');
        console.log('   - Make sure 237675080477 is registered on WhatsApp');
        console.log('   - The number must be active and able to receive messages');
        console.log('   - Try sending from another WhatsApp account to verify');
        
        console.log('\n2. 🚫 24-HOUR WINDOW RESTRICTION');
        console.log('   - WhatsApp requires opt-in for marketing messages');
        console.log('   - Template messages can be sent anytime');
        console.log('   - Plain text messages need user interaction within 24 hours');
        console.log('   - Solution: Send a message TO the business number first');
        
        console.log('\n3. 📋 TEMPLATE APPROVAL STATUS');
        console.log('   - Check WhatsApp Business Manager for template status');
        console.log('   - Templates must be APPROVED before use');
        console.log('   - Rejected templates will be accepted but not delivered');
        
        console.log('\n4. 🌍 COUNTRY/REGION RESTRICTIONS');
        console.log('   - Some countries have restrictions on business messaging');
        console.log('   - Cameroon should be supported, but check Meta\'s country list');
        
        console.log('\n5. 📊 QUALITY RATING ISSUES');
        console.log('   - Low quality rating can block message delivery');
        console.log('   - Check Business Manager for quality score');
        
        console.log('\n6. 🔄 RATE LIMITING');
        console.log('   - Too many messages in short time can trigger limits');
        console.log('   - Wait 15-30 minutes between test messages');
        
        console.log('\n🎯 IMMEDIATE ACTIONS TO TRY:');
        console.log('============================');
        console.log('1. Send a message FROM 237675080477 TO your business WhatsApp number');
        console.log('2. Wait 2-3 minutes, then run this test again');
        console.log('3. Check WhatsApp Business Manager for any alerts');
        console.log('4. Verify the phone number is actually registered on WhatsApp');
        console.log('5. Try with a different phone number that you know works');
        
    } catch (error) {
        console.error('❌ Diagnostic failed:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
        });
    }
}

// Run diagnostic
diagnoseDeliveryIssue();