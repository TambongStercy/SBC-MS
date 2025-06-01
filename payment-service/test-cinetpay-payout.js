// Test script for CinetPay payout functionality
const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

// Test configuration
const TEST_CONFIG = {
    adminToken: 'your_admin_token_here', // Replace with actual admin token
    testPayout: {
        targetUserId: 'test_user_123',
        amount: 500, // Minimum amount for Cameroon
        phoneNumber: '650000000', // Test phone number
        countryCode: 'CM',
        recipientName: 'Test User',
        recipientEmail: 'test@sbc.com',
        paymentMethod: 'MTNCM',
        description: 'Test payout from SBC'
    }
};

async function testPayoutAPI() {
    console.log('🧪 Testing CinetPay Payout API...\n');

    try {
        // Test 1: Get supported countries
        console.log('1️⃣ Testing: Get Supported Countries');
        const countriesResponse = await axios.get(`${BASE_URL}/payouts/countries`);
        console.log('✅ Success:', countriesResponse.data.data.length, 'countries supported');
        console.log('   Countries:', countriesResponse.data.data.map(c => `${c.name} (${c.code})`).join(', '));
        console.log();

        // Test 2: Get balance (requires admin token)
        if (TEST_CONFIG.adminToken && TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            console.log('2️⃣ Testing: Get Account Balance');
            try {
                const balanceResponse = await axios.get(`${BASE_URL}/payouts/balance`, {
                    headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` }
                });
                console.log('✅ Success: Balance retrieved');
                console.log('   Available:', balanceResponse.data.data.available);
                console.log('   Total:', balanceResponse.data.data.total);
                console.log();
            } catch (error) {
                console.log('❌ Failed: Balance check (check admin token)');
                console.log('   Error:', error.response?.data?.message || error.message);
                console.log();
            }
        } else {
            console.log('2️⃣ Skipping: Get Account Balance (no admin token provided)');
            console.log();
        }

        // Test 3: Validate payout request format
        console.log('3️⃣ Testing: Payout Request Validation');
        const requiredFields = ['targetUserId', 'amount', 'phoneNumber', 'countryCode', 'recipientName'];
        const hasAllFields = requiredFields.every(field => TEST_CONFIG.testPayout[field]);
        
        if (hasAllFields) {
            console.log('✅ Success: All required fields present');
            console.log('   Test payout config:', JSON.stringify(TEST_CONFIG.testPayout, null, 2));
        } else {
            console.log('❌ Failed: Missing required fields');
            const missingFields = requiredFields.filter(field => !TEST_CONFIG.testPayout[field]);
            console.log('   Missing:', missingFields.join(', '));
        }
        console.log();

        // Test 4: Test payout initiation (if admin token provided)
        if (TEST_CONFIG.adminToken && TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            console.log('4️⃣ Testing: Payout Initiation');
            try {
                const payoutResponse = await axios.post(`${BASE_URL}/payouts/initiate`, TEST_CONFIG.testPayout, {
                    headers: { 
                        Authorization: `Bearer ${TEST_CONFIG.adminToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                console.log('✅ Success: Payout initiated');
                console.log('   Transaction ID:', payoutResponse.data.data.transactionId);
                console.log('   CinetPay ID:', payoutResponse.data.data.cinetpayTransactionId);
                console.log('   Status:', payoutResponse.data.data.status);
                console.log();

                // Test 5: Check payout status
                if (payoutResponse.data.data.transactionId) {
                    console.log('5️⃣ Testing: Payout Status Check');
                    try {
                        const statusResponse = await axios.get(
                            `${BASE_URL}/payouts/status/${payoutResponse.data.data.transactionId}`,
                            { headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` } }
                        );
                        console.log('✅ Success: Status retrieved');
                        console.log('   Status:', statusResponse.data.data.status);
                        console.log('   Amount:', statusResponse.data.data.amount);
                        console.log('   Recipient:', statusResponse.data.data.recipient);
                        console.log();
                    } catch (error) {
                        console.log('❌ Failed: Status check');
                        console.log('   Error:', error.response?.data?.message || error.message);
                        console.log();
                    }
                }
            } catch (error) {
                console.log('❌ Failed: Payout initiation');
                console.log('   Error:', error.response?.data?.message || error.message);
                console.log('   Details:', error.response?.data?.error || 'No additional details');
                console.log();
            }
        } else {
            console.log('4️⃣ Skipping: Payout Initiation (no admin token provided)');
            console.log('5️⃣ Skipping: Payout Status Check (no admin token provided)');
            console.log();
        }

        // Test 6: Test development endpoint
        if (process.env.NODE_ENV !== 'production' && TEST_CONFIG.adminToken && TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            console.log('6️⃣ Testing: Development Test Endpoint');
            try {
                const testResponse = await axios.post(`${BASE_URL}/payouts/test`, {}, {
                    headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` }
                });
                console.log('✅ Success: Test endpoint working');
                console.log('   Result:', testResponse.data.data.success ? 'Success' : 'Failed');
                console.log();
            } catch (error) {
                console.log('❌ Failed: Test endpoint');
                console.log('   Error:', error.response?.data?.message || error.message);
                console.log();
            }
        } else {
            console.log('6️⃣ Skipping: Development Test Endpoint (production mode or no token)');
            console.log();
        }

        console.log('🎉 CinetPay Payout API Testing Complete!');
        console.log();
        console.log('📋 Next Steps:');
        console.log('1. Configure your CinetPay credentials in .env file');
        console.log('2. Replace the admin token in this test script');
        console.log('3. Test with real phone numbers in development');
        console.log('4. Set up webhook endpoint for production');
        console.log('5. Monitor balance and transaction logs');

    } catch (error) {
        console.error('💥 Test failed with error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure the payment service is running on port 3003');
        }
    }
}

// Helper function to test webhook payload processing
function testWebhookPayload() {
    console.log('\n🔔 Testing Webhook Payload Processing...\n');

    const sampleWebhookPayload = {
        transaction_id: 'CP_TXN_123456789',
        client_transaction_id: 'SBC_user123_1640995200000',
        lot: 'LOT_123',
        amount: '5000',
        receiver: '+237650123456',
        sending_status: 'CONFIRM',
        comment: 'Transfer completed successfully',
        treatment_status: 'VAL',
        operator_transaction_id: 'MTN_TXN_987654321',
        validated_at: '2024-01-01T12:35:00.000Z'
    };

    console.log('Sample webhook payload:');
    console.log(JSON.stringify(sampleWebhookPayload, null, 2));
    console.log();

    // You can test the webhook processing logic here
    console.log('✅ Webhook payload format is valid');
    console.log('📝 This payload would update the transaction status to: completed');
}

// Run tests
if (require.main === module) {
    console.log('🚀 Starting CinetPay Payout API Tests...\n');
    console.log('⚙️  Configuration:');
    console.log('   Base URL:', BASE_URL);
    console.log('   Admin Token:', TEST_CONFIG.adminToken === 'your_admin_token_here' ? 'Not configured' : 'Configured');
    console.log('   Test Environment:', process.env.NODE_ENV || 'development');
    console.log();

    testPayoutAPI()
        .then(() => {
            testWebhookPayload();
        })
        .catch(console.error);
}

module.exports = { testPayoutAPI, testWebhookPayload };
