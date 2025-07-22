# Design Document

## Overview

This design outlines the migration from Bailey (WhatsApp Web scraping via @whiskeysockets/baileys) to the official WhatsApp Cloud API. The migration will replace the current web scraping approach with a more reliable, officially supported API while maintaining backward compatibility with existing integrations.

The WhatsApp Cloud API provides several advantages over Bailey:
- Official support from Meta/WhatsApp
- Better reliability and uptime
- No need for QR code scanning or session management
- Built-in webhook support for delivery status
- Rate limiting and error handling
- Compliance with WhatsApp's terms of service

## Architecture

### Current Architecture (Bailey-based)
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Notification    │───▶│ WhatsApp Service │───▶│ Bailey Library  │
│ Service         │    │ (whatsapp.service│    │ (@whiskeysockets│
│                 │    │ .ts)             │    │ /baileys)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ QR Code         │
                       │ Management      │
                       │ & Session Auth  │
                       └─────────────────┘
```

### New Architecture (WhatsApp Cloud API)
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Notification    │───▶│ WhatsApp Cloud   │───▶│ WhatsApp Cloud  │
│ Service         │    │ Service          │    │ API (Meta)      │
│                 │    │ (whatsapp.service│    │                 │
└─────────────────┘    │ .ts - refactored)│    └─────────────────┘
                       └──────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Webhook Handler │
                       │ (delivery       │
                       │ status updates) │
                       └─────────────────┘
```

## Components and Interfaces

### 1. WhatsApp Cloud Service (Refactored)

The existing `WhatsAppService` class will be refactored to use the WhatsApp Cloud API instead of Bailey:

**Key Changes:**
- Remove Bailey dependency and QR code management
- Add HTTP client for WhatsApp Cloud API calls
- Implement token-based authentication
- Add webhook endpoint handling
- Maintain existing public interface for backward compatibility

**New Interface:**
```typescript
interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  apiVersion: string;
}

interface WhatsAppMessage {
  to: string;
  type: 'text' | 'template' | 'media';
  text?: { body: string };
  template?: { name: string; language: { code: string }; components?: any[] };
  image?: { link: string; caption?: string };
  document?: { link: string; filename?: string; caption?: string };
}

interface WhatsAppResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}
```

### 2. Webhook Handler

New component to handle incoming webhooks from WhatsApp Cloud API:

```typescript
interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          errors?: Array<{ code: number; title: string; message: string }>;
        }>;
        messages?: Array<any>; // For incoming messages (future feature)
      };
      field: string;
    }>;
  }>;
}
```

### 3. Configuration Management

Environment variables for WhatsApp Cloud API:

```typescript
interface WhatsAppCloudEnvConfig {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: string;
  WHATSAPP_API_VERSION: string; // default: 'v18.0'
  WHATSAPP_API_BASE_URL: string; // default: 'https://graph.facebook.com'
}
```

### 4. Message Status Tracking

Enhanced notification model to track WhatsApp message status:

```typescript
interface NotificationStatus {
  messageId?: string; // WhatsApp message ID
  whatsappStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  whatsappTimestamp?: Date;
  whatsappError?: {
    code: number;
    title: string;
    message: string;
  };
}
```

## Data Models

### Updated Notification Model

The existing notification model will be extended to support WhatsApp Cloud API message tracking:

```typescript
interface INotification {
  // ... existing fields
  whatsappMessageId?: string;
  whatsappStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  whatsappDeliveredAt?: Date;
  whatsappReadAt?: Date;
  whatsappError?: {
    code: number;
    title: string;
    message: string;
  };
}
```

### Configuration Schema

New configuration collection for WhatsApp Cloud API settings:

```typescript
interface WhatsAppConfig {
  _id: ObjectId;
  accessToken: string; // Encrypted
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string; // Encrypted
  apiVersion: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

## Error Handling

### 1. API Error Responses

WhatsApp Cloud API error handling with proper retry logic:

```typescript
interface WhatsAppError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

