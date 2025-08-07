/**
 * Test WhatsApp Conversation Initiation Rules
 * Demonstrates what happens when trying to initiate with plain text
 */

const axios = require('axios');
require('dotenv').config();

const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

async function testConversationInitiation() {
    console.log('🧪 Testing WhatsApp Conversation Initiation Rules');
    console.log('=================================================\n');

    const testNumber = '237675080477'; // Your number

    // Test 1: Try to initiate with plain text (should fail or be limited)
    console.log('Test 1: Attempting to initiate conversation with plain text...');
    console.log('Expected: This may fail or have limitations\n');

    try {
        const plainTextMessage = {
            messaging_product: 'whatsapp',
            to: testNumber,
            type: 'text',
            text: {
                body: '🔄 Testing conversation initiation with plain text message. This is a test to see WhatsApp\'s response.'
            }
        };

        const response = await axios.post(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
            plainTextMessage,
            {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('📨 Plain text response:', response.data);

        if (response.data.messages && response.data.messages.length > 0) {
            console.log('✅ Plain text message was accepted by API');
            console.log('⚠️  But this doesn\'t guarantee delivery if no active conversation exists');
        }

    } catch (error) {
        console.log('❌ Plain text initiation failed:');
        console.log('Status:', error.response?.status);
        console.log('Error:', error.response?.data);

        if (error.response?.data?.error?.code === 131047) {
            console.log('🔍 This is the expected error: Cannot send non-template messages outside 24-hour window');
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📋 WhatsApp Business API Rules Summary:');
    console.log('='.repeat(50));
    console.log('✅ Business → Customer (First): Template required');
    console.log('✅ Customer → Business: Opens 24hr window');
    console.log('✅ Within 24hr window: Plain text allowed');
    console.log('❌ Plain text initiation: Not allowed/limited');
    console.log('\n💡 Solution: Use emergency-otp-sender.js for existing conversations');
    console.log('💡 For new customers: Must wait for template limit reset');
}

// Run test
testConversationInitiation();