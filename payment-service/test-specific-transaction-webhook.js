const axios = require('axios');
const crypto = require('crypto');

/**
 * Test script to simulate NOWPayments payout webhook for specific transaction
 * Transaction ID: ppOpT6bjoTqVxNHv
 * External Transaction ID: 5004469882
 * Current Status: processing -> will simulate finished
 */

// Configuration
const config = {
    baseUrl: 'http://localhost:3003', // Payment service URL
    webhookPath: '/api/payments/webhooks/nowpayments/payout',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '' // Use actual IPN secret from env if available
};

/**
 * Generate webhook signature for NOWPayments
 */
function generateWebhookSignature(payload, secret) {
    if (!secret) return null;
    const payloadString = JSON.stringify(payload);
    return crypto.createHmac('sha512', secret).update(payloadString).digest('hex');
}

/**
 * Simulate webhook for the specific transaction
 */
async function testSpecificTransactionWebhook() {
    console.log('🎯 Testing NOWPayments Payout Webhook for Specific Transaction');
    console.log('=' .repeat(70));
    console.log(`Transaction ID: ppOpT6bjoTqVxNHv`);
    console.log(`External ID: 5004469882`);
    console.log(`Current Status: processing -> simulating: finished`);
    console.log('=' .repeat(70));
    console.log();

    // Create webhook payload based on the actual transaction data
    const webhookPayload = {
        id: "5004469882", // The external transaction ID
        address: "9FhKECkr9WjQ3abMeb1BR2kJUsDGH15XdZTABCgEKSfC",
        currency: "usdtsol",
        amount: "10", // Amount as string
        batch_withdrawal_id: "5003706839",
        status: "finished", // Simulating successful completion
        extra_id: null,
        hash: "0xe822121e2ea9354db155052a12e07bfde1980b7cc6c0304ba52475ad6f4840f3", // Sample transaction hash
        error: null,
        is_request_payouts: false,
        ipn_callback_url: "https://sniperbuisnesscenter.com/api/payments/webhooks/nowpayments/payout",
        unique_external_id: null,
        payout_description: null,
        created_at: "2025-09-14T22:49:11.350Z", // From original transaction
        requested_at: "2025-09-14T22:49:50.000Z",
        updated_at: new Date().toISOString() // Current timestamp for completion
    };

    console.log('📤 Sending webhook payload:');
    console.log(JSON.stringify(webhookPayload, null, 2));
    console.log();

    try {
        // Prepare headers
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'NOWPayments-Webhook/1.0'
        };

        // Generate signature if IPN secret is available
        if (config.ipnSecret) {
            const signature = generateWebhookSignature(webhookPayload, config.ipnSecret);
            headers['x-nowpayments-sig'] = signature;
            console.log(`🔐 Generated signature: ${signature}`);
        } else {
            console.log('⚠️  No IPN secret configured - webhook signature will not be verified');
        }

        console.log(`🚀 Sending webhook to: ${config.baseUrl}${config.webhookPath}`);
        console.log();

        // Send the webhook
        const response = await axios.post(
            `${config.baseUrl}${config.webhookPath}`,
            webhookPayload,
            {
                headers,
                timeout: 10000 // 10 second timeout
            }
        );

        console.log('✅ WEBHOOK SUCCESS!');
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        console.log();
        console.log('🎉 Transaction should now be marked as COMPLETED');
        console.log('💰 User should receive refund if transaction was marked as failed');

    } catch (error) {
        console.log('❌ WEBHOOK FAILED!');

        if (error.response) {
            console.log(`Status: ${error.response.status}`);
            console.log(`Error Response:`, JSON.stringify(error.response.data, null, 2));

            // Provide specific error guidance
            if (error.response.status === 400) {
                console.log('\n💡 Possible Issues:');
                console.log('- Missing required fields in payload');
                console.log('- Invalid payload format');
            } else if (error.response.status === 404) {
                console.log('\n💡 Possible Issues:');
                console.log('- Transaction not found in database');
                console.log('- External transaction ID mismatch');
            } else if (error.response.status === 500) {
                console.log('\n💡 Possible Issues:');
                console.log('- Database connection error');
                console.log('- Internal server error during processing');
            }
        } else if (error.code === 'ECONNREFUSED') {
            console.log('Connection refused - make sure payment service is running on port 3003');
        } else {
            console.log(`Error: ${error.message}`);
        }
    }

    console.log();
    console.log('📋 Next Steps:');
    console.log('1. Check payment service logs for detailed processing info');
    console.log('2. Verify transaction status in database (should be "completed")');
    console.log('3. Check user balance if testing failure scenarios');
    console.log('4. Monitor any related microservice notifications');
}

