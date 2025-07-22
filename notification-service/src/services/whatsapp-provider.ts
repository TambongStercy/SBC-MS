import whatsAppServiceFactory from './whatsapp-service-factory';
import logger from '../utils/logger';

const log = logger.getLogger('WhatsAppProvider');

/**
 * WhatsApp Provider Service
 * This service acts as a facade for the underlying WhatsApp implementation
 * (either Bailey or Cloud API) and ensures backward compatibility with existing code.
 */
class WhatsAppProvider {
  private service;

  constructor() {
    this.service = whatsAppServiceFactory.getService();
    log.info('WhatsApp Provider initialized');
  }

  /**
   * Send a text message via WhatsApp
   * @param params.phoneNumber Recipient phone number
   * @param params.message Text message content
   * @returns Promise resolving to boolean indicating success
   */
  public async sendTextMessage({ phoneNumber, message }: { phoneNumber: string, message: string }): Promise<boolean> {
    return this.service.sendTextMessage({ phoneNumber, message });
  }

  /**
   * Send multiple text messages via WhatsApp
   * @param params.phoneNumber Recipient phone number
   * @param params.messages Array of text message contents
   * @returns Promise resolving to boolean indicating success
   */
  public async sendMultipleTextMessages({ phoneNumber, messages }: { phoneNumber: string, messages: string[] }): Promise<boolean> {
    return this.service.sendMultipleTextMessages({ phoneNumber, messages });
  }

  /**
   * Send a file message via WhatsApp
   * @param params.phoneNumber Recipient phone number
   * @param params.buffer File buffer
   * @param params.mimetype File MIME type
   * @param params.fileName Optional file name
   * @param params.caption Optional caption for the file
   * @returns Promise resolving to boolean indicating success
   */
  public async sendFileMessage({ phoneNumber, buffer, mimetype, fileName, caption }: {
    phoneNumber: string,
    buffer: Buffer,
    mimetype: string,
    fileName?: string,
    caption?: string
  }): Promise<boolean> {
    return this.service.sendFileMessage({ phoneNumber, buffer, mimetype, fileName, caption });
  }

  /**
   * Send a transaction notification via WhatsApp
   * @param data Transaction data
   * @returns Promise resolving to boolean indicating success
   */
  public async sendTransactionNotification(data: {
    phoneNumber: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
  }): Promise<boolean> {
    return this.service.sendTransactionNotification(data);
  }

  /**
   * Get the connection status of the WhatsApp service
   * @returns Object with connection status information
   */
  public getConnectionStatus(): any {
    return this.service.getConnectionStatus();
  }

  /**
   * Register a callback for disconnection events
   * @param cb Callback function
   */
  public onDisconnect(cb: any): void {
    this.service.onDisconnect(cb);
  }

  /**
   * Get the latest QR code (Bailey-specific)
   * This method is maintained for backward compatibility but will return null when using Cloud API
   * @returns Object with QR code and timestamp or null if using Cloud API
   */
  public getLatestQr(): { qr: string | null, timestamp: number } | null {
    // Check if the service has this method (Bailey-specific)
    if ('getLatestQr' in this.service) {
      return (this.service as any).getLatestQr();
    }
    
    // Return null for Cloud API implementation
    return { qr: null, timestamp: 0 };
  }

  /**
   * Logout from WhatsApp (Bailey-specific)
   * This method is maintained for backward compatibility but will be a no-op when using Cloud API
   * @returns Promise resolving to object with success status and message
   */
  public async logout(): Promise<{ success: boolean, message?: string }> {
    // Check if the service has this method (Bailey-specific)
    if ('logout' in this.service) {
      return (this.service as any).logout();
    }
    
    // Return success for Cloud API implementation (no-op)
    return { success: true, message: 'Operation not applicable for Cloud API' };
  }

  /**
   * Force reconnect to WhatsApp (Bailey-specific)
   * This method is maintained for backward compatibility but will be a no-op when using Cloud API
   * @returns Promise resolving to object with success status and message
   */
  public async forceReconnect(): Promise<{ success: boolean, message?: string }> {
    // Check if the service has this method (Bailey-specific)
    if ('forceReconnect' in this.service) {
      return (this.service as any).forceReconnect();
    }
    
    // Return success for Cloud API implementation (no-op)
    return { success: true, message: 'Operation not applicable for Cloud API' };
  }
}

// Export a singleton instance
export default new WhatsAppProvider();