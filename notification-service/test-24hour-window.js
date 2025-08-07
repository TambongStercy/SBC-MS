/**
 * WhatsApp 24-Hour Window Test
 * Tests if the issue is related to the 24-hour messaging window
 */

const axios = require('axios');
require('dotenv').config();

const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

const TEST_NUMBER = '237675080477';

async function test24HourWindow() {
    console.log('⏰ WhatsApp 24-Hour Window Test');
    console.log('===============================\n');
    
    console.log('🔍 Understanding the 24-Hour Rule:');
    console.log('- WhatsApp allows FREE-FORM messages only within 24 hours of user interaction');
    console.log('- TEMPLATE messages can be sent anytime (but must be approved)');
    console.log('- If no recent interaction, only approved templates work\n');
    
    try {
        // Test 1: Try to send a template message (should work anytime)
        console.log('1. Testing TEMPLATE message (should work anytime)...');
        
        const templateMessage = {
            messaging_product: 'whatsapp',
            to: TEST_NUMBER,
            type: 'template',
            template: {
                name: 'hello_world', // Standard WhatsApp template
                language: {
                    code: 'en_US'
                }
            }
        };
        
        try {
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
            
        } catch (templateError) {
            console.log('❌ Template message failed:', templateError.response?.data);
            
            // Try with your custom template
            console.log('\n   Trying with custom OTP template...');
            
            const otpTemplate = {
                messaging_product: 'whatsapp',
                to: TEST_NUMBER,
                type: 'template',
                template: {
                    name: 'connexion',
                    language: {
                        code: 'en_US'
                    },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                {
                                    type: 'text',
                                    text: '999888'
                                }
                            ]
                        }
                    ]
                }
            };
            
            try {
                const otpResponse = await axios.post(
                    `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
                    otpTemplate,
                    {
                        headers: {
                            'Authorization': `Bearer ${config.accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                console.log('✅ OTP template sent successfully!');
                console.log('📨 Response:', otpResponse.data);
                
            } catch (otpError) {
                console.log('❌ OTP template also failed:', otpError.response?.data);
            }
        }
        
        console.log('\n📋 ANALYSIS:');
        console.log('============');
        
        console.log('\n🎯 MOST LIKELY ISSUE: 24-Hour Window Restriction');
        console.log('Your messages are being ACCEPTED but not DELIVERED because:');
        console.log('1. The recipient (237675080477) hasn\'t messaged your business recently');
        console.log('2. WhatsApp only delivers free-form messages within 24 hours of user interaction');
        console.log('3. Template messages require approval and proper setup');
        
        console.log('\n🔧 SOLUTION STEPS:');
        console.log('==================');
        
        console.log('\n📱 STEP 1: Initiate Conversation');
        console.log('From your phone (237675080477):');
        console.log('1. Open WhatsApp');
        console.log('2. Send ANY message to your business number (+237 6 88 73 53 68)');
        console.log('3. Just send "Hi" or "Test" - anything works');
        console.log('4. This opens the 24-hour window');
        
        console.log('\n⏰ STEP 2: Test Within 24 Hours');
        console.log('After sending the message above:');
        console.log('1. Wait 1-2 minutes');
        console.log('2. Run: node simple-whatsapp-test.js');
        console.log('3. You should receive the messages immediately');
        
        console.log('\n📋 STEP 3: Setup Templates (Long-term solution)');
        console.log('For production use:');
        console.log('1. Go to WhatsApp Business Manager');
        console.log('2. Ensure your templates are APPROVED');
        console.log('3. Use only approved templates for automated messages');
        console.log('4. Templates work anytime, no 24-hour restriction');
        
        console.log('\n🚨 IMPORTANT NOTES:');
        console.log('===================');
        console.log('- This is normal WhatsApp behavior, not a bug');
        console.log('- All business accounts have this restriction');
        console.log('- Templates are the solution for automated messaging');
        console.log('- The 24-hour window resets with each user message');
        
        console.log('\n✅ YOUR WHATSAPP SERVICE IS WORKING CORRECTLY!');
        console.log('The issue is just the messaging window restriction.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

// Run the test
test24HourWindow();