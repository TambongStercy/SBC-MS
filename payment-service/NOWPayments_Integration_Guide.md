# NOWPayments Crypto Integration Guide

This guide explains how to set up and use the NOWPayments cryptocurrency payment and payout integration in the SBC payment service.

## Overview

NOWPayments integration provides:
- **Crypto Payments**: Accept 300+ cryptocurrencies (BTC, ETH, USDT, etc.)
- **Crypto Payouts**: Send crypto withdrawals to users
- **Real-time Webhooks**: Automatic payment status updates
- **Low Fees**: 0.5-1% transaction fees
- **Global Coverage**: Works worldwide

## Environment Configuration

Add these environment variables to your `.env` file:

```bash
# Required: Your NOWPayments API key
NOWPAYMENTS_API_KEY=your_nowpayments_api_key_here

# Optional: Payout API key (for mass payouts/withdrawals)
NOWPAYMENTS_PAYOUT_API_KEY=your_nowpayments_payout_api_key_here

# Sandbox mode (true for testing, false for production)
NOWPAYMENTS_SANDBOX=true

# NOWPayments API base URL
NOWPAYMENTS_BASE_URL=https://api.nowpayments.io/v1

# IPN secret for webhook verification
NOWPAYMENTS_IPN_SECRET=your_ipn_secret_here

# Webhook secret for additional security
NOWPAYMENTS_WEBHOOK_SECRET=your_webhook_secret_here
```

## Getting Started

### 1. Sign Up for NOWPayments

