import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import webhookProcessorService from '../services/webhook-processor.service';
import NotificationModel, { NotificationStatus } from '../database/models/notification.model';
import { WhatsAppWebhookPayload } from '../types/whatsapp-cloud-api.types';

// Mock the notification model
jest.mock('../database/models/notification.model', () => {
  const mockSave = jest.fn().mockResolvedValue(true);
  const mockNotification = {
    save: mockSave,
    _id: 'mock-notification-id',
    whatsappStatus: null,
    whatsappDeliveredAt: null,
    whatsappReadAt: null,
    status: 'pending',
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    errorDetails: null,
    whatsappError: null
  };
  
  return {
    __esModule: true,
    default: {
      findOne: jest.fn().mockResolvedValue(mockNotification)
    },
    NotificationStatus: {
      PENDING: 'pending',
      SENT: 'sent',
      DELIVERED: 'delivered',
      FAILED: 'failed'
    }
  };
});

// Mock logger
jest.mock('../utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('WebhookProcessorService - Enhanced', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processWebhookPayload', () => {
    it('should return false for invalid payload structure', async () => {
      // Test various invalid payloads
      const invalidPayloads = [
        undefined,
        null,
        {},
        { object: 'whatsapp_business_account' }, // Missing entry
        { entry: [] }, // Missing object
        { object: 'whatsapp_business_account', entry: [] }, // Empty entry array
        { object: 'whatsapp_business_account', entry: [{}] }, // Entry without changes
        { object: 'whatsapp_business_account', entry: [{ changes: [] }] } // Empty changes array
      ];

      for (const payload of invalidPayloads) {
        const result = await webhookProcessorService.processWebhookPayload(payload as any);
        expect(result).toBe(false);
      }
    });

    it('should handle non-messages field changes', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'business_account_id',
            changes: [
              {
                field: 'some_other_field',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: 'phone_number_id'
                  }
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
      expect(NotificationModel.findOne).not.toHaveBeenCalled();
    });

    it('should handle missing value in changes', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'business_account_id',
            changes: [
              {
                field: 'messages',
                value: null as any
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
    });

    it('should handle webhook errors array', async () => {
      const payload: WhatsAppWebhookPayload = {
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
                  errors: [
                    {
                      code: 1000,
                      title: 'Test Error',
                      message: 'This is a test error',
                      href: 'https://developers.facebook.com/docs/whatsapp/api/errors'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false); // No messages processed, only errors
    });

    it('should handle incoming messages array', async () => {
      const payload: WhatsAppWebhookPayload = {
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
                  messages: [
                    {
                      id: 'wamid.incoming123',
                      from: '9876543210',
                      timestamp: '1634903121',
                      type: 'text',
                      text: {
                        body: 'Hello, this is a test message'
                      }
                    },
                    {
                      id: 'wamid.incoming456',
                      from: '9876543210',
                      timestamp: '1634903122',
                      type: 'image',
                      image: {
                        mime_type: 'image/jpeg',
                        sha256: 'hash',
                        id: 'media-id',
                        caption: 'Test image'
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false); // No status updates processed, only incoming messages logged
    });

    it('should handle exception during processing', async () => {
      // Mock a function to throw an error
      (webhookProcessorService as any).isValidPayload = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      const payload: WhatsAppWebhookPayload = {
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
                  }
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
    });
  });

  describe('processStatusUpdates', () => {
    it('should process sent status update correctly', async () => {
      const messageId = 'wamid.test123';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'sent',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('sent');
      expect(mockNotification.status).toBe(NotificationStatus.SENT);
      expect(mockNotification.sentAt).toBeDefined();
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should process delivered status update correctly', async () => {
      const messageId = 'wamid.test456';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'delivered',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('delivered');
      expect(mockNotification.status).toBe(NotificationStatus.DELIVERED);
      expect(mockNotification.whatsappDeliveredAt).toBeDefined();
      expect(mockNotification.deliveredAt).toBeDefined();
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should process read status update correctly', async () => {
      const messageId = 'wamid.test789';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'read',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('read');
      expect(mockNotification.status).toBe(NotificationStatus.DELIVERED);
      expect(mockNotification.whatsappReadAt).toBeDefined();
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should process failed status update with error details correctly', async () => {
      const messageId = 'wamid.test999';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'failed',
                      timestamp,
                      recipient_id: 'recipient_phone_number',
                      errors: [
                        {
                          code: 131026,
                          title: 'Invalid WhatsApp number',
                          message: 'The provided phone number is not a valid WhatsApp user'
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('failed');
      expect(mockNotification.status).toBe(NotificationStatus.FAILED);
      expect(mockNotification.failedAt).toBeDefined();
      expect(mockNotification.whatsappError).toEqual({
        code: 131026,
        title: 'Invalid WhatsApp number',
        message: 'The provided phone number is not a valid WhatsApp user'
      });
      expect(mockNotification.errorDetails).toContain('WhatsApp error');
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should process failed status update without error details correctly', async () => {
      const messageId = 'wamid.test999';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'failed',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                      // No errors array
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('failed');
      expect(mockNotification.status).toBe(NotificationStatus.FAILED);
      expect(mockNotification.failedAt).toBeDefined();
      expect(mockNotification.errorDetails).toContain('without specific error details');
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should handle unknown status values', async () => {
      const messageId = 'wamid.test999';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'unknown_status' as any,
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      
      expect(mockNotification.whatsappStatus).toBe('unknown_status');
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should handle notification not found', async () => {
      const messageId = 'wamid.notfound';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      // Mock findOne to return null for this test
      (NotificationModel.findOne as jest.Mock).mockResolvedValueOnce(null);
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'delivered',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
    });

    it('should handle invalid status update format', async () => {
      const payload: WhatsAppWebhookPayload = {
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
                      // Missing id
                      status: 'delivered',
                      timestamp: '1634903121',
                      recipient_id: 'recipient_phone_number'
                    } as any
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
      expect(NotificationModel.findOne).not.toHaveBeenCalled();
    });

    it('should handle invalid timestamp format', async () => {
      const messageId = 'wamid.test123';
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'delivered',
                      timestamp: 'invalid-timestamp',
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true); // Should still process with fallback timestamp
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should handle multiple status updates in one payload', async () => {
      const messageId1 = 'wamid.multi1';
      const messageId2 = 'wamid.multi2';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId1,
                      status: 'delivered',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    },
                    {
                      id: messageId2,
                      status: 'read',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledTimes(2);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId1 });
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId2 });
    });

    it('should handle status updates with conversation and pricing info', async () => {
      const messageId = 'wamid.test123';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'delivered',
                      timestamp,
                      recipient_id: 'recipient_phone_number',
                      conversation: {
                        id: 'conversation-id-123',
                        origin: {
                          type: 'business_initiated'
                        }
                      },
                      pricing: {
                        billable: true,
                        pricing_model: 'CBP',
                        category: 'business_initiated'
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(true);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      
      // Get the mock notification that was updated
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should handle exception during status update processing', async () => {
      const messageId = 'wamid.test123';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      // Mock save to throw an error
      const mockNotification = await (NotificationModel.findOne as jest.Mock).mock.results[0].value;
      mockNotification.save.mockRejectedValueOnce(new Error('Database error'));
      
      const payload: WhatsAppWebhookPayload = {
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
                      id: messageId,
                      status: 'delivered',
                      timestamp,
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const result = await webhookProcessorService.processWebhookPayload(payload);
      expect(result).toBe(false);
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
    });
  });
});