/**
 * Test different status scenarios for the same transaction
 */
async function testMultipleStatusScenarios() {
    console.log('🧪 Testing Multiple Status Scenarios for Transaction ppOpT6bjoTqVxNHv\n');

    const statuses = [
        { status: 'creating', description: 'Payout being created' },
        { status: 'processing', description: 'Payout in progress' },
        { status: 'sending', description: 'Payout being sent to blockchain' },
        { status: 'finished', description: 'Payout completed successfully' },
        // Uncomment to test failure scenarios
        // { status: 'failed', description: 'Payout failed' },
        // { status: 'rejected', description: 'Payout rejected by provider' }
    ];

    for (const scenario of statuses) {
        console.log(`\n📤 Testing status: ${scenario.status} (${scenario.description})`);

        const payload = {
            id: "5004469882",
            address: "9FhKECkr9WjQ3abMeb1BR2kJUsDGH15XdZTABCgEKSfC",
            currency: "usdtsol",
            amount: "10",
            batch_withdrawal_id: "5003706839",
            status: scenario.status,
            extra_id: null,
            hash: scenario.status === 'finished' || scenario.status === 'sending' ?
                "0xe822121e2ea9354db155052a12e07bfde1980b7cc6c0304ba52475ad6f4840f3" : null,
            error: scenario.status === 'failed' || scenario.status === 'rejected' ?
                "Test error for status simulation" : null,
            is_request_payouts: false,
            ipn_callback_url: "https://sniperbuisnesscenter.com/api/payments/webhooks/nowpayments/payout",
            unique_external_id: null,
            payout_description: null,
            created_at: "2025-09-14T22:49:11.350Z",
            requested_at: "2025-09-14T22:49:50.000Z",
            updated_at: new Date().toISOString()
        };

        try {
            const headers = { 'Content-Type': 'application/json' };

            if (config.ipnSecret) {
                headers['x-nowpayments-sig'] = generateWebhookSignature(payload, config.ipnSecret);
            }

            const response = await axios.post(
                `${config.baseUrl}${config.webhookPath}`,
                payload,
                { headers, timeout: 5000 }
            );

            console.log(`✅ ${scenario.status}: ${response.status} - ${JSON.stringify(response.data)}`);
        } catch (error) {
            if (error.response) {
                console.log(`❌ ${scenario.status}: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                console.log(`❌ ${scenario.status}: ${error.message}`);
            }
        }

        // Wait 1 second between requests to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Command line interface
const args = process.argv.slice(2);

if (args.length > 0) {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log('NOWPayments Specific Transaction Webhook Tester\n');
        console.log('Usage:');
        console.log('  node test-specific-transaction-webhook.js           # Test single "finished" webhook');
        console.log('  node test-specific-transaction-webhook.js multiple  # Test multiple status scenarios');
        console.log('\nTransaction Details:');
        console.log('  Internal ID: ppOpT6bjoTqVxNHv');
        console.log('  External ID: 5004469882');
        console.log('  Amount: 10 USDTSOL');
        console.log('  Address: 9FhKECkr9WjQ3abMeb1BR2kJUsDGH15XdZTABCgEKSfC');
        console.log('\nEnvironment:');
        console.log('  Set NOWPAYMENTS_IPN_SECRET environment variable for signature testing');
    } else if (args[0] === 'multiple') {
        testMultipleStatusScenarios();
    }
} else {
    testSpecificTransactionWebhook();
}