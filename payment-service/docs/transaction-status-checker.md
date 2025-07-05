# Transaction Status Checker Background Process

## Overview

The Transaction Status Checker is a background process that automatically monitors and updates the status of withdrawal transactions that are in 'processing' state by checking their current status with CinetPay's verification APIs.

## Features

- **Automatic Monitoring**: Runs every 5 minutes to check all processing withdrawal transactions
- **CinetPay Integration**: Uses both payment verification and transfer status APIs
- **Intelligent Routing**: Automatically determines which API to use based on transaction type
- **Status Mapping**: Maps CinetPay statuses to internal transaction statuses
- **Error Handling**: Graceful error handling with detailed logging
- **Admin Endpoints**: Manual trigger capabilities for testing and debugging
- **Rate Limiting**: Built-in delays between API calls to respect CinetPay limits

## How It Works

### 1. Background Process
The main background job (`TransactionStatusChecker`) runs every 5 minutes and:

1. Finds all withdrawal transactions with `processing` status
2. For each transaction, determines the appropriate CinetPay API to use:
   - **Payment Verification API** (`/v2/payment/check`) for regular payments
   - **Transfer Status API** (`/v1/transfer/status`) for withdrawal/payout transactions
3. Calls the appropriate CinetPay API to get current status
4. Maps the CinetPay status to internal status
5. Updates the transaction if status has changed
6. Logs all activities for monitoring

### 2. Status Mapping

#### Payment Verification API
- `ACCEPTED` → `COMPLETED`
- `REFUSED` → `FAILED`
- `CANCELLED` → `FAILED`
- `PENDING` → `PROCESSING`

#### Transfer Status API
- `VAL` (Validated) → `COMPLETED`
- `REJ` (Rejected) → `FAILED`
- `NOS` (Not sent) → `FAILED`
- `NEW` (New) → `PROCESSING`
- `REC` (Received) → `PROCESSING`

## Configuration

The background process uses these configuration values from the environment:

```env
CINETPAY_BASE_URL=https://api-checkout.cinetpay.com/v2
CINETPAY_TRANSFER_BASE_URL=https://client.cinetpay.com/v1
CINETPAY_API_KEY=your_api_key
CINETPAY_API_PASSWORD=your_api_password
CINETPAY_SITE_ID=your_site_id
```

## API Endpoints

### Admin Endpoints (Protected)

All admin endpoints require authentication and are prefixed with `/api/payments/admin/transactions/`.

#### 1. Get Processing Statistics
```http
GET /api/payments/admin/transactions/processing-stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProcessing": 15,
    "byDate": {
      "2024-01-15": 5,
      "2024-01-16": 10
    },
    "byProvider": {
      "CinetPay": 12,
      "FeexPay": 3
    },
    "oldestTransaction": {
      "id": "withdrawal_001",
      "createdAt": "2024-01-15T10:30:00Z",
      "amount": 50000,
      "currency": "XAF"
    }
  }
}
```

#### 2. Manual Status Check (All)
```http
POST /api/payments/admin/transactions/check-all
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction status check initiated. Check logs for results.",
  "timestamp": "2024-01-16T14:30:00Z"
}
```

#### 3. Manual Status Check (Specific)
```http
POST /api/payments/admin/transactions/check/{transactionId}
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Status check initiated for transaction withdrawal_001. Check logs for results.",
  "transactionId": "withdrawal_001",
  "timestamp": "2024-01-16T14:30:00Z"
}
```

#### 4. Get Transaction Details
```http
GET /api/payments/admin/transactions/details/{transactionId}
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "withdrawal_001",
    "status": "processing",
    "type": "withdrawal",
    "amount": 50000,
    "currency": "XAF",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-16T14:30:00Z",
    "paymentProvider": {
      "provider": "CinetPay",
      "transactionId": "CINETPAY_TXN_001",
      "status": "pending"
    },
    "metadata": {
      "selectedPayoutService": "CinetPay",
      "lot": "LOT_001_SUCCESS",
      "statusCheckedAt": "2024-01-16T14:25:00Z"
    }
  }
}
```

