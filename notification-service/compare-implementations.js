const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Script to compare working test vs live app implementation
async function compareImplementations() {
    console.log('🔍 Comparing Working Test vs Live App Implementation\n');
    console.log('='.repeat(70));

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
    const baseUrl = `https://graph.facebook.com/${apiVersion}`;

    // 1. TEST MY WORKING DIRECT IMPLEMENTATION
    console.log('\n🟢 TEST 1: My Working Direct Implementation (with retry)');
    console.log('-'.repeat(50));

    try {
        const testMessage = {
            messaging_product: 'whatsapp',
            to: '237675080477',
            type: 'template',
            template: {
                name: 'connexion',
                language: { code: 'en_US' },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: "TEST001" }]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: "TEST001" }]
                    }
                ]
            }
        };

        console.log('📤 Sending with retry logic...');
        const response = await sendWithRetry(`${baseUrl}/${phoneNumberId}/messages`, testMessage, accessToken);

        if (response.data.messages && response.data.messages.length > 0) {
            console.log(`✅ SUCCESS: Message ID ${response.data.messages[0].id}`);
        }
    } catch (error) {
        console.log(`❌ FAILED: ${error.response?.data?.error?.message || error.message}`);
    }

    // 2. TEST LIVE APP IMPLEMENTATION (without retry)
    console.log('\n🔴 TEST 2: Live App Implementation (no retry)');
    console.log('-'.repeat(50));

    try {
        const testMessage = {
            messaging_product: 'whatsapp',
            to: '237675080477',
            type: 'template',
            template: {
                name: 'connexion',
                language: { code: 'en_US' },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: "TEST002" }]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: "TEST002" }]
                    }
                ]
            }
        };

        console.log('📤 Sending without retry logic (simulating live app)...');
        const response = await sendWithoutRetry(`${baseUrl}/${phoneNumberId}/messages`, testMessage, accessToken);

        if (response.data.messages && response.data.messages.length > 0) {
            console.log(`✅ SUCCESS: Message ID ${response.data.messages[0].id}`);
        }
    } catch (error) {
        console.log(`❌ FAILED: ${error.response?.data?.error?.message || error.message}`);
    }

    // 3. TEST RATE LIMITING SCENARIO
    console.log('\n⚡ TEST 3: Rate Limiting Test (multiple rapid sends)');
    console.log('-'.repeat(50));

    console.log('🚀 Sending 3 messages rapidly (like when multiple users request OTP)...');

    const rapidMessages = [
        { code: 'RAPID1', delay: 0 },
        { code: 'RAPID2', delay: 100 },
        { code: 'RAPID3', delay: 200 }
    ];

    for (const msg of rapidMessages) {
        setTimeout(async () => {
            try {
                const testMessage = {
                    messaging_product: 'whatsapp',
                    to: '237675080477',
                    type: 'template',
                    template: {
                        name: 'connexion',
                        language: { code: 'en_US' },
                        components: [
                            {
                                type: "body",
                                parameters: [{ type: "text", text: msg.code }]
                            },
                            {
                                type: "button",
                                sub_type: "url",
                                index: "0",
                                parameters: [{ type: "text", text: msg.code }]
                            }
                        ]
                    }
                };

                console.log(`📤 Sending ${msg.code}...`);
                const response = await sendWithoutRetry(`${baseUrl}/${phoneNumberId}/messages`, testMessage, accessToken);

                if (response.data.messages && response.data.messages.length > 0) {
                    console.log(`✅ ${msg.code} SUCCESS: ${response.data.messages[0].id}`);
                } else {
                    console.log(`❌ ${msg.code} FAILED: No message ID`);
                }
            } catch (error) {
                console.log(`❌ ${msg.code} FAILED: ${error.response?.data?.error?.message || error.message}`);

                // Check for rate limiting
                if (error.response?.status === 429) {
                    console.log(`   🚨 RATE LIMITED! This is likely why live app fails`);
                }
            }
        }, msg.delay);
    }

    // 4. TEST VIA LIVE APP ENDPOINT
    setTimeout(async () => {
        console.log('\n🔵 TEST 4: Via Live App Endpoint');
        console.log('-'.repeat(50));

        try {
            console.log('📤 Sending OTP via live app endpoint...');
            const response = await axios.post('http://localhost:3002/api/notifications/otp', {
                userId: "507f1f77bcf86cd799439011",
                recipient: "237675080477",
                channel: "whatsapp",
                code: "LIVE123",
                expireMinutes: 10,
                userName: "Test User"
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`✅ Live app response: ${JSON.stringify(response.data)}`);
        } catch (error) {
            console.log(`❌ Live app failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }, 3000);

    // ANALYSIS SUMMARY  
    setTimeout(() => {
        console.log('\n📊 ANALYSIS SUMMARY');
        console.log('='.repeat(70));
        console.log('🔍 Key Differences Found:');
        console.log('1. ✅ Direct API calls (my test) = WORKING with retry logic');
        console.log('2. ❌ Live app template sending = NO RETRY LOGIC');
        console.log('3. ⚡ Rate limiting may affect rapid consecutive sends');
        console.log('4. 🕐 Queue processing may introduce timing issues');

        console.log('\n💡 LIKELY ROOT CAUSE:');
        console.log('The WhatsAppCloudService.sendTemplateMessage() method lacks');
        console.log('retry logic that exists in sendTextMessageEnhanced()');

        console.log('\n🔧 SOLUTION:');
        console.log('Add retry logic to sendTemplateMessage() method');
        console.log('Similar to how sendTextMessageEnhanced() works');

    }, 6000);
}

// Helper function: Send with retry logic (like my working test)
async function sendWithRetry(url, data, token, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, data, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            if (attempt === maxRetries) throw error;

            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`   ⏳ Retry ${attempt}/${maxRetries} after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Helper function: Send without retry (like live app)
async function sendWithoutRetry(url, data, token) {
    return await axios.post(url, data, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

// Run the comparison
compareImplementations().catch(console.error); 