const axios = require('axios');

/**
 * Test failure scenario for NOWPayments payout webhook
 */

const config = {
    baseUrl: 'http://localhost:3003',
    webhookPath: '/api/payments/webhooks/nowpayments/payout'
};

async function testFailureScenario() {
    console.log('❌ Testing NOWPayments Payout FAILURE Webhook');
    console.log('=' .repeat(50));
    console.log('This should refund the user: +10.25 USD');
    console.log('=' .repeat(50));

    const failurePayload = {
        id: "5004469882",
        address: "9FhKECkr9WjQ3abMeb1BR2kJUsDGH15XdZTABCgEKSfC",
        currency: "usdtsol",
        amount: "10",
        batch_withdrawal_id: "5003706839",
        status: "failed", // This should trigger a refund
        extra_id: null,
        hash: null,
        error: "Insufficient balance in provider wallet",
        is_request_payouts: false,
        ipn_callback_url: "https://sniperbuisnesscenter.com/api/payments/webhooks/nowpayments/payout",
        unique_external_id: null,
        payout_description: null,
        created_at: "2025-09-14T22:49:11.350Z",
        requested_at: "2025-09-14T22:49:50.000Z",
        updated_at: new Date().toISOString()
    };

    try {
        const response = await axios.post(
            `${config.baseUrl}${config.webhookPath}`,
            failurePayload,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );

        console.log('✅ FAILURE WEBHOOK SUCCESS!');
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        console.log();
        console.log('💰 User should have been refunded: +10.25 USD (amount + fee)');

    } catch (error) {
        console.log('❌ FAILURE WEBHOOK FAILED!');
        if (error.response) {
            console.log(`Status: ${error.response.status}`);
            console.log(`Error Response:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log(`Error: ${error.message}`);
        }
    }
}

testFailureScenario();