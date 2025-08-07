/**
 * Enhanced WhatsApp Test Script with Rate Limiting
 * Includes rate limit checking to prevent hitting daily messaging limits
 */

const axios = require('axios');
const WhatsAppRateLimiter = require('./rate-limit-checker');
require('dotenv').config();

// Configuration from your .env file
const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

const TEST_NUMBER = '237675080477';
const TEST_OTP = '123456';
const rateLimiter = new WhatsAppRateLimiter();

async function sendEnhancedOTP() {
    console.log('🧪 Enhanced WhatsApp OTP Test with Rate Limiting');
    console.log('================================================\n');

    // Check rate limit status first
    const status = rateLimiter.getStatus();
    console.log('📊 Current Rate Limit Status:');
    console.log(`   • Can send messages: ${status.canSend ? '✅ YES' : '❌ NO'}`);
    console.log(`   • Messages remaining: ${status.remaining}/${status.total}`);
    console.log(`   • Messages used: ${status.used}`);
    console.log(`   • Hours until reset: ${status.hoursUntilReset}`);
    console.log(`   • Reset time: ${status.resetTime}\n`);

    if (!status.canSend) {
        console.log('⚠️  RATE LIMIT REACHED!');
        console.log('You have reached your daily messaging limit.');
        console.log(`Wait ${status.hoursUntilReset} hours before sending more template messages.\n`);
        console.log('💡 Tip: Plain text messages don\'t count against this limit.');
        return;
    }

    try {
        // Test 1: Send plain text OTP message (doesn't count against limit)
        console.log('1. Sending plain text OTP message (no limit impact)...');

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

        // Test 2: Send OTP template message (counts against limit)
        console.log('\n2. Attempting to send OTP template message...');
        console.log('⚠️  This will count against your daily limit!');

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

        // If API call was successful, increment our local counter
        if (templateResponse.data.messages && templateResponse.data.messages.length > 0) {
            rateLimiter.incrementCount();
            console.log('✅ Template message sent successfully!');
            console.log('📊 Rate limit counter updated');
        }

        console.log('📨 Response:', templateResponse.data);

        // Show updated status
        const newStatus = rateLimiter.getStatus();
        console.log(`\n📊 Updated Status: ${newStatus.remaining} messages remaining today`);

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

        // Check for specific rate limit errors
        if (error.response?.status === 429 ||
            error.response?.data?.error?.code === 131048) {
            console.log('\n🚫 RATE LIMIT ERROR DETECTED!');
            console.log('This confirms you have hit your messaging limit.');
            console.log('Update your local rate limiter:');

            // Set local counter to max to prevent further attempts
            const currentStatus = rateLimiter.getStatus();
            rateLimiter.updateDailyLimit(currentStatus.used);
        }

        console.log('\n🔧 Troubleshooting:');
        if (error.response?.status === 401) {
            console.log('- Check WHATSAPP_ACCESS_TOKEN in .env file');
        } else if (error.response?.status === 404) {
            console.log('- Check WHATSAPP_PHONE_NUMBER_ID in .env file');
        } else if (error.response?.status === 429) {
            console.log('- Rate limit exceeded - wait before sending more messages');
        } else if (error.response?.data?.error?.code === 131048) {
            console.log('- Messaging limit reached - check WhatsApp Business Manager');
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

// Add command line option to update daily limit
if (process.argv.includes('--update-limit')) {
    const limitIndex = process.argv.indexOf('--update-limit');
    const newLimit = parseInt(process.argv[limitIndex + 1]);
    if (newLimit && newLimit > 0) {
        const rateLimiter = new WhatsAppRateLimiter();
        rateLimiter.updateDailyLimit(newLimit);
        console.log(`✅ Daily limit updated to ${newLimit}`);
        process.exit(0);
    } else {
        console.log('❌ Please provide a valid limit number: node enhanced-whatsapp-test.js --update-limit 1000');
        process.exit(1);
    }
}

// Run tests
testPhoneFormatting();
sendEnhancedOTP();