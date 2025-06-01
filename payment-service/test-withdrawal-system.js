// Test script for the new withdrawal system
const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

// Test configuration
const TEST_CONFIG = {
    userToken: 'your_user_token_here',
    adminToken: 'your_admin_token_here',
    testUserId: '65d2b0344a7e2b9efbf6205d',
    testAmount: 500
};

async function testWithdrawalSystem() {
    console.log('🧪 Testing SBC Withdrawal System...\n');

    try {
        // Test 1: User Withdrawal
        console.log('1️⃣ Testing: User Withdrawal');
        if (TEST_CONFIG.userToken !== 'your_user_token_here') {
            try {
                const userWithdrawalResponse = await axios.post(`${BASE_URL}/withdrawals/user`,
                    { amount: TEST_CONFIG.testAmount },
                    { headers: { Authorization: `Bearer ${TEST_CONFIG.userToken}` } }
                );
                console.log('✅ User withdrawal successful');
                console.log('   Transaction ID:', userWithdrawalResponse.data.data.transactionId);
                console.log('   Amount:', userWithdrawalResponse.data.data.amount);
                console.log('   Recipient:', userWithdrawalResponse.data.data.recipient);
            } catch (error) {
                console.log('❌ User withdrawal failed:', error.response?.data?.message || error.message);
            }
        } else {
            console.log('⏭️  Skipping: No user token provided');
        }
        console.log();

        // Test 2: Admin User Withdrawal (Normal)
        console.log('2️⃣ Testing: Admin User Withdrawal (Normal)');
        if (TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            try {
                const adminUserWithdrawalResponse = await axios.post(`${BASE_URL}/withdrawals/admin/user`,
                    {
                        userId: TEST_CONFIG.testUserId,
                        amount: TEST_CONFIG.testAmount
                    },
                    { headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` } }
                );
                console.log('✅ Admin user withdrawal successful');
                console.log('   Transaction ID:', adminUserWithdrawalResponse.data.data.transactionId);
                console.log('   Target User:', adminUserWithdrawalResponse.data.data.targetUser.name);
                console.log('   Amount:', adminUserWithdrawalResponse.data.data.amount);
                console.log('   Is Override:', adminUserWithdrawalResponse.data.data.isOverride);
            } catch (error) {
                console.log('❌ Admin user withdrawal failed:', error.response?.data?.message || error.message);
            }
        } else {
            console.log('⏭️  Skipping: No admin token provided');
        }
        console.log();

        // Test 2b: Admin User Withdrawal (Override)
        console.log('2️⃣b Testing: Admin User Withdrawal (Override)');
        if (TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            try {
                const adminOverrideWithdrawalResponse = await axios.post(`${BASE_URL}/withdrawals/admin/user`,
                    {
                        userId: TEST_CONFIG.testUserId,
                        amount: TEST_CONFIG.testAmount,
                        phoneNumber: '675080477',
                        countryCode: 'CM',
                        recipientName: 'Override Test Recipient'
                    },
                    { headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` } }
                );
                console.log('✅ Admin override withdrawal successful');
                console.log('   Transaction ID:', adminOverrideWithdrawalResponse.data.data.transactionId);
                console.log('   Target User:', adminOverrideWithdrawalResponse.data.data.targetUser.name);
                console.log('   Amount:', adminOverrideWithdrawalResponse.data.data.amount);
                console.log('   Is Override:', adminOverrideWithdrawalResponse.data.data.isOverride);
                if (adminOverrideWithdrawalResponse.data.data.overrideDetails) {
                    console.log('   Original Momo:', adminOverrideWithdrawalResponse.data.data.overrideDetails.originalMomo);
                    console.log('   Override Recipient:', adminOverrideWithdrawalResponse.data.data.overrideDetails.overrideRecipient);
                }
            } catch (error) {
                console.log('❌ Admin override withdrawal failed:', error.response?.data?.message || error.message);
            }
        } else {
            console.log('⏭️  Skipping: No admin token provided');
        }
        console.log();

        // Test 3: Admin Direct Payout
        console.log('3️⃣ Testing: Admin Direct Payout');
        if (TEST_CONFIG.adminToken !== 'your_admin_token_here') {
            try {
                const adminDirectPayoutResponse = await axios.post(`${BASE_URL}/withdrawals/admin/direct`,
                    {
                        amount: TEST_CONFIG.testAmount,
                        phoneNumber: '675080477',
                        countryCode: 'CM',
                        recipientName: 'Test Recipient',
                        recipientEmail: 'test@sbc.com',
                        description: 'Test direct payout'
                    },
                    { headers: { Authorization: `Bearer ${TEST_CONFIG.adminToken}` } }
                );
                console.log('✅ Admin direct payout successful');
                console.log('   Transaction ID:', adminDirectPayoutResponse.data.data.transactionId);
                console.log('   Recipient:', adminDirectPayoutResponse.data.data.recipient);
                console.log('   Note:', adminDirectPayoutResponse.data.data.note);
            } catch (error) {
                console.log('❌ Admin direct payout failed:', error.response?.data?.message || error.message);
            }
        } else {
            console.log('⏭️  Skipping: No admin token provided');
        }
        console.log();

        // Test 4: Validation Tests
        console.log('4️⃣ Testing: Input Validation');

        // Test invalid amount
        try {
            await axios.post(`${BASE_URL}/withdrawals/user`,
                { amount: 100 }, // Below minimum
                { headers: { Authorization: `Bearer ${TEST_CONFIG.userToken || 'dummy'}` } }
            );
        } catch (error) {
            if (error.response?.status === 400) {
                console.log('✅ Minimum amount validation working');
                console.log('   Error:', error.response.data.message);
            }
        }

        // Test non-multiple of 5
        try {
            await axios.post(`${BASE_URL}/withdrawals/user`,
                { amount: 503 }, // Not multiple of 5
                { headers: { Authorization: `Bearer ${TEST_CONFIG.userToken || 'dummy'}` } }
            );
        } catch (error) {
            if (error.response?.status === 400) {
                console.log('✅ Multiple of 5 validation working');
                console.log('   Error:', error.response.data.message);
            }
        }

        console.log();

        // Test 5: Country Code Detection
        console.log('5️⃣ Testing: Country Code Detection Logic');
        testCountryCodeDetection();

        console.log('\n🎉 Withdrawal System Testing Complete!');
        console.log();
        console.log('📋 Next Steps:');
        console.log('1. Configure user tokens in this test script');
        console.log('2. Ensure users have momoNumber and momoOperator configured');
        console.log('3. Test with real user accounts');
        console.log('4. Test admin override feature for problem resolution');
        console.log('5. Monitor transaction logs and webhook notifications');
        console.log();
        console.log('🔧 Admin Override Feature:');
        console.log('- Withdraw from user account but send to different number');
        console.log('- Useful for wrong numbers, account issues, emergencies');
        console.log('- Full audit trail with original vs override details');
        console.log('- Requires both phoneNumber and countryCode when using override');

    } catch (error) {
        console.error('💥 Test failed with error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure the payment service is running on port 3003');
        }
    }
}

