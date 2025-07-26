const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Comprehensive message delivery test script
async function testMessageDelivery() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';

    const httpClient = axios.create({
        baseURL: `https://graph.facebook.com/${apiVersion}`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('🔍 WhatsApp Message Delivery Test\n');
    console.log('='.repeat(60));

    // Test different phone numbers and template combinations
    const testCases = [
        {
            name: 'Test 1: Original template structure (current code)',
            phoneNumber: '237675080477', // Your test number
            template: 'connexion',
            language: 'en_US',
            components: [
                {
                    type: "body",
                    parameters: [{ type: "text", text: "123456" }]
                },
                {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: "123456" }]
                }
            ]
        },
        {
            name: 'Test 2: French template (current code)',
            phoneNumber: '237675080477',
            template: 'connexionfr',
            language: 'fr',
            components: [
                {
                    type: "body",
                    parameters: [{ type: "text", text: "654321" }]
                },
                {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: "654321" }]
                }
            ]
        },
        {
            name: 'Test 3: Body only (no button)',
            phoneNumber: '237675080477',
            template: 'connexion',
            language: 'en_US',
            components: [
                {
                    type: "body",
                    parameters: [{ type: "text", text: "789012" }]
                }
            ]
        },
        {
            name: 'Test 4: Different phone number format',
            phoneNumber: '242065436785', // From your logs
            template: 'connexionfr',
            language: 'fr',
            components: [
                {
                    type: "body",
                    parameters: [{ type: "text", text: "555666" }]
                },
                {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: "555666" }]
                }
            ]
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🧪 ${testCase.name}`);
        console.log('-'.repeat(40));

        const message = {
            messaging_product: 'whatsapp',
            to: testCase.phoneNumber,
            type: 'template',
            template: {
                name: testCase.template,
                language: {
                    code: testCase.language
                },
                components: testCase.components
            }
        };

        try {
            console.log(`📱 Sending to: ${testCase.phoneNumber}`);
            console.log(`📄 Template: ${testCase.template} (${testCase.language})`);

            const response = await httpClient.post(`/${phoneNumberId}/messages`, message);

            if (response.data.messages && response.data.messages.length > 0) {
                const messageData = response.data.messages[0];
                const contactData = response.data.contacts[0];

                console.log(`✅ Message sent successfully!`);
                console.log(`   Message ID: ${messageData.id}`);
                console.log(`   WhatsApp ID: ${contactData.wa_id}`);
                console.log(`   Input: ${contactData.input}`);

                // Check if there's a delivery status
                if (response.data.error) {
                    console.log(`⚠️  Warning: ${response.data.error.message}`);
                }
            } else {
                console.log(`❌ No message ID returned`);
            }

        } catch (error) {
            console.log(`❌ Failed: ${error.response?.data?.error?.message || error.message}`);

            if (error.response?.data?.error?.error_data) {
                console.log(`   Details: ${JSON.stringify(error.response.data.error.error_data, null, 2)}`);
            }

            // Common error analysis
            if (error.response?.data?.error?.code) {
                analyzeError(error.response.data.error);
            }
        }

        // Wait between tests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 DELIVERY ANALYSIS');
    console.log('='.repeat(60));

    await checkDeliveryIssues();
}

function analyzeError(error) {
    const commonErrors = {
        100: 'Invalid parameter',
        131000: 'Generic user error',
        131005: 'Message rate exceeded',
        131008: 'Message template not found',
        131014: 'Template does not exist',
        131016: 'Template format is invalid',
        131021: 'Recipient phone number not valid',
        131026: 'Message undeliverable',
        131031: 'Template parameter format mismatch',
        131047: 'Re-engagement message',
        131051: 'Unsupported message type'
    };

    const errorCode = error.code;
    const knownError = commonErrors[errorCode];

    if (knownError) {
        console.log(`   🔍 Error Analysis: ${knownError}`);
    } else {
        console.log(`   🔍 Unknown error code: ${errorCode}`);
    }
}

async function checkDeliveryIssues() {
    console.log('\n🔍 Common reasons messages don\'t reach users:');
    console.log('1. User blocked business messages in WhatsApp settings');
    console.log('2. User doesn\'t have the business number saved');
    console.log('3. User\'s phone is offline or has poor connectivity');
    console.log('4. WhatsApp notification settings are disabled on user\'s phone');
    console.log('5. User is in a different time zone (messages during sleep hours)');
    console.log('6. Phone number format issues (missing country code, etc.)');
    console.log('7. User has uninstalled or doesn\'t use WhatsApp regularly');
    console.log('8. Corporate/business WhatsApp restrictions');

    console.log('\n💡 Debugging steps:');
    console.log('1. Ask users to check their WhatsApp notification settings');
    console.log('2. Ask users to save your business number as a contact');
    console.log('3. Test with your own phone number to verify delivery');
    console.log('4. Check if users receive regular text messages to same numbers');
    console.log('5. Consider fallback to SMS for critical OTP messages');
    console.log('6. Monitor WhatsApp Business Manager for any account warnings');

    console.log('\n📱 User troubleshooting guide:');
    console.log('Ask users to:');
    console.log('- Open WhatsApp > Settings > Notifications');
    console.log('- Enable "Show notifications" and "Show on lock screen"');
    console.log('- Check if they have "Block business messages" disabled');
    console.log('- Save your business number (+237 6 88 73 53 68) as a contact');
    console.log('- Check their phone\'s general notification settings for WhatsApp');
}

// Run the test
testMessageDelivery().catch(console.error); 