// Error categories and retry strategies:
// - Rate limiting (code 4): Exponential backoff
// - Invalid token (code 190): Refresh token or alert admin
// - Invalid phone number (code 131026): Mark as failed, no retry
// - Temporary failures (5xx): Retry with backoff
```

### 2. Fallback Mechanisms

When WhatsApp Cloud API is unavailable:
- Queue messages for retry
- For OTP messages: fallback to SMS/Email
- Log failures for monitoring
- Alert administrators for extended outages

### 3. Webhook Validation

Secure webhook endpoint with signature verification:

```typescript
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expectedSignature}`)
  );
}
```

## Testing Strategy

### 1. Unit Tests

- WhatsApp Cloud Service methods
- Webhook payload processing
- Error handling scenarios
- Message formatting and validation

### 2. Integration Tests

- End-to-end message sending
- Webhook delivery status updates
- Fallback mechanism testing
- Rate limiting behavior

### 3. Migration Testing

- Parallel testing with Bailey (during transition)
- Message delivery comparison
- Performance benchmarking
- Backward compatibility verification

### 4. Load Testing

- High-volume message sending
- Webhook processing under load
- Rate limit handling
- Queue performance

## Migration Strategy

### Phase 1: Preparation
1. Set up WhatsApp Cloud API account and credentials
2. Implement new WhatsApp Cloud Service alongside existing Bailey service
3. Add feature flag to switch between implementations
4. Create webhook endpoints

### Phase 2: Testing
1. Deploy with feature flag disabled (Bailey still active)
2. Run parallel testing with small subset of messages
3. Validate message delivery and webhook functionality
4. Performance and reliability testing

### Phase 3: Gradual Rollout
1. Enable WhatsApp Cloud API for non-critical notifications
2. Monitor delivery rates and error patterns
3. Gradually increase traffic to Cloud API
4. Keep Bailey as fallback during transition

### Phase 4: Full Migration
1. Switch all WhatsApp traffic to Cloud API
2. Remove Bailey dependencies and code
3. Clean up QR code management endpoints
4. Update documentation and monitoring

### Phase 5: Cleanup
1. Remove Bailey-related environment variables
2. Clean up authentication files and directories
3. Update deployment scripts
4. Archive Bailey-related documentation

## Security Considerations

### 1. Token Management
- Store access tokens encrypted in environment variables
- Implement token rotation mechanism
- Monitor token expiration and refresh
- Secure webhook verify tokens

### 2. Webhook Security
- Validate webhook signatures
- Use HTTPS endpoints only
- Implement rate limiting on webhook endpoints
- Log and monitor webhook attempts

### 3. Data Privacy
- Ensure message content is not logged in plain text
- Implement proper data retention policies
- Comply with WhatsApp Business API policies
- Handle user opt-out requests

## Performance Considerations

### 1. Rate Limiting
- WhatsApp Cloud API has rate limits (1000 messages/second)
- Implement queue-based sending with rate limiting
- Use exponential backoff for rate limit errors
- Monitor and alert on rate limit violations

### 2. Webhook Processing
- Asynchronous webhook processing
- Queue webhook payloads for processing
- Batch status updates to database
- Handle webhook replay scenarios

### 3. Caching
- Cache frequently used templates
- Cache phone number validation results
- Implement connection pooling for HTTP requests
- Cache configuration settings

## Monitoring and Observability

### 1. Metrics
- Message send success/failure rates
- Webhook delivery and processing times
- API response times and error rates
- Queue depth and processing lag

### 2. Logging
- Structured logging for all WhatsApp operations
- Message delivery tracking with correlation IDs
- Error logging with context and stack traces
- Webhook processing logs

### 3. Alerting
- Failed message delivery alerts
- API error rate thresholds
- Webhook processing failures
- Token expiration warnings

## Backward Compatibility

### 1. API Interface
- Maintain existing method signatures in WhatsAppService
- Preserve existing controller endpoints
- Keep same response formats
- Maintain error handling patterns

### 2. Configuration
- Support existing environment variable names where possible
- Provide migration guide for new configuration
- Graceful handling of missing configuration
- Clear error messages for configuration issues

### 3. Dependencies
- Remove Bailey dependencies gradually
- Update package.json in phases
- Maintain Docker image compatibility
- Update CI/CD pipelines accordingly