function testCountryCodeDetection() {
    const testNumbers = [
        { momoNumber: '237675080477', expected: 'CM', operator: 'MTN' },
        { momoNumber: '237655123456', expected: 'CM', operator: 'ORANGE' },
        { momoNumber: '225070123456', expected: 'CI', operator: 'ORANGE' },
        { momoNumber: '221771234567', expected: 'SN', operator: 'ORANGE' },
        { momoNumber: '228901234567', expected: 'TG', operator: 'TMONEY' },
        { momoNumber: '229901234567', expected: 'BJ', operator: 'MTN' },
        { momoNumber: '223701234567', expected: 'ML', operator: 'ORANGE' },
        { momoNumber: '226701234567', expected: 'BF', operator: 'ORANGE' },
        { momoNumber: '224621234567', expected: 'GN', operator: 'ORANGE' },
        { momoNumber: '243901234567', expected: 'CD', operator: 'ORANGE' }
    ];

    const countryPrefixes = {
        '225': 'CI', '221': 'SN', '237': 'CM', '228': 'TG',
        '229': 'BJ', '223': 'ML', '226': 'BF', '224': 'GN', '243': 'CD'
    };

    console.log('   Testing country code detection:');
    testNumbers.forEach(test => {
        const cleanNumber = test.momoNumber.replace(/\D/g, '');
        let detectedCountry = null;

        for (const [prefix, code] of Object.entries(countryPrefixes)) {
            if (cleanNumber.startsWith(prefix)) {
                detectedCountry = code;
                break;
            }
        }

        const result = detectedCountry === test.expected ? '✅' : '❌';
        console.log(`   ${result} ${test.momoNumber} → ${detectedCountry} (${test.operator})`);
    });
}

function testPhoneNumberExtraction() {
    console.log('\n📱 Testing Phone Number Extraction:');

    const testCases = [
        { momoNumber: '237675080477', countryCode: 'CM', expected: '675080477' },
        { momoNumber: '225070123456', countryCode: 'CI', expected: '070123456' },
        { momoNumber: '221771234567', countryCode: 'SN', expected: '771234567' }
    ];

    const countryPrefixes = {
        'CI': '225', 'SN': '221', 'CM': '237', 'TG': '228',
        'BJ': '229', 'ML': '223', 'BF': '226', 'GN': '224', 'CD': '243'
    };

    testCases.forEach(test => {
        const prefix = countryPrefixes[test.countryCode];
        const cleanNumber = test.momoNumber.replace(/\D/g, '');
        let phoneNumber = cleanNumber;

        if (prefix && cleanNumber.startsWith(prefix)) {
            phoneNumber = cleanNumber.substring(prefix.length);
        }

        const result = phoneNumber === test.expected ? '✅' : '❌';
        console.log(`   ${result} ${test.momoNumber} (${test.countryCode}) → ${phoneNumber}`);
    });
}

// Run tests
if (require.main === module) {
    console.log('🚀 Starting SBC Withdrawal System Tests...\n');
    console.log('⚙️  Configuration:');
    console.log('   Base URL:', BASE_URL);
    console.log('   User Token:', TEST_CONFIG.userToken === 'your_user_token_here' ? 'Not configured' : 'Configured');
    console.log('   Admin Token:', TEST_CONFIG.adminToken === 'your_admin_token_here' ? 'Not configured' : 'Configured');
    console.log('   Test User ID:', TEST_CONFIG.testUserId);
    console.log('   Test Amount:', TEST_CONFIG.testAmount);
    console.log();

    testWithdrawalSystem()
        .then(() => {
            testPhoneNumberExtraction();
        })
        .catch(console.error);
}

module.exports = { testWithdrawalSystem, testCountryCodeDetection, testPhoneNumberExtraction };
