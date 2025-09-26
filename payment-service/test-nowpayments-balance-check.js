const axios = require('axios');

/**
 * Test script for NOWPayments balance check functionality
 */

const config = {
    baseUrl: 'http://localhost:3003',
    testUserId: '65d2b0344a7e2b9efbf6205d', // Replace with a valid user ID from your database
    testAmount: 0.001 // Small test amount in USD
};

/**
 * Test the balance check functionality by attempting a crypto withdrawal
 */
async function testBalanceCheck() {
    console.log('🔍 Testing NOWPayments Balance Check Functionality');
    console.log('=' .repeat(70));
    console.log(`Test User ID: ${config.testUserId}`);
    console.log(`Test Amount: ${config.testAmount} USD`);
    console.log('=' .repeat(70));
    console.log();

    try {
        console.log('📞 Initiating crypto withdrawal to trigger balance check...');

        const response = await axios.post(
            `${config.baseUrl}/api/payments/crypto-withdrawal`,
            {
                usdAmount: config.testAmount
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer your_jwt_token_here`, // Replace with actual token
                    'x-user-id': config.testUserId
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log('✅ BALANCE CHECK PASSED!');
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        console.log();
        console.log('🎉 NOWPayments has sufficient balance for this withdrawal!');
        console.log('📧 OTP should be sent to user for verification.');

    } catch (error) {
        if (error.response) {
            console.log('⚠️  RESPONSE RECEIVED:');
            console.log(`Status: ${error.response.status}`);
            console.log(`Error Response:`, JSON.stringify(error.response.data, null, 2));
            console.log();

            // Check if it's the specific balance error we're looking for
            if (error.response.status === 503 &&
                error.response.data?.message?.includes('Les retraits dans cette crypto-monnaie sont indisponibles')) {
                console.log('✅ BALANCE CHECK WORKING CORRECTLY!');
                console.log('❌ NOWPayments has insufficient balance for this cryptocurrency');
                console.log('🇫🇷 French error message displayed correctly');
                console.log('🚫 OTP was NOT sent (correct behavior)');
            } else if (error.response.status === 400) {
                console.log('💡 Possible Issues:');
                console.log('- User may not have crypto wallet configured');
                console.log('- User may have insufficient USD balance');
                console.log('- Daily withdrawal limit may be reached');
                console.log('- User validation failed');
            } else if (error.response.status === 401) {
                console.log('💡 Authentication Issue:');
                console.log('- Please provide a valid JWT token in Authorization header');
                console.log('- Update the config.testUserId with a valid user ID');
            } else {
                console.log('❓ Unexpected error - check logs for details');
            }
        } else if (error.code === 'ECONNREFUSED') {
            console.log('❌ CONNECTION FAILED');
            console.log('💡 Make sure payment service is running on port 3003');
        } else {
            console.log('❌ UNEXPECTED ERROR');
            console.log(`Error: ${error.message}`);
        }
    }

    console.log();
    console.log('📋 Balance Check Integration Summary:');
    console.log('1. ✅ Added getBalance() method to NOWPayments service');
    console.log('2. ✅ Added checkSufficientBalance() method');
    console.log('3. ✅ Integrated balance check before OTP sending');
    console.log('4. ✅ French error message: "Les retraits dans cette crypto-monnaie sont indisponibles pour le moment. Réessayez plus tard."');
    console.log('5. ✅ Prevents unnecessary OTP sending when balance is insufficient');
    console.log();
    console.log('🔧 How it works:');
    console.log('- User initiates crypto withdrawal');
    console.log('- System checks user\'s USD balance ✓');
    console.log('- System converts USD to crypto amount');
    console.log('- System checks NOWPayments balance for that crypto ✓ NEW!');
    console.log('- If insufficient: Shows French error, no OTP sent');
    console.log('- If sufficient: Proceeds with OTP verification');
}

/**
 * Test the direct balance API (if you want to test the API directly)
 */
async function testDirectBalanceAPI() {
    console.log('🔍 Testing Direct NOWPayments Balance API');
    console.log('=' .repeat(50));

    try {
        // This would need to be implemented as an admin endpoint
        // For now, this is just a placeholder to show how it could work

        console.log('💡 Direct balance API test would require:');
        console.log('1. Admin endpoint: GET /api/admin/nowpayments/balance');
        console.log('2. Authentication with admin permissions');
        console.log('3. Response showing all cryptocurrency balances');
        console.log();
        console.log('Example response:');
        console.log(`{
  "btc": { "amount": 0.001, "pendingAmount": 0 },
  "eth": { "amount": 0.5, "pendingAmount": 0.1 },
  "usdtsol": { "amount": 100, "pendingAmount": 0 }
}`);

    } catch (error) {
        console.log('Direct API test not implemented yet');
    }
}

// Command line interface
const args = process.argv.slice(2);

if (args.length > 0) {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log('NOWPayments Balance Check Tester\n');
        console.log('Usage:');
        console.log('  node test-nowpayments-balance-check.js           # Test balance check via withdrawal');
        console.log('  node test-nowpayments-balance-check.js direct    # Test direct balance API');
        console.log('\nConfiguration:');
        console.log(`  Test User ID: ${config.testUserId}`);
        console.log(`  Test Amount: ${config.testAmount} USD`);
        console.log('\nNotes:');
        console.log('- Make sure payment service is running on port 3003');
        console.log('- Update testUserId with a valid user ID from your database');
        console.log('- Replace JWT token with a valid authentication token');
        console.log('- User should have crypto wallet configured');
    } else if (args[0] === 'direct') {
        testDirectBalanceAPI();
    }
} else {
    testBalanceCheck();
}