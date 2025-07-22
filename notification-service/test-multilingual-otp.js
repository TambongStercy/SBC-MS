const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Test script to verify multilingual OTP template functionality
async function testMultilingualOtp() {
    const baseUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api';

    const testCases = [
        {
            name: 'English OTP (en_US)',
            data: {
                userId: "507f1f77bcf86cd799439011",
                recipient: "+237675080477",
                channel: "whatsapp",
                code: "123456",
                expireMinutes: 10,
                isRegistration: true,
                userName: "Test User",
                purpose: "login",
                language: "en_US" // Will use 'connexion' template
            }
        },
        {
            name: 'French OTP (fr)',
            data: {
                userId: "507f1f77bcf86cd799439011",
                recipient: "+237675080477",
                channel: "whatsapp",
                code: "654321",
                expireMinutes: 10,
                isRegistration: true,
                userName: "Utilisateur Test",
                purpose: "registration",
                language: "fr" // Will use 'connexionfr' template
            }
        },
        {
            name: 'Default English (no language specified)',
            data: {
                userId: "507f1f77bcf86cd799439011",
                recipient: "+237675080477",
                channel: "whatsapp",
                code: "789012",
                expireMinutes: 10,
                isRegistration: false
                // No language specified - will default to 'connexion' template
            }
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🧪 Testing ${testCase.name}...`);
        console.log(`📱 Expected template: ${testCase.data.language || 'en_US (default)'}`);

        try {
            const response = await axios.post(`${baseUrl}/notifications/otp`, testCase.data, {
                headers: {
                    'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                console.log(`✅ ${testCase.name} test passed`);
                console.log(`📋 Check logs for template: ${testCase.data.language === 'fr' ? 'connexionfr' : 'connexion'}`);
            } else {
                console.log(`❌ ${testCase.name} test failed:`, response.data.message);
            }

        } catch (error) {
            console.error(`❌ ${testCase.name} test error:`, error.response?.data || error.message);
        }

        // Wait 2 seconds between tests to avoid overwhelming the queue
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Run the tests
console.log('🚀 Starting Multilingual OTP Template Tests...\n');
console.log('📋 Expected Behavior:');
console.log('   - en_US/en language → uses "connexion" template');
console.log('   - fr language → uses "connexionfr" template');
console.log('   - No language → defaults to "connexion" template');
console.log('');

testMultilingualOtp().catch(console.error); 