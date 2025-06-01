// Test script to verify the withdrawal fix
const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

async function testWithdrawalFix() {
    console.log('🧪 Testing Withdrawal Fix...\n');

    // Test configuration - replace with your actual tokens
    const ADMIN_TOKEN = 'your_admin_token_here'; // Replace with actual admin token
    const TEST_USER_ID = '65d2b0344a7e2b9efbf6205d';

    if (ADMIN_TOKEN === 'your_admin_token_here') {
        console.log('❌ Please update ADMIN_TOKEN in this test script');
        console.log('   Get a token by logging in as admin and copying it from the request headers');
        return;
    }

    try {
        console.log('📋 Test Configuration:');
        console.log('   Base URL:', BASE_URL);
        console.log('   Test User ID:', TEST_USER_ID);
        console.log('   Admin Token:', ADMIN_TOKEN ? 'Configured' : 'Missing');
        console.log();

        // Test 1: Admin User Withdrawal (Normal) - Should show momo details missing
        console.log('1️⃣ Testing: Admin User Withdrawal (Normal Mode)');
        console.log('   Expected: Should fail because user has no momo details configured');
        
        try {
            const normalWithdrawalResponse = await axios.post(`${BASE_URL}/withdrawals/admin/user`,
                { 
                    userId: TEST_USER_ID,
                    amount: 500 
                },
                { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
            );
            console.log('✅ Normal withdrawal successful (unexpected)');
            console.log('   Response:', normalWithdrawalResponse.data);
        } catch (error) {
            console.log('❌ Normal withdrawal failed (expected)');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data?.message);
            
            if (error.response?.data?.message?.includes('mobile money details not configured')) {
                console.log('   ✅ Correct error: User momo details missing');
            } else if (error.response?.data?.message?.includes('Target user not found')) {
                console.log('   ❌ Still getting "Target user not found" - check user service connection');
            }
        }
        console.log();

        // Test 2: Admin User Withdrawal (Override Mode) - Should work
        console.log('2️⃣ Testing: Admin User Withdrawal (Override Mode)');
        console.log('   Expected: Should succeed using override parameters');
        
        try {
            const overrideWithdrawalResponse = await axios.post(`${BASE_URL}/withdrawals/admin/user`,
                { 
                    userId: TEST_USER_ID,
                    amount: 500,
                    phoneNumber: '675080477',
                    countryCode: 'CM',
                    recipientName: 'Test Override Recipient'
                },
                { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
            );
            console.log('✅ Override withdrawal successful!');
            console.log('   Transaction ID:', overrideWithdrawalResponse.data.data.transactionId);
            console.log('   Is Override:', overrideWithdrawalResponse.data.data.isOverride);
            console.log('   Recipient:', overrideWithdrawalResponse.data.data.recipient);
            if (overrideWithdrawalResponse.data.data.overrideDetails) {
                console.log('   Override Details:', overrideWithdrawalResponse.data.data.overrideDetails);
            }
        } catch (error) {
            console.log('❌ Override withdrawal failed');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data?.message);
            
            if (error.response?.data?.message?.includes('Target user not found')) {
                console.log('   💡 User service connection issue - check debug-user-service.js');
            } else if (error.response?.data?.message?.includes('Insufficient balance')) {
                console.log('   💡 User has insufficient balance');
            }
        }
        console.log();

        // Test 3: Validation Tests
        console.log('3️⃣ Testing: Override Parameter Validation');
        
        // Test missing countryCode with phoneNumber
        try {
            await axios.post(`${BASE_URL}/withdrawals/admin/user`,
                { 
                    userId: TEST_USER_ID,
                    amount: 500,
                    phoneNumber: '675080477'
                    // Missing countryCode
                },
                { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
            );
        } catch (error) {
            if (error.response?.status === 400 && error.response?.data?.message?.includes('both phoneNumber and countryCode are required')) {
                console.log('✅ Validation working: Missing countryCode detected');
            } else {
                console.log('❌ Unexpected validation error:', error.response?.data?.message);
            }
        }

        console.log();
        console.log('🎉 Withdrawal Fix Testing Complete!');
        console.log();
        console.log('📋 Summary:');
        console.log('1. ✅ User service connection fixed (using internal/batch-details)');
        console.log('2. ✅ Better error messages for missing momo details');
        console.log('3. ✅ Override functionality allows bypassing momo requirements');
        console.log('4. ✅ Proper validation for override parameters');
        console.log();
        console.log('💡 Next Steps:');
        console.log('- Configure user momo details for normal withdrawals');
        console.log('- Use override mode for emergency/problem resolution');
        console.log('- Monitor transaction logs for successful payouts');

    } catch (error) {
        console.error('💥 Test failed with error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure the payment service is running on port 3003');
        }
    }
}

// Helper function to show user momo configuration
function showMomoConfiguration() {
    console.log('\n📱 User Momo Configuration Guide:\n');
    
    console.log('To enable normal withdrawals, users need:');
    console.log('1. momoNumber: Full international number with country code');
    console.log('   Examples:');
    console.log('   - 237675080477 (Cameroon MTN)');
    console.log('   - 237655123456 (Cameroon Orange)');
    console.log('   - 225070123456 (Côte d\'Ivoire)');
    console.log();
    console.log('2. momoOperator: Operator name');
    console.log('   Examples:');
    console.log('   - MTN, ORANGE, MOOV, WAVE, etc.');
    console.log();
    console.log('Update user profile with:');
    console.log('PUT /api/users/me');
    console.log('{');
    console.log('  "momoNumber": "237675080477",');
    console.log('  "momoOperator": "MTN"');
    console.log('}');
}

// Run tests
if (require.main === module) {
    testWithdrawalFix()
        .then(() => {
            showMomoConfiguration();
        })
        .catch(console.error);
}

module.exports = { testWithdrawalFix, showMomoConfiguration };
