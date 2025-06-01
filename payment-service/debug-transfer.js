// Debug script to test CinetPay transfer request directly
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://client.cinetpay.com/v1';

async function debugTransferRequest() {
    console.log('🔍 Debugging CinetPay Transfer Request...\n');

    try {
        // Step 1: Authenticate
        console.log('1️⃣ Authenticating...');
        const authParams = new URLSearchParams();
        authParams.append('apikey', process.env.CINETPAY_API_KEY);
        authParams.append('password', process.env.CINETPAY_TRANSFER_PASSWORD);

        const authResponse = await axios.post(`${BASE_URL}/auth/login?lang=fr`, authParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (authResponse.data.code !== 0) {
            console.log('❌ Authentication failed:', authResponse.data.message);
            return;
        }

        const token = authResponse.data.data.token;
        console.log('✅ Authentication successful');
        console.log();

        // Step 2: Test Transfer Request
        console.log('2️⃣ Testing Transfer Request...');
        
        const transferRequest = {
            prefix: '237',
            phone: '675080477',
            amount: 500,
            notify_url: 'https://sniperbuisnesscenter.com/api/payouts/cinetpay/webhook',
            client_transaction_id: `SBC_test_${Date.now()}`,
            payment_method: 'MTNCM'
        };

        console.log('Transfer Request:', JSON.stringify(transferRequest, null, 2));
        console.log();

        // Test different payload formats
        const payloadFormats = [
            {
                name: 'Current Format (array)',
                payload: `data=${JSON.stringify([transferRequest])}`
            },
            {
                name: 'Direct Object Format',
                payload: JSON.stringify(transferRequest)
            },
            {
                name: 'Form Data Format',
                payload: new URLSearchParams(Object.entries(transferRequest).map(([k, v]) => [k, String(v)]))
            }
        ];

        for (const format of payloadFormats) {
            console.log(`🧪 Testing: ${format.name}`);
            
            try {
                const headers = format.name === 'Direct Object Format' 
                    ? { 'Content-Type': 'application/json' }
                    : { 'Content-Type': 'application/x-www-form-urlencoded' };

                const response = await axios.post(
                    `${BASE_URL}/transfer/money/send/contact?token=${token}&lang=fr`,
                    format.payload,
                    { headers }
                );

                console.log('✅ Success!');
                console.log('Response Status:', response.status);
                console.log('Response Data:', JSON.stringify(response.data, null, 2));
                break; // Stop on first success

            } catch (error) {
                console.log('❌ Failed');
                console.log('Status:', error.response?.status);
                console.log('Error:', error.response?.data || error.message);
                console.log();
            }
        }

        // Step 3: Check if there are any specific requirements
        console.log('3️⃣ Checking Transfer Requirements...');
        
        // Check balance for Cameroon specifically
        const balanceResponse = await axios.get(`${BASE_URL}/transfer/check/balance?token=${token}&lang=fr`);
        const balance = balanceResponse.data.data;
        
        console.log('Balance Info:');
        console.log('- Total Available:', balance.available);
        console.log('- Cameroon Balance:', balance.countryBalance?.CM?.available || 0);
        console.log('- Transfer Amount:', transferRequest.amount);
        
        if (balance.countryBalance?.CM?.available < transferRequest.amount) {
            console.log('⚠️  Insufficient balance for Cameroon transfers');
        } else {
            console.log('✅ Sufficient balance available');
        }

    } catch (error) {
        console.error('💥 Debug failed:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Test webhook URL
function testWebhookURL() {
    console.log('\n🔗 Testing Webhook URL...\n');
    
    const webhookUrl = 'https://sniperbuisnesscenter.com/api/payouts/cinetpay/webhook';
    console.log('Webhook URL:', webhookUrl);
    
    // Basic URL validation
    try {
        const url = new URL(webhookUrl);
        console.log('✅ URL format is valid');
        console.log('- Protocol:', url.protocol);
        console.log('- Host:', url.hostname);
        console.log('- Path:', url.pathname);
        
        if (url.protocol !== 'https:') {
            console.log('⚠️  CinetPay may require HTTPS for webhooks');
        }
    } catch (error) {
        console.log('❌ Invalid URL format:', error.message);
    }
}

// Run tests
if (require.main === module) {
    testWebhookURL();
    debugTransferRequest();
}

module.exports = { debugTransferRequest, testWebhookURL };