## Database Schema Updates

The transaction status checker adds these fields to transaction metadata:

```typescript
interface TransactionMetadata {
  // Existing fields...
  
  // Status checker fields
  statusCheckedAt?: Date;      // Last time status was checked
  completedAt?: Date;          // When transaction was completed
  failedAt?: Date;            // When transaction failed
  
  // CinetPay specific
  selectedPayoutService?: 'CinetPay' | 'FeexPay';
  lot?: string;               // CinetPay lot number for transfers
}
```

## Logging

The status checker provides detailed logging for monitoring:

```log
[TransactionStatusChecker] Starting transaction status check cycle
[TransactionStatusChecker] Found 5 processing withdrawal transactions to check
[TransactionStatusChecker] Checking status for transaction withdrawal_001
[TransactionStatusChecker] Updated transaction withdrawal_001 status from processing to completed
[TransactionStatusChecker] Transaction status check cycle completed
```

## Error Handling

The system handles various error scenarios:

1. **Network Errors**: Logged and skipped, process continues
2. **Authentication Failures**: Logged with retry on next cycle
3. **Invalid Responses**: Logged with response details
4. **Missing Data**: Transactions with incomplete provider data are skipped
5. **Rate Limiting**: Built-in delays between API calls

## Monitoring and Alerts

Monitor these key metrics:

1. **Processing Transaction Count**: Should generally decrease over time
2. **Status Check Frequency**: Should run every 5 minutes
3. **Error Rates**: Check logs for API failures
4. **Old Transactions**: Transactions stuck in processing for too long

## Testing

Use the provided test cases in `userflow.http`:

1. Create test withdrawal transactions
2. Check processing statistics
3. Trigger manual status checks
4. Verify status updates in logs

## CinetPay API Integration

### Payment Verification API
```http
POST https://api-checkout.cinetpay.com/v2/payment/check
Content-Type: application/json

{
  "apikey": "your_api_key",
  "site_id": "your_site_id",
  "transaction_id": "cinetpay_transaction_id"
}
```

### Transfer Status API
```http
POST https://client.cinetpay.com/v1/transfer/status
Content-Type: application/x-www-form-urlencoded
Authorization: Bearer <auth_token>

lot=lot_number
```

## Troubleshooting

### Common Issues

1. **No Status Updates**
   - Check CinetPay API credentials
   - Verify network connectivity
   - Check logs for authentication errors

2. **Background Job Not Running**
   - Verify server startup logs
   - Check if `transactionStatusChecker.start()` is called
   - Ensure no blocking operations

3. **Incorrect Status Mapping**
   - Review CinetPay API documentation
   - Check status mapping functions
   - Verify API response formats

### Debug Commands

```bash
# Check background job status
curl -X GET "https://your-api.com/api/payments/admin/transactions/processing-stats" \
  -H "Authorization: Bearer <token>"

# Trigger manual check
curl -X POST "https://your-api.com/api/payments/admin/transactions/check-all" \
  -H "Authorization: Bearer <token>"

# Check specific transaction
curl -X GET "https://your-api.com/api/payments/admin/transactions/details/txn_123" \
  -H "Authorization: Bearer <token>"
```

## Future Enhancements

1. **Configurable Check Intervals**: Allow different intervals based on transaction age
2. **Priority Queues**: Check newer transactions more frequently
3. **Webhook Integration**: Listen for CinetPay webhooks to reduce API calls
4. **Metrics Dashboard**: Real-time monitoring interface
5. **Alert System**: Notifications for stuck transactions

## Security Considerations

1. **API Key Protection**: Store CinetPay credentials securely
2. **Rate Limiting**: Respect CinetPay API limits
3. **Admin Access**: Protect admin endpoints with proper authorization
4. **Logging**: Avoid logging sensitive payment data

## Performance

- **Batch Processing**: Processes up to 100 transactions per cycle
- **Rate Limiting**: 1-second delay between API calls
- **Memory Efficient**: Uses lean queries and processes in batches
- **Non-blocking**: Manual checks run asynchronously