const axios = require('axios');
const crypto = require('crypto');

/**
 * Test script for NOWPayments payout webhook
 * This script simulates webhook calls from NOWPayments for payout status updates
 */

// Configuration
const config = {
    baseUrl: 'http://localhost:3003', // Payment service URL
    webhookPath: '/api/payments/webhooks/nowpayments/payout',
    ipnSecret: 'your_nowpayments_ipn_secret' // Replace with your actual IPN secret
};

/**
 * Generate webhook signature for NOWPayments
 */
function generateWebhookSignature(payload, secret) {
    const payloadString = JSON.stringify(payload);
    return crypto.createHmac('sha512', secret).update(payloadString).digest('hex');
}

/**
 * Test different payout webhook scenarios
 */
async function testPayoutWebhook() {
    console.log('🧪 Testing NOWPayments Payout Webhook...\n');

    // Test scenarios with different payout statuses using actual NOWPayments API structure
    const testCases = [
        {
            name: 'Payout Creating',
            payload: {
                id: 'test_payout_123',
                address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
                currency: 'btc',
                amount: '0.001',
                batch_withdrawal_id: 'batch_789',
                status: 'creating',
                extra_id: null,
                hash: null,
                error: null,
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: null,
                created_at: new Date().toISOString(),
                requested_at: null,
                updated_at: null
            }
        },
        {
            name: 'Payout Processing',
            payload: {
                id: 'test_payout_123',
                address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
                currency: 'btc',
                amount: '0.001',
                batch_withdrawal_id: 'batch_789',
                status: 'processing',
                extra_id: null,
                hash: null,
                error: null,
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: 'Test payout',
                created_at: new Date(Date.now() - 60000).toISOString(),
                requested_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        },
        {
            name: 'Payout Sending',
            payload: {
                id: 'test_payout_123',
                address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
                currency: 'btc',
                amount: '0.001',
                batch_withdrawal_id: 'batch_789',
                status: 'sending',
                extra_id: null,
                hash: '3f7f8c2e1d4a5b6c7d8e9f0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
                error: null,
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: 'Test payout',
                created_at: new Date(Date.now() - 120000).toISOString(),
                requested_at: new Date(Date.now() - 60000).toISOString(),
                updated_at: new Date().toISOString()
            }
        },
        {
            name: 'Payout Finished (Success)',
            payload: {
                id: 'test_payout_123',
                address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
                currency: 'btc',
                amount: '0.001',
                batch_withdrawal_id: 'batch_789',
                status: 'finished',
                extra_id: null,
                hash: '3f7f8c2e1d4a5b6c7d8e9f0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
                error: null,
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: 'Test payout',
                created_at: new Date(Date.now() - 180000).toISOString(),
                requested_at: new Date(Date.now() - 120000).toISOString(),
                updated_at: new Date().toISOString()
            }
        },
        {
            name: 'Payout Failed',
            payload: {
                id: 'test_payout_456',
                address: '0x742d35cc6bf8fcaee1f9f30c2e9b8d6c5a6f4e3d',
                currency: 'eth',
                amount: '0.002',
                batch_withdrawal_id: 'batch_101',
                status: 'failed',
                extra_id: null,
                hash: null,
                error: 'Insufficient balance',
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: 'Failed test payout',
                created_at: new Date(Date.now() - 180000).toISOString(),
                requested_at: new Date(Date.now() - 120000).toISOString(),
                updated_at: new Date().toISOString()
            }
        },
        {
            name: 'Payout Rejected',
            payload: {
                id: 'test_payout_789',
                address: '0x742d35cc6bf8fcaee1f9f30c2e9b8d6c5a6f4e3d',
                currency: 'eth',
                amount: '0.003',
                batch_withdrawal_id: 'batch_102',
                status: 'rejected',
                extra_id: null,
                hash: null,
                error: 'Address validation failed',
                is_request_payouts: false,
                ipn_callback_url: null,
                unique_external_id: null,
                payout_description: 'Rejected test payout',
                created_at: new Date(Date.now() - 180000).toISOString(),
                requested_at: new Date(Date.now() - 120000).toISOString(),
                updated_at: new Date().toISOString()
            }
        },
        {
            name: 'Invalid Payload (Missing Required Fields)',
            payload: {
                address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
                status: 'finished',
                // Missing 'id' field
                amount: '0.001',
                currency: 'btc'
            }
        }
    ];

    for (const testCase of testCases) {
        try {
            console.log(`📤 Testing: ${testCase.name}`);
            console.log(`Payload:`, JSON.stringify(testCase.payload, null, 2));

            // Generate signature if IPN secret is provided
            const headers = {
                'Content-Type': 'application/json'
            };

            if (config.ipnSecret && config.ipnSecret !== 'your_nowpayments_ipn_secret') {
                const signature = generateWebhookSignature(testCase.payload, config.ipnSecret);
                headers['x-nowpayments-sig'] = signature;
                console.log(`Generated signature: ${signature}`);
            } else {
                console.log('⚠️  No IPN secret provided - signature verification will be skipped');
            }

            // Send webhook request
            const response = await axios.post(
                `${config.baseUrl}${config.webhookPath}`,
                testCase.payload,
                { headers }
            );

            console.log(`✅ Response: ${response.status} - ${JSON.stringify(response.data)}`);

        } catch (error) {
            if (error.response) {
                console.log(`❌ Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else if (error.code === 'ECONNREFUSED') {
                console.log(`❌ Error: Connection refused. Make sure payment service is running on ${config.baseUrl}`);
            } else {
                console.log(`❌ Error: ${error.message}`);
            }
        }

        console.log('-'.repeat(60));

        // Wait a bit between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n🏁 Webhook testing completed!');
    console.log('\nNotes:');
    console.log('- Make sure the payment service is running on port 3003');
    console.log('- Make sure you have test transactions in the database with matching external IDs');
    console.log('- Update the IPN secret in the config if you want to test signature verification');
    console.log('- Check the payment service logs for detailed processing information');
}

/**
 * Test individual webhook scenario
 */
async function testSingleWebhook(transactionId, status = 'finished') {
    console.log(`🧪 Testing single webhook for transaction: ${transactionId} with status: ${status}\n`);

    const payload = {
        id: transactionId,
        address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        currency: 'btc',
        amount: '0.001',
        batch_withdrawal_id: `batch_${Date.now()}`,
        status: status,
        extra_id: null,
        hash: status === 'finished' ? `hash_${Date.now()}` : null,
        error: status === 'failed' || status === 'rejected' ? 'Test error message' : null,
        is_request_payouts: false,
        ipn_callback_url: null,
        unique_external_id: null,
        payout_description: `Test payout for ${transactionId}`,
        created_at: new Date(Date.now() - 180000).toISOString(),
        requested_at: new Date(Date.now() - 120000).toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (config.ipnSecret && config.ipnSecret !== 'your_nowpayments_ipn_secret') {
            const signature = generateWebhookSignature(payload, config.ipnSecret);
            headers['x-nowpayments-sig'] = signature;
        }

        const response = await axios.post(
            `${config.baseUrl}${config.webhookPath}`,
            payload,
            { headers }
        );

        console.log(`✅ Webhook sent successfully: ${response.status} - ${JSON.stringify(response.data)}`);
    } catch (error) {
        if (error.response) {
            console.log(`❌ Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            console.log(`❌ Error: ${error.message}`);
        }
    }
}

// Command line interface
const args = process.argv.slice(2);

if (args.length > 0) {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log('NOWPayments Payout Webhook Tester\n');
        console.log('Usage:');
        console.log('  node test-nowpayments-payout-webhook.js                    # Run all test scenarios');
        console.log('  node test-nowpayments-payout-webhook.js <transactionId>   # Test specific transaction');
        console.log('  node test-nowpayments-payout-webhook.js <transactionId> <status>  # Test with specific status');
        console.log('\nAvailable statuses: waiting, confirming, confirmed, sending, finished, failed, expired');
        console.log('\nMake sure to:');
        console.log('1. Update the baseUrl if your payment service runs on a different port');
        console.log('2. Set the correct ipnSecret if you want to test signature verification');
        console.log('3. Ensure you have test transactions in your database');
    } else if (args.length === 1) {
        testSingleWebhook(args[0]);
    } else if (args.length === 2) {
        testSingleWebhook(args[0], args[1]);
    }
} else {
    testPayoutWebhook();
}