import { Request, Response } from 'express';
import crypto from 'crypto';
import { WhatsAppWebhookController } from '../api/controllers/whatsapp-webhook.controller';
import { NotificationModel } from '../database/models/notification.model';
import config from '../config';
import { WEBHOOK_CONFIG } from '../constants/whatsapp-cloud-api.constants';

// Mock dependencies
jest.mock('../database/models/notification.model');
jest.mock('../config', () => ({
  whatsapp: {
    webhookVerifyToken: 'test_webhook_verify_token',
    enableWebhookValidation: true
  }
}));

describe('WhatsAppWebhookController', () => {
  let controller: WhatsAppWebhookController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let responseObj: any;

  beforeEach(() => {
    controller = new WhatsAppWebhookController();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock response
    responseObj = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
    
    mockResponse = responseObj;
    
    // Mock request
    mockRequest = {
      query: {},
      body: {},
      headers: {}
    };
  });

  describe('verifyWebhook', () => {
    it('should return challenge when verification is successful', () => {
      // Arrange
      const challenge = 'test_challenge';
      mockRequest.query = {
        [WEBHOOK_CONFIG.MODE_PARAM]: WEBHOOK_CONFIG.SUBSCRIBE_MODE,
        [WEBHOOK_CONFIG.VERIFY_TOKEN_PARAM]: config.whatsapp.webhookVerifyToken,
        [WEBHOOK_CONFIG.CHALLENGE_PARAM]: challenge
      };

      // Act
      controller.verifyWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(responseObj.status).toHaveBeenCalledWith(200);
      expect(responseObj.send).toHaveBeenCalledWith(challenge);
    });

    it('should return 403 when verification token is invalid', () => {
      // Arrange
      mockRequest.query = {
        [WEBHOOK_CONFIG.MODE_PARAM]: WEBHOOK_CONFIG.SUBSCRIBE_MODE,
        [WEBHOOK_CONFIG.VERIFY_TOKEN_PARAM]: 'invalid_token',
        [WEBHOOK_CONFIG.CHALLENGE_PARAM]: 'test_challenge'
      };

      // Act
      controller.verifyWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(responseObj.status).toHaveBeenCalledWith(403);
      expect(responseObj.json).toHaveBeenCalledWith({ error: 'Verification failed' });
    });

    it('should return 403 when mode is invalid', () => {
      // Arrange
      mockRequest.query = {
        [WEBHOOK_CONFIG.MODE_PARAM]: 'invalid_mode',
        [WEBHOOK_CONFIG.VERIFY_TOKEN_PARAM]: config.whatsapp.webhookVerifyToken,
        [WEBHOOK_CONFIG.CHALLENGE_PARAM]: 'test_challenge'
      };

      // Act
      controller.verifyWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(responseObj.status).toHaveBeenCalledWith(403);
      expect(responseObj.json).toHaveBeenCalledWith({ error: 'Verification failed' });
    });
  });

  describe('handleWebhook', () => {
    it('should acknowledge receipt with 200 OK', async () => {
      // Arrange
      mockRequest.body = {
        object: 'whatsapp_business_account',
        entry: []
      };
      (mockRequest as any).rawBody = JSON.stringify(mockRequest.body);

      // Act
      await controller.handleWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(responseObj.status).toHaveBeenCalledWith(200);
      expect(responseObj.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    });

    it('should validate webhook signature when validation is enabled', async () => {
      // Arrange
      const payload = {
        object: 'whatsapp_business_account',
        entry: []
      };
      const rawBody = JSON.stringify(payload);
      (mockRequest as any).rawBody = rawBody;
      mockRequest.body = payload;
      
      // Create a valid signature
      const hmac = crypto.createHmac('sha256', config.whatsapp.webhookVerifyToken);
      hmac.update(rawBody);
      const signature = `sha256=${hmac.digest('hex')}`;
      
      mockRequest.headers = {
        [WEBHOOK_CONFIG.SIGNATURE_HEADER]: signature
      };

      // Act
      await controller.handleWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(responseObj.status).toHaveBeenCalledWith(200);
    });

    it('should process status updates from webhook payload', async () => {
      // Arrange
      const messageId = 'wamid.test123';
      const mockNotification = {
        _id: 'notification123',
        whatsappMessageId: messageId,
        whatsappStatus: null,
        whatsappDeliveredAt: null,
        whatsappReadAt: null,
        save: jest.fn().mockResolvedValue(true)
      };
      
      (NotificationModel.findOne as jest.Mock).mockResolvedValue(mockNotification);
      
      const payload = {
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
                      timestamp: Math.floor(Date.now() / 1000),
                      recipient_id: 'recipient_phone_number'
                    }
                  ]
                }
              }
            ]
          }
        ]
      };
      
      const rawBody = JSON.stringify(payload);
      (mockRequest as any).rawBody = rawBody;
      mockRequest.body = payload;
      
      // Create a valid signature
      const hmac = crypto.createHmac('sha256', config.whatsapp.webhookVerifyToken);
      hmac.update(rawBody);
      const signature = `sha256=${hmac.digest('hex')}`;
      
      mockRequest.headers = {
        [WEBHOOK_CONFIG.SIGNATURE_HEADER]: signature
      };

      // Act
      await controller.handleWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      expect(mockNotification.whatsappStatus).toBe('delivered');
      expect(mockNotification.whatsappDeliveredAt).toBeDefined();
      expect(mockNotification.save).toHaveBeenCalled();
    });

    it('should handle failed message status with error details', async () => {
      // Arrange
      const messageId = 'wamid.test123';
      const mockNotification = {
        _id: 'notification123',
        whatsappMessageId: messageId,
        whatsappStatus: null,
        whatsappError: null,
        save: jest.fn().mockResolvedValue(true)
      };
      
      (NotificationModel.findOne as jest.Mock).mockResolvedValue(mockNotification);
      
      const payload = {
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
                      timestamp: Math.floor(Date.now() / 1000),
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
      
      const rawBody = JSON.stringify(payload);
      (mockRequest as any).rawBody = rawBody;
      mockRequest.body = payload;
      
      // Create a valid signature
      const hmac = crypto.createHmac('sha256', config.whatsapp.webhookVerifyToken);
      hmac.update(rawBody);
      const signature = `sha256=${hmac.digest('hex')}`;
      
      mockRequest.headers = {
        [WEBHOOK_CONFIG.SIGNATURE_HEADER]: signature
      };

      // Act
      await controller.handleWebhook(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(NotificationModel.findOne).toHaveBeenCalledWith({ whatsappMessageId: messageId });
      expect(mockNotification.whatsappStatus).toBe('failed');
      expect(mockNotification.whatsappError).toEqual({
        code: 131026,
        title: 'Invalid WhatsApp number',
        message: 'The provided phone number is not a valid WhatsApp user'
      });
      expect(mockNotification.save).toHaveBeenCalled();
    });
  });
});