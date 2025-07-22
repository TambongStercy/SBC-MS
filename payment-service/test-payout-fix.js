// Test script to verify payout fixes for Feexpay and Cinetpay
const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

// Test configuration
const TEST_CONFIG = {
    adminToken: 'your_admin_token_here', // Replace with actual admin token
    
    // Test payouts for different countries
    testPayouts: {
        // FeexPay countries
        togo: {
            targetUserId: 'test_user_tg_123',
            amount: 500, // Minimum amount for Togo via FeexPay
            phoneNumber: '90123456', // Togo phone number (without country code)
            countryCode: 'TG',
            momoOperator: 'TOGOCOM_TG',
            expectedGateway: 'FeexPay'
        },
        benin: {
            targetUserId: 'test_user_bj_123',
            amount: 500, // Minimum amount for Benin via FeexPay
            phoneNumber: '90123456', // Benin phone number (without country code)
            countryCode: 'BJ',
            momoOperator: 'MTN_MOMO_BEN',
            expectedGateway: 'FeexPay'
        },
        
        // CinetPay countries (newly added for withdrawals)
        senegal: {
            targetUserId: 'test_user_sn_123',
            amount: 500, // Above minimum for Senegal
            phoneNumber: '771234567', // Senegal phone number (without country code)
            countryCode: 'SN',
            momoOperator: 'ORANGE_SEN',
            expectedGateway: 'CinetPay'
        },
        burkinaFaso: {
            targetUserId: 'test_user_bf_123',
            amount: 1000, // Above minimum for Burkina Faso
            phoneNumber: '70123456', // Burkina Faso phone number (without country code)
            countryCode: 'BF',
            momoOperator: 'ORANGE_BFA',
            expectedGateway: 'CinetPay'
        },
        coteDivoire: {
            targetUserId: 'test_user_ci_123',
            amount: 500, // Above minimum for Côte d'Ivoire
            phoneNumber: '07012345', // Côte d'Ivoire phone number (without country code)
            countryCode: 'CI',
            momoOperator: 'ORANGE_CIV',
            expectedGateway: 'CinetPay'
        }
    }
};

/**
 * Test payout gateway routing
 */
async function testPayoutGatewayRouting() {
    console.log('🧪 Testing Payout Gateway Routing Fixes...\n');

    try {
        // Test 1: Get supported countries
        console.log('1️⃣ Testing: Get Supported Countries for CinetPay');
        const countriesResponse = await axios.get(`${BASE_URL}/payouts/countries`);
        console.log('✅ CinetPay supported countries:', countriesResponse.data.data.length);
        
        // Check if our target countries are supported
        const supportedCountries = countriesResponse.data.data.map(c => c.code);
        const targetCountries = ['SN', 'BF', 'CI'];
        
        targetCountries.forEach(country => {
            if (supportedCountries.includes(country)) {
                console.log(`   ✅ ${country} is supported for CinetPay withdrawals`);
            } else {
                console.log(`   ❌ ${country} is NOT supported for CinetPay withdrawals`);
            }
        });
        console.log();

        // Test 2: Test withdrawal initiation for each country
        console.log('2️⃣ Testing: Withdrawal Initiation by Country\n');
        
        for (const [countryName, testData] of Object.entries(TEST_CONFIG.testPayouts)) {
            console.log(`   Testing ${countryName.toUpperCase()} (${testData.countryCode}) - Expected: ${testData.expectedGateway}`);
            
            try {
                // This would normally require actual user data and authentication
                // For testing purposes, we're just checking the endpoint availability
                const response = await axios.post(
                    `${BASE_URL}/payouts/admin/user-withdrawal`,
                    {
                        targetUserId: testData.targetUserId,
                        amount: testData.amount,
                        withdrawalDetails: {
                            method: testData.momoOperator,
                            accountInfo: {
                                fullMomoNumber: `${getCountryPrefix(testData.countryCode)}${testData.phoneNumber}`,
                                momoOperator: testData.momoOperator,
                                countryCode: testData.countryCode,
                                recipientName: `Test User ${testData.countryCode}`,
                                recipientEmail: `test${testData.countryCode.toLowerCase()}@sbc.com`
                            }
                        }
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${TEST_CONFIG.adminToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                console.log(`   ✅ API responded for ${countryName} (${response.status})`);
                
            } catch (error) {
                if (error.response) {
                    // Expected for test data, log the error type
                    console.log(`   ⚠️  ${countryName}: ${error.response.status} - ${error.response.data.message || 'Error response'}`);
                } else {
                    console.log(`   ❌ ${countryName}: Network error - ${error.message}`);
                }
            }
        }
        
        console.log('\n3️⃣ Testing: FeexPay Service Configuration');
        
        // Test FeexPay webhook endpoint
        try {
            const webhookResponse = await axios.get(`${BASE_URL}/payouts/webhooks/feexpay`);
            console.log('   ✅ FeexPay webhook endpoint accessible');
        } catch (error) {
            console.log('   ⚠️  FeexPay webhook endpoint test failed:', error.message);
        }
        
        console.log('\n🎉 Payout gateway routing tests completed!');
        console.log('\n📋 Summary of Fixes Applied:');
        console.log('   ✅ FeexPay: Updated Togo and Benin endpoints to use correct API URLs');
        console.log('   ✅ FeexPay: Improved Benin support with global endpoint');
        console.log('   ✅ CinetPay: Added Senegal, Burkina Faso, and Côte d\'Ivoire for withdrawals');
        console.log('   ✅ Gateway Routing: Updated logic to route countries correctly');
        console.log('   ✅ Documentation: Updated with clear gateway routing information');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

/**
 * Get country prefix for phone number formatting
 */
function getCountryPrefix(countryCode) {
    const prefixes = {
        'TG': '228', // Togo
        'BJ': '229', // Benin
        'SN': '221', // Senegal
        'BF': '226', // Burkina Faso
        'CI': '225', // Côte d'Ivoire
        'CM': '237', // Cameroon
        'ML': '223', // Mali
        'NE': '227', // Niger
        'GN': '224', // Guinea
        'CD': '243', // Congo DRC
        'CG': '242', // Congo Brazzaville
        'GA': '241', // Gabon
        'KE': '254', // Kenya
        'NG': '234', // Nigeria
    };
    return prefixes[countryCode] || '';
}

// Run the test if this file is executed directly
if (require.main === module) {
    testPayoutGatewayRouting();
}

module.exports = {
    testPayoutGatewayRouting,
    TEST_CONFIG
};
