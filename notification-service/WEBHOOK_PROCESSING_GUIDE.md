# WhatsApp Cloud API Webhook Processing Guide

## Overview

This guide documents the implementation of WhatsApp Cloud API webhook processing for the notification service. The webhook processor handles incoming webhook events from WhatsApp Cloud API and updates notification records with delivery status information.

## Architecture

### Components

1. **WhatsAppWebhookController** (`src/api/controllers/whatsapp-webhook.controller.ts`)
   - Handles HTTP webhook requests from WhatsApp Cloud API
   - Performs webhook verification and signature validation
   - Delegates payload processing to the webhook processor service

2. **WebhookProcessorService** (`src/services/webhook-processor.service.ts`)
   - Core service for processing webhook payloads
   - Validates payload structure and content
   - Updates notification records with status changes
   - Provides comprehensive logging and error handling

3. **NotificationRepository** (`src/database/repositories/notification.repository.ts`)
   - Database abstraction layer for notification operations
   - Handles notification updates with WhatsApp-specific fields

## Features Implemented

### ✅ Task 3.2: Process webhook payloads and update message status

#### 1. Parse webhook payloads for message status updates
- **Enhanced payload validation** with detailed error reporting
- **Structured parsing** of WhatsApp Cloud API webhook format
- **Support for multiple entries and changes** in single payload
- **Graceful handling** of malformed or incomplete payloads

