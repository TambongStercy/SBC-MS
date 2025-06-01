// Test different payment methods for Cameroon
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://client.cinetpay.com/v1';

async function testPaymentMethods() {
    console.log('🧪 Testing Different Payment Methods for Cameroon...\n');

    try {
        // Authenticate first
        const authParams = new URLSearchParams();
        authParams.append('apikey', process.env.CINETPAY_API_KEY);
        authParams.append('password', process.env.CINETPAY_TRANSFER_PASSWORD);

        const authResponse = await axios.post(`${BASE_URL}/auth/login?lang=fr`, authParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const token = authResponse.data.data.token;

        // Test different payment methods for Cameroon MTN
        const paymentMethods = [
            { name: 'No payment method', value: undefined },
            { name: 'Empty string', value: '' },
            { name: 'MTNCM (current)', value: 'MTNCM' },
            { name: 'MTN', value: 'MTN' },
            { name: 'MOMO', value: 'MOMO' },
            { name: 'OMCM (Orange)', value: 'OMCM' },
            { name: 'Auto-detect', value: null }
        ];

        for (const method of paymentMethods) {
            console.log(`🔍 Testing: ${method.name}`);
            
            const transferRequest = {
                prefix: '237',
                phone: '675080477',
                amount: 500,
                notify_url: 'https://sniperbuisnesscenter.com/api/payouts/cinetpay/webhook',
                client_transaction_id: `SBC_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };

            // Add payment method if specified
            if (method.value !== undefined && method.value !== null) {
                transferRequest.payment_method = method.value;
            }

            console.log('Request:', JSON.stringify(transferRequest, null, 2));

            try {
                const response = await axios.post(
                    `${BASE_URL}/transfer/money/send/contact?token=${token}&lang=fr`,
                    `data=${JSON.stringify([transferRequest])}`,
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                );

                console.log('✅ SUCCESS!');
                console.log('Response:', JSON.stringify(response.data, null, 2));
                console.log('\n🎉 Found working payment method!');
                break;

            } catch (error) {
                console.log('❌ Failed');
                if (error.response?.data?.data?.[0]?.message) {
                    console.log('Error:', error.response.data.data[0].message);
                } else {
                    console.log('Error:', error.response?.data?.message || error.message);
                }
                console.log();
            }
        }

    } catch (error) {
        console.error('💥 Test setup failed:', error.message);
    }
}

// Test phone number detection
function testPhoneNumberDetection() {
    console.log('\n📱 Testing Phone Number Operator Detection...\n');
    
    const cameroonPrefixes = {
        'MTN': ['650', '651', '652', '653', '654', '670', '671', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '684', '685', '686', '687', '688', '689'],
        'Orange': ['655', '656', '657', '658', '659']
    };

    const testPhone = '675080477';
    const phonePrefix = testPhone.substring(0, 3);
    
    console.log(`Phone number: ${testPhone}`);
    console.log(`Prefix: ${phonePrefix}`);
    
    for (const [operator, prefixes] of Object.entries(cameroonPrefixes)) {
        if (prefixes.includes(phonePrefix)) {
            console.log(`✅ Detected operator: ${operator}`);
            console.log(`   Possible payment methods: ${operator === 'MTN' ? 'MTNCM, MOMO' : 'OMCM'}`);
        }
    }
}

// Run tests
if (require.main === module) {
    testPhoneNumberDetection();
    testPaymentMethods();
}

module.exports = { testPaymentMethods, testPhoneNumberDetection };
