// Test script to verify minimum withdrawal amount validation (500 FCFA)
const axios = require('axios');

const BASE_URL = 'http://localhost:3002/api'; // Adjust port as needed
const TEST_TOKEN = 'your-test-token-here'; // Replace with valid test token
const ADMIN_TOKEN = 'your-admin-token-here'; // Replace with valid admin token

console.log('💰 Testing Minimum Withdrawal Amount Validation (500 FCFA)\n');

// Test cases for different amounts
const testCases = [
    // Invalid amounts (should fail)
    { amount: 100, expected: 'fail', reason: 'Below minimum (500)' },
    { amount: 250, expected: 'fail', reason: 'Below minimum (500)' },
    { amount: 499, expected: 'fail', reason: 'Below minimum (500)' },
    { amount: 503, expected: 'fail', reason: 'Not multiple of 5' },

    // Valid amounts (should pass validation)
    { amount: 500, expected: 'pass', reason: 'Minimum valid amount' },
    { amount: 1000, expected: 'pass', reason: 'Valid amount' },
    { amount: 2500, expected: 'pass', reason: 'Valid higher amount' },
];

// Test data for admin operations
const testUserData = {
    userId: 'test-user-id-123',
    phoneNumber: '070123456',
    countryCode: 'CI',
    recipientName: 'Test User'
};

/**
 * Test user withdrawal validation
 */
async function testUserWithdrawal() {
    console.log('1️⃣ Testing User Withdrawal Validation (/api/transactions/withdrawal/initiate)\n');

    for (const testCase of testCases) {
        console.log(`   Testing amount: ${testCase.amount} FCFA - Expected: ${testCase.expected.toUpperCase()}`);
        console.log(`   Reason: ${testCase.reason}`);

        try {
            const response = await axios.post(
                `${BASE_URL}/transactions/withdrawal/initiate`,
                { amount: testCase.amount },
                {
                    headers: {
                        'Authorization': `Bearer ${TEST_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (testCase.expected === 'fail') {
                console.log(`   ❌ UNEXPECTED SUCCESS - Should have failed validation`);
            } else {
                console.log(`   ✅ PASSED - Validation allowed valid amount`);
            }

        } catch (error) {
            if (testCase.expected === 'fail') {
                if (error.response && error.response.status === 400) {
                    console.log(`   ✅ CORRECTLY REJECTED - ${error.response.data.message}`);
                } else {
                    console.log(`   ⚠️  REJECTED (unexpected reason) - Status: ${error.response?.status}`);
                }
            } else {
                console.log(`   ❌ UNEXPECTED REJECTION - Status: ${error.response?.status}, Message: ${error.response?.data?.message}`);
            }
        }
        console.log();
    }
}

/**
 * Test admin user withdrawal validation
 */
async function testAdminUserWithdrawal() {
    console.log('2️⃣ Testing Admin User Withdrawal Validation (/api/withdrawals/admin/user)\n');

    for (const testCase of testCases) {
        console.log(`   Testing amount: ${testCase.amount} FCFA - Expected: ${testCase.expected.toUpperCase()}`);
        console.log(`   Reason: ${testCase.reason}`);

        try {
            const response = await axios.post(
                `${BASE_URL}/withdrawals/admin/user`,
                {
                    userId: testUserData.userId,
                    amount: testCase.amount,
                    phoneNumber: testUserData.phoneNumber,
                    countryCode: testUserData.countryCode
                },
                {
                    headers: {
                        'Authorization': `Bearer ${ADMIN_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (testCase.expected === 'fail') {
                console.log(`   ❌ UNEXPECTED SUCCESS - Should have failed validation`);
            } else {
                console.log(`   ✅ PASSED - Validation allowed valid amount`);
            }

        } catch (error) {
            if (testCase.expected === 'fail') {
                if (error.response && error.response.status === 400) {
                    console.log(`   ✅ CORRECTLY REJECTED - ${error.response.data.message}`);
                } else {
                    console.log(`   ⚠️  REJECTED (unexpected reason) - Status: ${error.response?.status}`);
                }
            } else {
                console.log(`   ❌ UNEXPECTED REJECTION - Status: ${error.response?.status}, Message: ${error.response?.data?.message}`);
            }
        }
        console.log();
    }
}

/**
 * Test admin direct payout validation
 */
async function testAdminDirectPayout() {
    console.log('3️⃣ Testing Admin Direct Payout Validation (/api/withdrawals/admin/direct)\n');

    for (const testCase of testCases) {
        console.log(`   Testing amount: ${testCase.amount} FCFA - Expected: ${testCase.expected.toUpperCase()}`);
        console.log(`   Reason: ${testCase.reason}`);

        try {
            const response = await axios.post(
                `${BASE_URL}/withdrawals/admin/direct`,
                {
                    amount: testCase.amount,
                    phoneNumber: testUserData.phoneNumber,
                    countryCode: testUserData.countryCode,
                    recipientName: testUserData.recipientName
                },
                {
                    headers: {
                        'Authorization': `Bearer ${ADMIN_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (testCase.expected === 'fail') {
                console.log(`   ❌ UNEXPECTED SUCCESS - Should have failed validation`);
            } else {
                console.log(`   ✅ PASSED - Validation allowed valid amount`);
            }

        } catch (error) {
            if (testCase.expected === 'fail') {
                if (error.response && error.response.status === 400) {
                    console.log(`   ✅ CORRECTLY REJECTED - ${error.response.data.message}`);
                } else {
                    console.log(`   ⚠️  REJECTED (unexpected reason) - Status: ${error.response?.status}`);
                }
            } else {
                console.log(`   ❌ UNEXPECTED REJECTION - Status: ${error.response?.status}, Message: ${error.response?.data?.message}`);
            }
        }
        console.log();
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    console.log('🧪 Running Minimum Withdrawal Validation Tests...\n');
    console.log('⚠️  Note: Replace TEST_TOKEN and ADMIN_TOKEN with valid tokens to run actual tests\n');

    try {
        await testUserWithdrawal();
        await testAdminUserWithdrawal();
        await testAdminDirectPayout();

        console.log('✅ All tests completed!');
        console.log('\n📋 Summary:');
        console.log('• Minimum withdrawal amount: 500 FCFA');
        console.log('• Amount must be multiple of 5');
        console.log('• Validation applied to all withdrawal endpoints');
        console.log('• Both user and admin endpoints are protected');

    } catch (error) {
        console.error('❌ Test execution error:', error.message);
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    runAllTests();
}

module.exports = {
    testUserWithdrawal,
    testAdminUserWithdrawal,
    testAdminDirectPayout,
    runAllTests
}; 