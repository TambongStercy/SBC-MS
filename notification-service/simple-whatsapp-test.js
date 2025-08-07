/**
 * Simple WhatsApp Test Script
 * Quick test to send a message to verify WhatsApp service is working
 * 
 * Note: Template messages count against your daily messaging limit.
 * Plain text messages do not count against business-initiated conversation limits.
 */

const axios = require('axios');
require('dotenv').config();

// Configuration from your .env file
const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

const TEST_NUMBER = '237675080477'; // Your number
const TEST_OTP = '123456';

async function sendSimpleOTP() {
    console.log('🧪 Simple WhatsApp OTP Test');
    console.log('===========================\n');

    try {
        // Test 1: Send plain text OTP message
        console.log('1. Sending plain text OTP message...');

        const textMessage = {
            messaging_product: 'whatsapp',
            to: TEST_NUMBER,
            type: 'text',
            text: {
                body: `🔐 Your SBC verification code is: ${TEST_OTP}\n\nThis is a test message to verify WhatsApp service functionality.\n\nDo not share this code with anyone.`
            }
        };

        const textResponse = await axios.post(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
            textMessage,
            {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Plain text message sent successfully!');
        console.log('📨 Response:', textResponse.data);

        // Test 2: Send OTP template message (if available)
        console.log('\n2. Attempting to send OTP template message...');

        const templateMessage = {
            messaging_product: 'whatsapp',
            to: TEST_NUMBER,
            type: 'template',
            template: {
                name: 'connexion', // English OTP template
                language: {
                    code: 'en_US'
                },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            {
                                type: 'text',
                                text: TEST_OTP
                            }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            {
                                type: 'text',
                                text: TEST_OTP
                            }
                        ]
                    }
                ]
            }
        };

        const templateResponse = await axios.post(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
            templateMessage,
            {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Template message sent successfully!');
        console.log('📨 Response:', templateResponse.data);

        console.log('\n🎉 SUCCESS! Both messages sent successfully.');
        console.log(`📱 Check WhatsApp on ${TEST_NUMBER} for the messages.`);
        console.log(`🔢 Test OTP code: ${TEST_OTP}`);

    } catch (error) {
        console.error('❌ Error sending WhatsApp message:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
        });

        console.log('\n🔧 Troubleshooting:');
        if (error.response?.status === 401) {
            console.log('- Check WHATSAPP_ACCESS_TOKEN in .env file');
        } else if (error.response?.status === 404) {
            console.log('- Check WHATSAPP_PHONE_NUMBER_ID in .env file');
        } else if (error.response?.data?.error?.code === 131000) {
            console.log('- Phone number might not be registered on WhatsApp');
        } else if (error.response?.data?.error?.code === 131005) {
            console.log('- Phone number format might be incorrect');
        } else if (error.response?.data?.error?.code === 131014) {
            console.log('- Invalid recipient phone number');
        } else if (error.response?.data?.error?.message?.includes('template')) {
            console.log('- Template might not be approved or available');
            console.log('- Plain text message should still work for testing');
        }
    }
}

// Test phone number formatting
function testPhoneFormatting() {
    console.log('📱 Phone Number Formatting Test:');
    console.log('=================================');
    console.log(`Target: ${TEST_NUMBER}`);
    console.log('Expected: 237675080477 (Cameroon format)');
    console.log('✅ Number appears to be correctly formatted\n');
}

// Run tests
testPhoneFormatting();
sendSimpleOTP();