1. Visit [NOWPayments.io](https://nowpayments.io)
2. Create an account
3. Get your API key from the dashboard
4. Configure webhooks in your account settings

### 2. Set Up Webhooks

Configure these webhook URLs in your NOWPayments dashboard:

- **Payment Webhook**: `https://yourdomain.com/api/payments/webhooks/nowpayments`
- **Payout Webhook**: `https://yourdomain.com/api/payments/webhooks/nowpayments/payout`

## API Endpoints

### Payment Endpoints

#### Create Payment Intent
```http
POST /api/payments/intents
```

```json
{
  "userId": "user123",
  "amount": 100,
  "currency": "USD",
  "paymentType": "SUBSCRIPTION",
  "metadata": {
    "subscriptionType": "premium",
    "subscriptionPlan": "monthly"
  }
}
```

#### Submit Payment Details (Crypto)
```http
POST /api/payments/intents/{sessionId}/submit
```

```json
{
  "countryCode": "US",
  "paymentCurrency": "BTC"
}
```

### Crypto-Specific Endpoints

#### Get Available Cryptocurrencies
```http
GET /api/payments/crypto/currencies
```

Response:
```json
{
  "success": true,
  "data": {
    "currencies": ["BTC", "ETH", "USDT", "USDC", "LTC", ...]
  }
}
```

#### Get Payment Estimate
```http
GET /api/payments/crypto/estimate?amount=100&fromCurrency=USD&toCurrency=BTC
```

Response:
```json
{
  "success": true,
  "data": {
    "estimatedAmount": 0.00234567,
    "currency": "BTC",
    "feeAmount": 0.00001,
    "networkFee": 0.00002
  }
}
```

#### Create Crypto Payout
```http
POST /api/payments/crypto/payout
```

```json
{
  "userId": "user123",
  "amount": 100,
  "cryptoCurrency": "BTC",
  "cryptoAddress": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "description": "User withdrawal"
}
```

## Integration Flow

### Crypto Payments Flow

1. **Create Payment Intent**
   ```typescript
   const intent = await paymentService.createPaymentIntent({
     userId: 'user123',
     amount: 100,
     currency: 'USD',
     paymentType: 'SUBSCRIPTION'
   });
   ```

2. **User Selects Crypto Currency**
   - Frontend shows available cryptocurrencies
   - User selects preferred crypto (e.g., BTC, ETH, USDT)

3. **Submit Payment Details**
   ```typescript
   const payment = await paymentService.submitPaymentDetails(sessionId, {
     countryCode: 'US',
     paymentCurrency: 'BTC'
   });
   ```

4. **NOWPayments Creates Crypto Address**
   - System generates unique crypto address
   - QR code provided for easy payment
   - User sends crypto to the address

5. **Webhook Updates Status**
   - NOWPayments sends webhook when payment received
   - Status updated automatically
   - User notified of successful payment

### Crypto Payouts Flow

1. **User Requests Withdrawal**
   - User provides crypto address
   - Selects cryptocurrency
   - Specifies amount

2. **Create Payout Request**
   ```typescript
   const payout = await paymentService.createCryptoPayout(
     userId,
     amount,
     'BTC',
     'user_crypto_address',
     'Withdrawal request'
   );
   ```

3. **NOWPayments Processes Payout**
   - Payout sent to blockchain
   - Transaction hash provided
   - Webhook confirms completion

## Supported Cryptocurrencies

Major cryptocurrencies supported:
- **Bitcoin (BTC)**
- **Ethereum (ETH)**
- **Tether (USDT)**
- **USD Coin (USDC)**
- **Binance Coin (BNB)**
- **Litecoin (LTC)**
- **Ripple (XRP)**
- **Cardano (ADA)**
- **Polkadot (DOT)**
- **Solana (SOL)**
- **Polygon (MATIC)**
- **TRON (TRX)**

And 290+ more cryptocurrencies!

## Webhook Handling

### Payment Webhook
Automatically handles crypto payment status updates:

```typescript
// Webhook payload example
{
  "payment_id": "payment_123",
  "order_id": "session_456",
  "payment_status": "confirmed",
  "actually_paid": 0.00234567,
  "pay_currency": "BTC",
  "outcome_amount": 100,
  "outcome_currency": "USD"
}
```

### Payout Webhook
Handles crypto payout status updates:

```typescript
// Payout webhook payload example
{
  "id": "payout_789",
  "withdrawal_id": "withdrawal_123",
  "status": "finished",
  "hash": "0x1234567890abcdef...",
  "amount": 0.00234567,
  "currency": "BTC",
  "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
}
```

## Error Handling

The integration includes comprehensive error handling:

- **Invalid API Keys**: Throws authentication errors
- **Insufficient Balance**: Validates user balance before payouts
- **Network Errors**: Retries with exponential backoff
- **Webhook Verification**: Validates signatures to prevent fraud
- **Transaction Failures**: Automatic refunds for failed payouts

## Security Features

- **Webhook Signature Verification**: All webhooks verified using HMAC
- **API Key Security**: Keys stored securely in environment variables
- **Transaction Validation**: All transactions validated before processing
- **Balance Checks**: User balances verified before payouts
- **Audit Logging**: All transactions logged for compliance

## Testing

### Sandbox Mode
Set `NOWPAYMENTS_SANDBOX=true` for testing:
- Use test API keys
- No real crypto transactions
- Full webhook simulation
- Test all payment flows

### Test Cases
1. **Successful Payment**: Test complete crypto payment flow
2. **Failed Payment**: Test payment failure handling
3. **Partial Payment**: Test partial crypto payments
4. **Successful Payout**: Test crypto withdrawal
5. **Failed Payout**: Test payout failure and refund
6. **Webhook Processing**: Test all webhook scenarios

## Monitoring and Analytics

Track crypto payments in your dashboard:
- Payment success rates by cryptocurrency
- Average payment times
- Popular cryptocurrencies
- Payout processing times
- Network fee analysis

## Troubleshooting

### Common Issues

1. **Webhook Not Received**
   - Check webhook URL configuration
   - Verify IPN secret
   - Check firewall settings

2. **Payment Status Not Updating**
   - Check webhook processing logs
   - Verify signature validation
   - Confirm transaction exists

3. **Payout Failures**
   - Check user balance
   - Verify crypto address format
   - Check minimum payout amounts

### Support

For NOWPayments-specific issues:
- Documentation: [NOWPayments Docs](https://documenter.getpostman.com/view/7907941/S1a32n38)
- Support: [NOWPayments Support](https://nowpayments.io/support)
- API Status: [NOWPayments Status](https://nowpayments.io/status)

## Best Practices

1. **Always Verify Webhooks**: Use signature verification for security
2. **Handle Failures Gracefully**: Implement proper error handling and user feedback
3. **Monitor Transactions**: Set up alerts for failed payments/payouts
4. **Keep API Keys Secure**: Never expose keys in client-side code
5. **Test Thoroughly**: Use sandbox mode extensively before production
6. **Update Regularly**: Keep the NOWPayments package updated

## Migration from Other Providers

If migrating from other crypto payment providers:
1. Map existing transaction statuses to NOWPayments statuses
2. Update webhook handling logic
3. Test all payment flows in sandbox
4. Gradually migrate users to new system
5. Monitor for any issues during transition

---

This integration provides a robust, secure, and user-friendly way to handle cryptocurrency payments and payouts in your application. 