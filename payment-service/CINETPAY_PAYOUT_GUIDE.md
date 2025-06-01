# 💰 CinetPay Payout Implementation Guide

This guide covers the complete implementation of CinetPay money transfer (payout) functionality for the SBC payment service.

## 🎯 Overview

The CinetPay payout system allows you to send money directly to users' mobile wallets across 9 African countries using various mobile money operators.

### ✅ Supported Countries & Operators

| Country | Currency | Operators | Min Amount |
|---------|----------|-----------|------------|
| **Côte d'Ivoire** | XOF | Orange, Moov, MTN, Wave | 200 |
| **Sénégal** | XOF | Orange, Free, Wave | 200 |
| **Cameroun** | XAF | Orange, MTN | 500 |
| **Togo** | XOF | Tmoney, Flooz | 150 |
| **Benin** | XOF | MTN, Moov | 500 |
| **Mali** | XOF | Orange, Moov | 500 |
| **Burkina Faso** | XOF | Orange, Moov | 500 |
| **Guinea** | GNF | Orange, MTN | 1000 |
| **Congo (RDC)** | CDF | Orange, M-PESA, Airtel | 1000 |

## 🔧 Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# CinetPay Transfer Configuration
CINETPAY_API_KEY=your_api_key_here
CINETPAY_TRANSFER_PASSWORD=your_transfer_password_here
CINETPAY_SITE_ID=your_site_id_here
CINETPAY_NOTIFICATION_KEY=your_notification_key_here

# Service Configuration
SELF_BASE_URL=https://your-domain.com  # For webhook notifications
```

### Required Credentials

1. **API Key**: Your CinetPay API key
2. **Transfer Password**: Special password for money transfer operations
3. **Site ID**: Your merchant site identifier
4. **Notification Key**: For webhook verification (optional)

## 📡 API Endpoints

### 1. Get Supported Countries
```bash
GET /api/payouts/countries
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "code": "CM",
      "name": "Cameroun",
      "prefix": "237",
      "currency": "XAF",
      "minAmount": 500,
      "paymentMethods": ["OMCM", "MTNCM"]
    }
  ]
}
```

### 2. Get Account Balance
```bash
GET /api/payouts/balance
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 1000000,
    "available": 950000,
    "inUse": 50000
  }
}
```

### 3. Initiate Payout
```bash
POST /api/payouts/initiate
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "targetUserId": "user123",
  "amount": 5000,
  "phoneNumber": "650123456",
  "countryCode": "CM",
  "recipientName": "John Doe",
  "recipientEmail": "john@example.com",
  "paymentMethod": "MTNCM",
  "description": "Withdrawal request"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payout initiated successfully",
  "data": {
    "success": true,
    "transactionId": "SBC_user123_1640995200000",
    "cinetpayTransactionId": "CP_TXN_123456789",
    "status": "pending",
    "message": "Payout initiated successfully. Awaiting confirmation.",
    "amount": 5000,
    "recipient": "+237650123456",
    "estimatedCompletion": "2024-01-01T12:30:00.000Z"
  }
}
```

### 4. Check Payout Status
```bash
GET /api/payouts/status/SBC_user123_1640995200000
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "SBC_user123_1640995200000",
    "cinetpayTransactionId": "CP_TXN_123456789",
    "status": "completed",
    "amount": 5000,
    "recipient": "+237650123456",
    "operator": "MTN_CM",
    "sendingStatus": "confirmed",
    "comment": "Transfer completed successfully",
    "completedAt": "2024-01-01T12:35:00.000Z"
  }
}
```

### 5. Webhook Endpoint
```bash
POST /api/payouts/cinetpay/webhook
```

This endpoint receives notifications from CinetPay about payout status changes.

## 🔄 Payout Process Flow

### 1. **Initiation**
```
Admin Request → Validation → Add Contact → Send Money → Return Transaction ID
```

### 2. **Status Updates**
```
NEW → REC → VAL (Success)
NEW → REC → REJ (Failed)
NEW → NOS → Manual Confirmation Required
```

### 3. **Webhook Notifications**
```
CinetPay → Your Webhook → Database Update → User Notification
```

## 💡 Usage Examples

### Basic Payout
```typescript
// Initiate a payout to a Cameroon MTN number
const payoutRequest = {
  targetUserId: "user123",
  amount: 5000,
  phoneNumber: "650123456",
  countryCode: "CM",
  recipientName: "John Doe",
  recipientEmail: "john@example.com",
  paymentMethod: "MTNCM"
};

