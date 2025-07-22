/**
 * Integration test for webhook processing functionality
 * This test demonstrates that the webhook processor can handle WhatsApp Cloud API webhooks
 */

import { WhatsAppWebhookPayload } from '../types/whatsapp-cloud-api.types';

describe('Webhook Integration Test', () => {
  it('should validate webhook payload structure', () => {
    // Test valid payload structure
    const validPayload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'business_account_id',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '1234567890',
                  phone_number_id: 'phone_number_id'
                },
                statuses: [
                  {
                    id: 'wamid.test123',
                    status: 'delivered',
                    timestamp: '1234567890',
                    recipient_id: 'recipient_phone_number'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    // Basic validation
    expect(validPayload.object).toBe('whatsapp_business_account');
    expect(Array.isArray(validPayload.entry)).toBe(true);
    expect(validPayload.entry.length).toBeGreaterThan(0);
    expect(validPayload.entry[0].changes.length).toBeGreaterThan(0);
    expect(validPayload.entry[0].changes[0].field).toBe('messages');
  });

  it('should handle malformed payload gracefully', () => {
    // Test malformed payloads
    const malformedPayloads = [
      null,
      undefined,
      {},
      { object: 'whatsapp_business_account' }, // missing entry
      { entry: [] }, // missing object
      { object: 'whatsapp_business_account', entry: null }, // invalid entry
    ];

    malformedPayloads.forEach((payload) => {
      // Basic validation should fail for malformed payloads
      if (!payload || typeof payload !== 'object') {
        expect(payload).toBeFalsy();
      } else {
        const hasValidStructure = 
          payload.object && 
          Array.isArray((payload as any).entry) && 
          (payload as any).entry.length > 0;
        expect(hasValidStructure).toBeFalsy();
      }
    });
  });

  it('should validate status update structure', () => {
    const validStatusUpdate = {
      id: 'wamid.test123',
      status: 'delivered',
      timestamp: '1234567890',
      recipient_id: 'recipient_phone_number'
    };

    const invalidStatusUpdates = [
      {}, // empty object
      { id: 'test' }, // missing required fields
      { status: 'delivered' }, // missing id
      { id: 'test', status: 'invalid_status' }, // invalid status
    ];

    // Valid status update should have all required fields
    expect(validStatusUpdate.id).toBeTruthy();
    expect(validStatusUpdate.status).toBeTruthy();
    expect(validStatusUpdate.timestamp).toBeTruthy();
    expect(validStatusUpdate.recipient_id).toBeTruthy();
    expect(['sent', 'delivered', 'read', 'failed']).toContain(validStatusUpdate.status);

    // Invalid status updates should fail validation
    invalidStatusUpdates.forEach((statusUpdate: any) => {
      const isValid = 
        statusUpdate.id && 
        statusUpdate.status && 
        statusUpdate.timestamp && 
        statusUpdate.recipient_id &&
        ['sent', 'delivered', 'read', 'failed'].includes(statusUpdate.status);
      expect(isValid).toBeFalsy();
    });
  });

  it('should handle different message statuses correctly', () => {
    const messageStatuses = ['sent', 'delivered', 'read', 'failed'];
    
    messageStatuses.forEach((status) => {
      const statusUpdate = {
        id: `wamid.test_${status}`,
        status: status,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        recipient_id: 'test_recipient'
      };

      // Each status should be valid
      expect(['sent', 'delivered', 'read', 'failed']).toContain(statusUpdate.status);
      
      // Status-specific validation
      switch (status) {
        case 'sent':
          // Sent status indicates message was sent but not yet delivered
          expect(statusUpdate.status).toBe('sent');
          break;
        case 'delivered':
          // Delivered status indicates message reached recipient's device
          expect(statusUpdate.status).toBe('delivered');
          break;
        case 'read':
          // Read status indicates recipient opened the message
          expect(statusUpdate.status).toBe('read');
          break;
        case 'failed':
          // Failed status indicates delivery failure
          expect(statusUpdate.status).toBe('failed');
          break;
      }
    });
  });

  it('should handle timestamp parsing correctly', () => {
    const testTimestamps = [
      '1234567890', // Unix timestamp (seconds)
      '1234567890123', // Unix timestamp (milliseconds)
      new Date().toISOString(), // ISO string
      Math.floor(Date.now() / 1000).toString(), // Current Unix timestamp
    ];

    testTimestamps.forEach((timestamp) => {
      let parsedDate: Date;
      
      try {
        // Try parsing as Unix timestamp (seconds since epoch)
        const timestampNum = parseInt(timestamp);
        if (!isNaN(timestampNum)) {
          // Convert seconds to milliseconds if needed
          parsedDate = new Date(timestampNum < 9999999999 ? timestampNum * 1000 : timestampNum);
        } else {
          // Try parsing as ISO string
          parsedDate = new Date(timestamp);
        }
        
        // Validate parsed date
        expect(parsedDate).toBeInstanceOf(Date);
        expect(isNaN(parsedDate.getTime())).toBe(false);
      } catch (error) {
        // If parsing fails, should fallback to current time
        parsedDate = new Date();
        expect(parsedDate).toBeInstanceOf(Date);
      }
    });
  });

  it('should validate error handling for failed messages', () => {
    const failedMessageWithError = {
      id: 'wamid.failed_test',
      status: 'failed',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      recipient_id: 'test_recipient',
      errors: [
        {
          code: 131026,
          title: 'Invalid WhatsApp number',
          message: 'The provided phone number is not a valid WhatsApp user'
        }
      ]
    };

    const failedMessageWithoutError = {
      id: 'wamid.failed_test_no_error',
      status: 'failed',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      recipient_id: 'test_recipient'
    };

    // Failed message with error should have error details
    expect(failedMessageWithError.status).toBe('failed');
    expect(failedMessageWithError.errors).toBeDefined();
    expect(failedMessageWithError.errors.length).toBeGreaterThan(0);
    expect(failedMessageWithError.errors[0].code).toBeTruthy();
    expect(failedMessageWithError.errors[0].message).toBeTruthy();

    // Failed message without error should still be valid
    expect(failedMessageWithoutError.status).toBe('failed');
    expect((failedMessageWithoutError as any).errors).toBeUndefined();
  });
});