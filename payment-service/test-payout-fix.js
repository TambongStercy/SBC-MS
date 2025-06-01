// Test script to verify the payout fix
const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

// Test with the same data that was failing
const TEST_PAYOUT = {
    targetUserId: '65d2b0344a7e2b9efbf6205d',
    amount: 5000,
    phoneNumber: '675080477',
    countryCode: 'CM',
    recipientName: 'Test User',
    recipientEmail: 'test@sbc.com',
    paymentMethod: 'MTNCM',
    description: 'Test payout after fix'
};

async function testPayoutFix() {
    console.log('🧪 Testing Payout Fix...\n');

    try {
        // You'll need to replace this with a valid admin token
        const adminToken = 'your_admin_token_here';
        
        if (adminToken === 'your_admin_token_here') {
            console.log('❌ Please update the admin token in this test script');
            console.log('   Get a token by logging in as admin and copying it from the request headers');
            return;
        }

        console.log('📋 Test Payout Data:');
        console.log(JSON.stringify(TEST_PAYOUT, null, 2));
        console.log();

        console.log('🚀 Initiating payout...');
        const response = await axios.post(`${BASE_URL}/payouts/initiate`, TEST_PAYOUT, {
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Payout Response:');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));

        if (response.data.success) {
            console.log('\n🎉 Payout initiated successfully!');
            console.log('Transaction ID:', response.data.data.transactionId);
            console.log('CinetPay ID:', response.data.data.cinetpayTransactionId);
            console.log('Status:', response.data.data.status);
        } else {
            console.log('\n❌ Payout failed:', response.data.message);
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure the payment service is running on port 3003');
        }
    }
}

// Test the nested array parsing logic
function testNestedArrayParsing() {
    console.log('\n🔍 Testing Nested Array Parsing Logic...\n');

    // Simulate CinetPay response formats
    const testCases = [
        {
            name: 'Nested Array Format (actual CinetPay response)',
            response: {
                code: 0,
                data: [[{
                    prefix: "237",
                    phone: "675080477",
                    code: 726,
                    status: "ERROR_PHONE_ALREADY_MY_CONTACT"
                }]]
            }
        },
        {
            name: 'Direct Array Format (alternative)',
            response: {
                code: 0,
                data: [{
                    prefix: "237",
                    phone: "675080477",
                    code: 0,
                    status: "SUCCESS"
                }]
            }
        }
    ];

    testCases.forEach(testCase => {
        console.log(`Testing: ${testCase.name}`);
        
        const response = testCase.response;
        let contactResult;
        
        if (Array.isArray(response.data[0])) {
            contactResult = response.data[0][0];
            console.log('  ✅ Used nested array parsing: data[0][0]');
        } else {
            contactResult = response.data[0];
            console.log('  ✅ Used direct array parsing: data[0]');
        }
        
        console.log('  Result:', contactResult);
        console.log('  Code:', contactResult.code);
        console.log('  Status:', contactResult.status);
        console.log();
    });
}

// Run tests
if (require.main === module) {
    testNestedArrayParsing();
    testPayoutFix();
}

module.exports = { testPayoutFix, testNestedArrayParsing };