const result = await cinetpayPayoutService.initiatePayout(payoutRequest);
```

### Check Balance Before Payout
```typescript
// Check if you have sufficient balance
const balance = await cinetpayPayoutService.getBalance();
if (balance.available >= payoutAmount) {
  // Proceed with payout
}
```

### Monitor Payout Status
```typescript
// Check status periodically
const status = await cinetpayPayoutService.checkPayoutStatus(transactionId);
console.log(`Payout status: ${status.status}`);
```

## 🛡️ Security & Validation

### Input Validation
- **Amount**: Must be positive and multiple of 5
- **Phone Number**: Validated against country-specific formats
- **Country Code**: Must be supported
- **Minimum Amounts**: Enforced per country

### Authentication
- **Token-based**: 5-minute expiry, auto-renewal
- **IP Whitelisting**: Recommended for production
- **Webhook Security**: Verify notification signatures

### Error Handling
- **Insufficient Balance**: Check before initiating
- **Invalid Phone**: Validate format and operator
- **Network Issues**: Retry mechanism with exponential backoff

## 📊 Status Mapping

| CinetPay Status | Our Status | Description |
|----------------|------------|-------------|
| `NEW` | `pending` | Transfer queued |
| `REC` | `processing` | Transfer in progress |
| `VAL` | `completed` | Transfer successful |
| `REJ` | `failed` | Transfer rejected |
| `NOS` | `pending` | Awaiting confirmation |

## 🔍 Troubleshooting

### Common Issues

#### 1. Authentication Errors
```
Error: Authentication failed: INVALID_CREDENTIALS
```
**Solution**: Check API key and transfer password

#### 2. Insufficient Balance
```
Error: INSUFFICIENT_BALANCE
```
**Solution**: Top up your CinetPay transfer account

#### 3. Invalid Phone Number
```
Error: Invalid phone number format
```
**Solution**: Ensure phone number matches country format

#### 4. Amount Too Small
```
Error: AMOUNT_TOO_SMALL
```
**Solution**: Check minimum amounts per country

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug
```

### Test Endpoint

Use the test endpoint in development:
```bash
POST /api/payouts/test
Authorization: Bearer <admin_token>
```

## 🚀 Production Deployment

### Pre-deployment Checklist

1. ✅ **Environment Variables**: All CinetPay credentials configured
2. ✅ **IP Whitelisting**: Add your server IP to CinetPay
3. ✅ **Webhook URL**: Configure HTTPS webhook endpoint
4. ✅ **Balance Monitoring**: Set up alerts for low balance
5. ✅ **Error Handling**: Implement retry logic and notifications

### Monitoring

Monitor these metrics:
- **Success Rate**: Percentage of successful payouts
- **Average Processing Time**: Time from initiation to completion
- **Balance Levels**: Available vs. in-use amounts
- **Error Rates**: Failed transactions by error type

### Scaling Considerations

- **Rate Limiting**: CinetPay has API rate limits
- **Batch Processing**: Process multiple payouts efficiently
- **Queue Management**: Use job queues for high volume
- **Failover**: Implement backup payment methods

## 📝 Integration Examples

### With User Service
```typescript
// Get user details for payout
const user = await userService.getUserById(userId);
const payout = await payoutService.initiatePayout({
  targetUserId: user.id,
  amount: withdrawalAmount,
  phoneNumber: user.phoneNumber,
  countryCode: user.country,
  recipientName: user.name,
  recipientEmail: user.email
});
```

### With Notification Service
```typescript
// Notify user of payout status
await notificationService.sendPushNotification(userId, {
  title: 'Payout Completed',
  body: `Your withdrawal of ${amount} has been processed successfully.`
});
```

### Database Integration
```typescript
// Update payout record in database
await payoutRepository.updateStatus(transactionId, {
  status: 'completed',
  cinetpayTransactionId: result.cinetpayTransactionId,
  completedAt: new Date()
});
```

## 🎯 Best Practices

1. **Always validate** user input before initiating payouts
2. **Check balance** before processing large batches
3. **Implement retry logic** for network failures
4. **Log all transactions** for audit purposes
5. **Monitor webhook** delivery and handle failures
6. **Use test mode** extensively before going live
7. **Set up alerts** for failed transactions
8. **Implement rate limiting** to prevent abuse

## 📞 Support

For CinetPay-specific issues:
- **Documentation**: https://docs.cinetpay.com
- **Support**: Contact CinetPay support team
- **Status Page**: Check CinetPay service status

For implementation issues:
- Check logs for detailed error messages
- Use the test endpoint for debugging
- Verify environment configuration