#### 2. Update notification records with delivery status
- **Status mapping** from WhatsApp statuses to notification statuses:
  - `sent` → `SENT` (message sent but not delivered)
  - `delivered` → `DELIVERED` (message reached recipient's device)
  - `read` → `DELIVERED` (message was read by recipient)
  - `failed` → `FAILED` (message delivery failed)
- **Timestamp handling** with multiple format support (Unix timestamp, ISO string)
- **WhatsApp-specific field updates**:
  - `whatsappMessageId` - WhatsApp message identifier
  - `whatsappStatus` - Current WhatsApp delivery status
  - `whatsappDeliveredAt` - Delivery timestamp
  - `whatsappReadAt` - Read timestamp
  - `whatsappError` - Error details for failed messages

#### 3. Implement error handling for malformed webhook payloads
- **Multi-level validation**:
  - Payload structure validation
  - Entry and change validation
  - Status update field validation
- **Graceful degradation** - continues processing valid parts even if some parts fail
- **Detailed error logging** with correlation IDs for tracking
- **Sanitized logging** - removes sensitive information from logs

#### 4. Add logging for webhook processing events
- **Correlation ID tracking** for end-to-end request tracing
- **Performance metrics** - processing time tracking
- **Structured logging** with consistent format
- **Different log levels**:
  - `INFO` - Successful operations and status changes
  - `WARN` - Non-critical issues (missing notifications, invalid timestamps)
  - `ERROR` - Critical failures and exceptions
  - `DEBUG` - Detailed processing information

## Webhook Payload Structure

### Supported Webhook Events

#### Message Status Updates
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "business_account_id",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "1234567890",
              "phone_number_id": "phone_number_id"
            },
            "statuses": [
              {
                "id": "wamid.message_id",
                "status": "delivered",
                "timestamp": "1234567890",
                "recipient_id": "recipient_phone_number",
                "conversation": {
                  "id": "conversation_id",
                  "origin": {
                    "type": "business_initiated"
                  }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "CBP",
                  "category": "business_initiated"
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

#### Failed Message with Error Details
```json
{
  "statuses": [
    {
      "id": "wamid.message_id",
      "status": "failed",
      "timestamp": "1234567890",
      "recipient_id": "recipient_phone_number",
      "errors": [
        {
          "code": 131026,
          "title": "Invalid WhatsApp number",
          "message": "The provided phone number is not a valid WhatsApp user"
        }
      ]
    }
  ]
}
```

#### Incoming Messages (Logged for Monitoring)
```json
{
  "messages": [
    {
      "id": "wamid.incoming_message_id",
      "from": "sender_phone_number",
      "timestamp": "1234567890",
      "type": "text",
      "text": {
        "body": "Message content"
      }
    }
  ]
}
```

## Database Schema Updates

### Notification Model Enhancements

The notification model has been enhanced with WhatsApp Cloud API specific fields:

```typescript
interface INotification {
  // ... existing fields
  
  // WhatsApp Cloud API specific fields
  whatsappMessageId?: string;      // WhatsApp message identifier
  whatsappStatus?: string;         // Current WhatsApp status
  whatsappReadAt?: Date;          // When message was read
  whatsappError?: {               // Error details for failed messages
    code: number;
    title: string;
    message: string;
  };
}
```

### Repository Updates

The notification repository has been updated to support the new fields:

```typescript
interface UpdateNotificationInput {
  status?: NotificationStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  errorDetails?: string;
  // WhatsApp Cloud API specific fields
  whatsappStatus?: string;
  whatsappDeliveredAt?: Date;
  whatsappReadAt?: Date;
  whatsappError?: {
    code: number;
    title: string;
    message: string;
  };
}
```

## Error Handling

### Validation Errors
- **Payload structure validation** - ensures required fields are present
- **Status update validation** - validates message ID, status, timestamp, and recipient ID
- **Timestamp parsing** - handles various timestamp formats with fallback to current time

### Processing Errors
- **Database errors** - graceful handling of notification update failures
- **Missing notifications** - logs warnings when webhook references unknown message IDs
- **Partial failures** - continues processing other status updates even if some fail

### Logging Strategy
- **Correlation IDs** - unique identifiers for tracking requests across logs
- **Structured logging** - consistent JSON format for easy parsing
- **Performance tracking** - processing time metrics
- **Error context** - detailed error information with stack traces

## Testing

### Integration Tests
- **Payload validation tests** - verify correct handling of valid and invalid payloads
- **Status update tests** - ensure proper mapping of WhatsApp statuses to notification statuses
- **Error handling tests** - validate graceful handling of various error conditions
- **Timestamp parsing tests** - verify correct parsing of different timestamp formats

### Test Coverage
- ✅ Valid webhook payload processing
- ✅ Malformed payload handling
- ✅ Status update validation
- ✅ Multiple status updates in single payload
- ✅ Failed message with error details
- ✅ Missing notification handling
- ✅ Database update failure handling
- ✅ Invalid timestamp format handling
- ✅ Incoming message logging

## Configuration

### Environment Variables
```env
# WhatsApp Cloud API Configuration
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_ENABLE_WEBHOOK_VALIDATION=true
```

### Webhook Endpoint
- **Verification endpoint**: `GET /api/webhook/whatsapp`
- **Event endpoint**: `POST /api/webhook/whatsapp`

## Security

### Webhook Verification
- **Challenge-response verification** during webhook setup
- **HMAC SHA-256 signature verification** for incoming webhooks
- **Raw body preservation** for signature validation
- **Configurable validation** - can be enabled/disabled via environment variable

### Data Protection
- **Sensitive data sanitization** in logs
- **Message content redaction** for privacy
- **Secure error handling** - no sensitive information in error responses

## Performance

### Optimization Features
- **Batch processing** - handles multiple status updates in single request
- **Efficient database operations** - uses repository pattern with optimized queries
- **Asynchronous processing** - non-blocking webhook handling
- **Performance monitoring** - tracks processing time for optimization

### Scalability Considerations
- **Stateless processing** - no session state maintained
- **Database connection pooling** - efficient resource utilization
- **Error isolation** - failures in one status update don't affect others
- **Graceful degradation** - continues processing even with partial failures

## Monitoring and Observability

### Logging Levels
- **INFO**: Successful operations, status changes, processing summaries
- **WARN**: Non-critical issues, missing notifications, validation warnings
- **ERROR**: Critical failures, database errors, processing exceptions
- **DEBUG**: Detailed processing information, payload details, timing information

### Key Metrics
- **Processing time** - time taken to process webhook payloads
- **Success rate** - percentage of successfully processed status updates
- **Error rate** - frequency of processing errors
- **Payload size** - number of status updates per webhook

### Correlation Tracking
- **Unique correlation IDs** for each webhook request
- **End-to-end tracing** across all processing steps
- **Structured log format** for easy parsing and analysis

## Troubleshooting

### Common Issues

1. **Webhook verification fails**
   - Check `WHATSAPP_WEBHOOK_VERIFY_TOKEN` configuration
   - Verify webhook URL is accessible from WhatsApp servers
   - Ensure proper HTTPS configuration

2. **Status updates not processed**
   - Check notification exists with matching `whatsappMessageId`
   - Verify payload structure matches expected format
   - Review logs for validation errors

3. **Database update failures**
   - Check database connectivity
   - Verify notification repository configuration
   - Review database logs for constraint violations

### Debug Steps
1. Enable debug logging: Set log level to `DEBUG`
2. Check correlation ID in logs for end-to-end tracing
3. Verify webhook payload structure against expected format
4. Test with webhook test endpoint in development mode

## Future Enhancements

### Potential Improvements
- **Retry mechanism** for failed database updates
- **Webhook event queuing** for high-volume scenarios
- **Real-time status notifications** via WebSocket
- **Analytics dashboard** for webhook processing metrics
- **Automated testing** with webhook simulation

### Integration Opportunities
- **Notification preferences** - user-specific delivery preferences
- **Message templates** - integration with template management
- **Rate limiting** - protection against webhook flooding
- **Audit trail** - comprehensive logging of all status changes

## Conclusion

The WhatsApp Cloud API webhook processing implementation provides a robust, scalable, and well-monitored solution for handling message status updates. The implementation includes comprehensive error handling, detailed logging, and thorough testing to ensure reliable operation in production environments.

Key achievements:
- ✅ Complete webhook payload processing
- ✅ Robust error handling and validation
- ✅ Comprehensive logging and monitoring
- ✅ Thorough testing coverage
- ✅ Production-ready security features
- ✅ Performance optimization
- ✅ Detailed documentation

The system is ready for production deployment and can handle the full range of WhatsApp Cloud API webhook events with proper error handling and monitoring.