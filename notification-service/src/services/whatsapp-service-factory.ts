import { EventEmitter } from 'events';
import config from '../config';
import logger from '../utils/logger';
import baileyWhatsAppService from './whatsapp.service';
import cloudWhatsAppService from './whatsapp-cloud.service';

const log = logger.getLogger('WhatsAppServiceFactory');

/**
 * Enhanced response type for WhatsApp message sending
 */
export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  messageIds?: string[]; // For multiple messages
  error?: string;
  sentCount?: number; // For multiple messages
  totalCount?: number; // For multiple messages
}

/**
 * Interface that defines the common methods between Bailey and Cloud API implementations
 */
export interface IWhatsAppService extends EventEmitter {
  // Enhanced methods that return detailed results
  sendTextMessageEnhanced?(params: { phoneNumber: string, message: string }): Promise<WhatsAppSendResult>;
  sendMultipleTextMessagesEnhanced?(params: { phoneNumber: string, messages: string[] }): Promise<WhatsAppSendResult>;
  sendFileMessageEnhanced?(params: {
    phoneNumber: string,
    buffer: Buffer,
    mimetype: string,
    fileName?: string,
    caption?: string
  }): Promise<WhatsAppSendResult>;

  // Legacy methods that return boolean (for backward compatibility)
  sendTextMessage(params: { phoneNumber: string, message: string }): Promise<boolean>;
  sendMultipleTextMessages(params: { phoneNumber: string, messages: string[] }): Promise<boolean>;
  sendFileMessage(params: {
    phoneNumber: string,
    buffer: Buffer,
    mimetype: string,
    fileName?: string,
    caption?: string
  }): Promise<boolean>;
  sendTransactionNotification(data: {
    phoneNumber: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
  }): Promise<boolean>;
  getConnectionStatus(): any; // Return type varies between implementations
  onDisconnect(cb: any): void; // Callback parameter type varies between implementations
}

/**
 * Factory class to get the appropriate WhatsApp service implementation
 * based on configuration
 */
class WhatsAppServiceFactory {
  /**
   * Get the appropriate WhatsApp service implementation
   * @returns The WhatsApp service implementation based on configuration
   */
  public getService(): IWhatsAppService {
    const useCloudApi = config.whatsapp.enableCloudApi;

    log.info(`Using WhatsApp ${useCloudApi ? 'Cloud API' : 'Bailey'} implementation`);

    if (useCloudApi) {
      return cloudWhatsAppService;
    } else {
      return baileyWhatsAppService;
    }
  }

  /**
   * Check if the current service supports enhanced methods with message ID tracking
   */
  public supportsEnhancedMethods(): boolean {
    return config.whatsapp.enableCloudApi;
  }
}

// Export a singleton instance
export default new WhatsAppServiceFactory();