import webhookProcessorService from '../services/webhook-processor.service';
import NotificationModel, { NotificationStatus } from '../database/models/notification.model';
import { notificationRepository } from '../database/repositories/notification.repository';
import { WhatsAppWebhookPayload, WhatsAppMessageStatus } from '../types/whatsapp-cloud-api.types';

// Mock dependencies
jest.mock('../database/models/notification.model');
jest.mock('../database/repositories/notification.repository');
jest.mock('../utils/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

describe('WebhookProcessorService', () => {
  const mockNotificationModel = NotificationModel as jest.Mocked<typeof NotificationModel>;
  const mockNotificationRepository = notificationRepository as jest.Mocked<typeof notificationRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processWebhookPayload', () => {
    it('should successfully process valid webhook payload with status updates', async () => {
      // Arrange
      const messageId = 'wamid.test123';
      const mockNotification = {
        _id: 'notification123',
        whatsappMessageId: messageId,
        status: NotificationStatus.SENT,
        whatsappStatus: 'sent'
      };

      mockNotificationModel.findOne = jest.fn().mockResolvedValue(mockNotification);
      mockNotificationRepository.update = jest.fn().mockResolvedValue({ ...mockNotification, whatsappStatus: 'delivered' });

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
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(true);
      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        mockNotification._id,
        expect.objectContaining({
          whatsappStatus: 'delivered',
          whatsappDeliveredAt: expect.any(Date),
          deliveredAt: expect.any(Date),
          status: NotificationStatus.DELIVERED
        })
      );
    });

    it('should handle malformed webhook payload gracefully', async () => {
      // Arrange
      const malformedPayload = {
        object: 'whatsapp_business_account',
        // Missing entry field
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(malformedPayload as any);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).not.toHaveBeenCalled();
      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });

    it('should handle empty payload gracefully', async () => {
      // Act
      const result = await webhookProcessorService.processWebhookPayload(null as any);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).not.toHaveBeenCalled();
      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });

    it('should handle payload with invalid entry structure', async () => {
      // Arrange
      const invalidPayload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'business_account_id',
            changes: [
              {
                field: 'messages',
                value: null as any // Invalid value
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(invalidPayload);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).not.toHaveBeenCalled();
    });

    it('should process failed message status with error details', async () => {
      // Arrange
      const messageId = 'wamid.test456';
      const mockNotification = {
        _id: 'notification456',
        whatsappMessageId: messageId,
        status: NotificationStatus.SENT,
        whatsappStatus: 'sent'
      };

      mockNotificationModel.findOne = jest.fn().mockResolvedValue(mockNotification);
      mockNotificationRepository.update = jest.fn().mockResolvedValue({ ...mockNotification, status: NotificationStatus.FAILED });

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
                      timestamp: Math.floor(Date.now() / 1000).toString(),
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

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(true);
      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        mockNotification._id,
        expect.objectContaining({
          whatsappStatus: 'failed',
          status: NotificationStatus.FAILED,
          failedAt: expect.any(Date),
          whatsappError: {
            code: 131026,
            title: 'Invalid WhatsApp number',
            message: 'The provided phone number is not a valid WhatsApp user'
          },
          errorDetails: 'WhatsApp error: The provided phone number is not a valid WhatsApp user (code: 131026)'
        })
      );
    });

    it('should handle notification not found scenario', async () => {
      // Arrange
      const messageId = 'wamid.nonexistent';
      mockNotificationModel.findOne = jest.fn().mockResolvedValue(null);

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
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });

    it('should handle database update failure gracefully', async () => {
      // Arrange
      const messageId = 'wamid.test789';
      const mockNotification = {
        _id: 'notification789',
        whatsappMessageId: messageId,
        status: NotificationStatus.SENT,
        whatsappStatus: 'sent'
      };

      mockNotificationModel.findOne = jest.fn().mockResolvedValue(mockNotification);
      mockNotificationRepository.update = jest.fn().mockResolvedValue(null); // Simulate update failure

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
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      expect(mockNotificationRepository.update).toHaveBeenCalled();
    });

    it('should process multiple status updates in single payload', async () => {
      // Arrange
      const messageId1 = 'wamid.test001';
      const messageId2 = 'wamid.test002';
      
      const mockNotification1 = {
        _id: 'notification001',
        whatsappMessageId: messageId1,
        status: NotificationStatus.SENT
      };
      
      const mockNotification2 = {
        _id: 'notification002',
        whatsappMessageId: messageId2,
        status: NotificationStatus.SENT
      };

      mockNotificationModel.findOne = jest.fn()
        .mockResolvedValueOnce(mockNotification1)
        .mockResolvedValueOnce(mockNotification2);
      
      mockNotificationRepository.update = jest.fn()
        .mockResolvedValueOnce({ ...mockNotification1, whatsappStatus: 'delivered' })
        .mockResolvedValueOnce({ ...mockNotification2, whatsappStatus: 'read' });

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
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: 'recipient1'
                    },
                    {
                      id: messageId2,
                      status: 'read',
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: 'recipient2'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(true);
      expect(mockNotificationModel.findOne).toHaveBeenCalledTimes(2);
      expect(mockNotificationRepository.update).toHaveBeenCalledTimes(2);
    });

    it('should handle invalid timestamp formats gracefully', async () => {
      // Arrange
      const messageId = 'wamid.test_invalid_timestamp';
      const mockNotification = {
        _id: 'notification_invalid_timestamp',
        whatsappMessageId: messageId,
        status: NotificationStatus.SENT
      };

      mockNotificationModel.findOne = jest.fn().mockResolvedValue(mockNotification);
      mockNotificationRepository.update = jest.fn().mockResolvedValue({ ...mockNotification, whatsappStatus: 'delivered' });

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
                      timestamp: 'invalid_timestamp_format',
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(true);
      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        mockNotification._id,
        expect.objectContaining({
          whatsappStatus: 'delivered',
          whatsappDeliveredAt: expect.any(Date), // Should fallback to current time
          status: NotificationStatus.DELIVERED
        })
      );
    });

    it('should skip non-messages field changes', async () => {
      // Arrange
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'business_account_id',
            changes: [
              {
                field: 'account_alerts', // Non-messages field
                value: {
                  some: 'data'
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(false);
      expect(mockNotificationModel.findOne).not.toHaveBeenCalled();
      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });

    it('should handle webhook errors in payload', async () => {
      // Arrange
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
                      code: 131008,
                      title: 'Rate limit exceeded',
                      message: 'Too many messages sent'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(false); // No status updates processed, only errors logged
    });

    it('should handle incoming messages logging', async () => {
      // Arrange
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
                      id: 'incoming_message_123',
                      from: '1234567890',
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'text',
                      text: {
                        body: 'Hello, this is a test message'
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Act
      const result = await webhookProcessorService.processWebhookPayload(payload);

      // Assert
      expect(result).toBe(false); // No status updates processed, only incoming messages logged
    });
  });
});