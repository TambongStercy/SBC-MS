const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Test script to verify the fixed sendTemplateMessage method
async function testFixedTemplateSending() {
    console.log('🔧 Testing Fixed Template Message Sending\n');
    console.log('='.repeat(60));

    // Test the notification service API endpoint after the fix
    console.log('📋 Testing sequence:');
    console.log('1. Direct API call (baseline)');
    console.log('2. Live app endpoint (after fix)');
    console.log('3. Multiple rapid requests (stress test)');

    const testPhoneNumber = '237675080477'; // Your test number

    // 1. BASELINE TEST - Direct API call
    console.log('\n🟢 TEST 1: Direct API Call (Baseline)');
    console.log('-'.repeat(40));

    try {
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';

        const directMessage = {
            messaging_product: 'whatsapp',
            to: testPhoneNumber,
            type: 'template',
            template: {
                name: 'connexion',
                language: { code: 'en_US' },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: "DIRECT1" }]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: "DIRECT1" }]
                    }
                ]
            }
        };

        const response = await axios.post(
            `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
            directMessage,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.messages && response.data.messages.length > 0) {
            console.log(`✅ Direct API SUCCESS: ${response.data.messages[0].id}`);
        }
    } catch (error) {
        console.log(`❌ Direct API FAILED: ${error.response?.data?.error?.message || error.message}`);
    }

    // Wait a moment between tests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. LIVE APP ENDPOINT TEST (if notification service is running)
    console.log('\n🔵 TEST 2: Live App Endpoint (After Fix)');
    console.log('-'.repeat(40));

    const liveAppUrls = [
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'http://notification-service:3002' // Docker internal
    ];

    let liveAppSuccess = false;

    for (const baseUrl of liveAppUrls) {
        try {
            console.log(`🔍 Trying ${baseUrl}...`);

            // First check if service is running
            const healthResponse = await axios.get(`${baseUrl}/api/health`, {
                timeout: 2000
            });

            console.log(`✅ Service is running at ${baseUrl}`);

            // Now test OTP endpoint
            const otpResponse = await axios.post(`${baseUrl}/api/notifications/otp`, {
                userId: "507f1f77bcf86cd799439011",
                recipient: testPhoneNumber,
                channel: "whatsapp",
                code: "FIXED1",
                expireMinutes: 10,
                userName: "Test User"
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            console.log(`✅ Live app OTP SUCCESS: ${JSON.stringify(otpResponse.data)}`);
            liveAppSuccess = true;
            break;

        } catch (error) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                console.log(`❌ Service not available at ${baseUrl}`);
                continue;
            } else {
                console.log(`❌ Live app OTP FAILED: ${error.response?.data?.error?.message || error.message}`);
                if (error.response?.data) {
                    console.log(`   Response: ${JSON.stringify(error.response.data)}`);
                }
                break;
            }
        }
    }

    if (!liveAppSuccess) {
        console.log('⚠️  Could not test live app - service not running');
        console.log('💡 To test the fix:');
        console.log('   1. Start the notification service: docker-compose up notification-service');
        console.log('   2. Or run locally: cd notification-service && npm run dev');
        console.log('   3. Then run this test again');
    }

    // 3. STRESS TEST (if we found a working endpoint)
    if (liveAppSuccess) {
        console.log('\n⚡ TEST 3: Stress Test (Multiple Rapid Requests)');
        console.log('-'.repeat(40));

        console.log('🚀 Sending 3 rapid OTP requests to test retry logic...');

        const stressTests = [
            { code: 'STRESS1', delay: 0 },
            { code: 'STRESS2', delay: 500 },
            { code: 'STRESS3', delay: 1000 }
        ];

        for (const test of stressTests) {
            setTimeout(async () => {
                try {
                    const response = await axios.post('http://localhost:3002/api/notifications/otp', {
                        userId: "507f1f77bcf86cd799439011",
                        recipient: testPhoneNumber,
                        channel: "whatsapp",
                        code: test.code,
                        expireMinutes: 10,
                        userName: "Stress Test"
                    }, {
                        headers: {
                            'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    console.log(`✅ ${test.code} SUCCESS: ${JSON.stringify(response.data)}`);
                } catch (error) {
                    console.log(`❌ ${test.code} FAILED: ${error.response?.data?.error?.message || error.message}`);
                }
            }, test.delay);
        }
    }

    // SUMMARY
    setTimeout(() => {
        console.log('\n📊 TEST SUMMARY');
        console.log('='.repeat(60));
        console.log('🔧 Fix Applied:');
        console.log('✅ Added retry logic to sendTemplateMessage()');
        console.log('✅ Enhanced error handling for template messages');
        console.log('✅ Consistent with sendTextMessageEnhanced()');

        console.log('\n💡 Expected Results:');
        console.log('• More reliable template message delivery');
        console.log('• Better handling of temporary network issues');
        console.log('• Improved error reporting and logging');
        console.log('• Consistent behavior across all message types');

        console.log('\n🎯 Next Steps:');
        console.log('1. Deploy the fix to your notification service');
        console.log('2. Monitor delivery rates for improvement');
        console.log('3. Share troubleshooting guide with support team');
        console.log('4. Consider implementing SMS fallback for critical OTP');

    }, 5000);
}

// Run the test
testFixedTemplateSending().catch(console.error); 