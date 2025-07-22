import { WhatsAppWebhookPayload, WhatsAppMessageStatus, WhatsAppIncomingMessage, WhatsAppErrorDetails } from '../types/whatsapp-cloud-api.types';
import NotificationModel, { NotificationStatus } from '../database/models/notification.model';
import { notificationRepository } from '../database/repositories/notification.repository';
import logger from '../utils/logger';

const log = logger.getLogger('WebhookProcessorService');

/**
 * Service for processing WhatsApp webhook events
 */
class WebhookProcessorService {
  /**
   * Process a WhatsApp webhook payload
   * 
   * @param payload The webhook payload from WhatsApp Cloud API
   * @returns Promise resolving to boolean indicating success
   */
  public async processWebhookPayload(payload: WhatsAppWebhookPayload): Promise<boolean> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();
    
    try {
      log.info('Starting webhook payload processing', {
        correlationId,
        object: payload?.object,
        entryCount: payload?.entry?.length || 0,
        timestamp: new Date().toISOString()
      });
      
      // Enhanced payload validation with detailed error reporting
      const validationResult = this.validatePayloadStructure(payload);
      if (!validationResult.isValid) {
        log.error('Webhook payload validation failed', {
          correlationId,
          errors: validationResult.errors,
          payload: this.sanitizePayloadForLogging(payload)
        });
        return false;
      }
      
      let processedCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      
      // Process each entry in the payload
      for (const [entryIndex, entry] of payload.entry.entries()) {
        try {
          log.debug('Processing webhook entry', {
            correlationId,
            entryIndex,
            entryId: entry.id,
            changeCount: entry.changes?.length || 0
          });
          
          // Process each change in the entry
          for (const [changeIndex, change] of entry.changes.entries()) {
            try {
              // Enhanced change validation
              if (!this.isValidChange(change)) {
                log.warn('Invalid change structure in webhook payload', {
                  correlationId,
                  entryIndex,
                  changeIndex,
                  field: change?.field,
                  hasValue: Boolean(change?.value)
                });
                skippedCount++;
                continue;
              }
              
              // Only process messages field changes
              if (change.field !== 'messages') {
                log.debug('Skipping non-messages field change', {
                  correlationId,
                  field: change.field,
                  entryIndex,
                  changeIndex
                });
                skippedCount++;
                continue;
              }
              
              const value = change.value;
              
              // Process message status updates
              if (value.statuses && Array.isArray(value.statuses) && value.statuses.length > 0) {
                log.info('Processing message status updates', {
                  correlationId,
                  count: value.statuses.length,
                  phoneNumberId: value.metadata?.phone_number_id
                });
                
                const result = await this.processStatusUpdates(value.statuses, correlationId);
                processedCount += result.processed;
                errorCount += result.errors;
              }
              
              // Process incoming messages (for future use)
              if (value.messages && Array.isArray(value.messages) && value.messages.length > 0) {
                log.info('Received incoming messages in webhook', {
                  correlationId,
                  count: value.messages.length,
                  phoneNumberId: value.metadata?.phone_number_id
                });
                this.logIncomingMessages(value.messages, correlationId);
              }
              
              // Process errors at the webhook level
              if (value.errors && Array.isArray(value.errors) && value.errors.length > 0) {
                log.warn('Received errors in webhook payload', {
                  correlationId,
                  count: value.errors.length,
                  phoneNumberId: value.metadata?.phone_number_id
                });
                this.logWebhookErrors(value.errors, correlationId);
                errorCount += value.errors.length;
              }
            } catch (changeError) {
              log.error('Error processing webhook change', {
                correlationId,
                entryIndex,
                changeIndex,
                error: changeError instanceof Error ? changeError.message : String(changeError),
                stack: changeError instanceof Error ? changeError.stack : undefined
              });
              errorCount++;
            }
          }
        } catch (entryError) {
          log.error('Error processing webhook entry', {
            correlationId,
            entryIndex,
            entryId: entry?.id,
            error: entryError instanceof Error ? entryError.message : String(entryError),
            stack: entryError instanceof Error ? entryError.stack : undefined
          });
          errorCount++;
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      log.info('Completed webhook payload processing', {
        correlationId,
        processedCount,
        errorCount,
        skippedCount,
        processingTimeMs: processingTime,
        success: processedCount > 0,
        timestamp: new Date().toISOString()
      });
      
      return processedCount > 0;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      log.error('Critical error processing webhook payload', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }
  
  /**
   * Process message status updates
   * 
   * @param statuses Array of message status updates
   * @param correlationId Correlation ID for tracking
   * @returns Object with counts of processed and error statuses
   */
  private async processStatusUpdates(statuses: WhatsAppMessageStatus[], correlationId: string): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;
    
    log.info('Processing message status updates', {
      correlationId,
      count: statuses.length,
      timestamp: new Date().toISOString()
    });
    
    for (const [statusIndex, status] of statuses.entries()) {
      const statusStartTime = Date.now();
      
      try {
        // Enhanced validation of required fields in status update
        const validationErrors = this.validateStatusUpdate(status);
        if (validationErrors.length > 0) {
          log.warn('Invalid status update in webhook payload', {
            correlationId,
            statusIndex,
            errors: validationErrors,
            messageId: status?.id,
            status: status?.status,
            timestamp: status?.timestamp
          });
          errors++;
          continue;
        }
        
        const messageId = status.id;
        const statusValue = status.status;
        
        // Parse and validate timestamp
        const timestamp = this.parseTimestamp(status.timestamp, messageId, correlationId);
        
        log.debug('Processing message status update', {
          correlationId,
          statusIndex,
          messageId,
          status: statusValue,
          timestamp: timestamp.toISOString(),
          recipientId: status.recipient_id
        });
        
        // Find the notification by WhatsApp message ID
        const notification = await NotificationModel.findOne({ whatsappMessageId: messageId });
        
        if (!notification) {
          log.warn('No notification found for WhatsApp message ID', {
            correlationId,
            messageId,
            recipientId: status.recipient_id,
            status: statusValue,
            statusIndex
          });
          errors++;
          continue;
        }
        
        // Prepare update data
        const updateData = this.prepareNotificationUpdate(status, timestamp, notification);
        
        // Log the status change
        this.logStatusChange(notification, statusValue, status, correlationId);
        
        // Update the notification using repository
        const updatedNotification = await notificationRepository.update(notification._id, updateData);
        
        if (!updatedNotification) {
          log.error('Failed to update notification in database', {
            correlationId,
            notificationId: notification._id,
            messageId,
            statusIndex
          });
          errors++;
          continue;
        }
        
        // Log additional metadata if available
        this.logAdditionalMetadata(status, correlationId);
        
        const statusProcessingTime = Date.now() - statusStartTime;
        
        log.info('Successfully updated notification with WhatsApp status', {
          correlationId,
          notificationId: notification._id,
          messageId,
          oldStatus: notification.status,
          newStatus: statusValue,
          processingTimeMs: statusProcessingTime,
          statusIndex
        });
        
        processed++;
      } catch (error) {
        const statusProcessingTime = Date.now() - statusStartTime;
        
        log.error('Error processing status update', {
          correlationId,
          statusIndex,
          messageId: status?.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          processingTimeMs: statusProcessingTime
        });
        errors++;
      }
    }
    
    log.info('Completed processing message status updates', {
      correlationId,
      totalStatuses: statuses.length,
      processed,
      errors,
      successRate: statuses.length > 0 ? ((processed / statuses.length) * 100).toFixed(2) + '%' : '0%'
    });
    
    return { processed, errors };
  }

  /**
   * Validate status update structure and required fields
   * 
   * @param status Status update to validate
   * @returns Array of validation errors
   */
  private validateStatusUpdate(status: any): string[] {
    const errors: string[] = [];

    if (!status || typeof status !== 'object') {
      errors.push('Status update is not an object');
      return errors;
    }

    if (!status.id || typeof status.id !== 'string') {
      errors.push('Missing or invalid message ID');
    }

    if (!status.status || typeof status.status !== 'string') {
      errors.push('Missing or invalid status value');
    }

    if (!status.timestamp) {
      errors.push('Missing timestamp');
    }

    if (!status.recipient_id || typeof status.recipient_id !== 'string') {
      errors.push('Missing or invalid recipient ID');
    }

    // Validate status value is one of the expected values
    const validStatuses = ['sent', 'delivered', 'read', 'failed'];
    if (status.status && !validStatuses.includes(status.status)) {
      errors.push(`Invalid status value: ${status.status}`);
    }

    return errors;
  }

  /**
   * Parse timestamp from various formats
   * 
   * @param timestampValue Timestamp value to parse
   * @param messageId Message ID for logging context
   * @param correlationId Correlation ID for tracking
   * @returns Parsed Date object
   */
  private parseTimestamp(timestampValue: string, messageId: string, correlationId: string): Date {
    try {
      // Try parsing as Unix timestamp (seconds since epoch)
      const timestampNum = parseInt(timestampValue);
      if (!isNaN(timestampNum)) {
        // Convert seconds to milliseconds if needed (Unix timestamps are typically 10 digits)
        const timestamp = new Date(timestampNum < 9999999999 ? timestampNum * 1000 : timestampNum);
        
        // Validate parsed date is reasonable (not too far in past or future)
        const now = Date.now();
        const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
        const oneHourFromNow = now + (60 * 60 * 1000);
        
        if (timestamp.getTime() < oneYearAgo || timestamp.getTime() > oneHourFromNow) {
          log.warn('Parsed timestamp seems unreasonable, using current time', {
            correlationId,
            messageId,
            originalTimestamp: timestampValue,
            parsedTimestamp: timestamp.toISOString()
          });
          return new Date();
        }
        
        return timestamp;
      } else {
        // Try parsing as ISO string
        const timestamp = new Date(timestampValue);
        
        // Validate parsed date
        if (isNaN(timestamp.getTime())) {
          throw new Error('Invalid date format');
        }
        
        return timestamp;
      }
    } catch (error) {
      log.warn('Invalid timestamp format in status update, using current time', {
        correlationId,
        messageId,
        originalTimestamp: timestampValue,
        error: error instanceof Error ? error.message : String(error)
      });
      return new Date(); // Fallback to current time
    }
  }

  /**
   * Prepare notification update data based on WhatsApp status
   * 
   * @param status WhatsApp message status
   * @param timestamp Parsed timestamp
   * @param notification Current notification
   * @returns Update data object
   */
  private prepareNotificationUpdate(status: WhatsAppMessageStatus, timestamp: Date, notification: any): any {
    const updateData: any = {
      whatsappStatus: status.status
    };

    switch (status.status) {
      case 'sent':
        // Message was sent but not yet delivered
        if (!notification.sentAt) {
          updateData.sentAt = timestamp;
        }
        if (notification.status === NotificationStatus.PENDING) {
          updateData.status = NotificationStatus.SENT;
        }
        break;
        
      case 'delivered':
        // Message was delivered to the recipient's device
        updateData.whatsappDeliveredAt = timestamp;
        if (!notification.deliveredAt) {
          updateData.deliveredAt = timestamp;
        }
        updateData.status = NotificationStatus.DELIVERED;
        break;
        
      case 'read':
        // Message was read by the recipient
        updateData.whatsappReadAt = timestamp;
        updateData.status = NotificationStatus.DELIVERED;
        break;
        
      case 'failed':
        // Message failed to deliver
        updateData.status = NotificationStatus.FAILED;
        updateData.failedAt = timestamp;
        
        // Store error information if available
        if (status.errors && status.errors.length > 0) {
          const error = status.errors[0];
          updateData.whatsappError = {
            code: error.code,
            title: error.title,
            message: error.message
          };
          updateData.errorDetails = `WhatsApp error: ${error.message} (code: ${error.code})`;
        } else {
          updateData.errorDetails = 'WhatsApp message delivery failed without specific error details';
        }
        break;
        
      default:
        // Unknown status - log but don't update notification status
        log.warn('Unknown WhatsApp message status, updating WhatsApp-specific fields only', {
          messageId: status.id,
          status: status.status,
          notificationId: notification._id
        });
    }

    return updateData;
  }

  /**
   * Log status change information
   * 
   * @param notification Current notification
   * @param newStatus New WhatsApp status
   * @param status Full status object
   * @param correlationId Correlation ID for tracking
   */
  private logStatusChange(notification: any, newStatus: string, status: WhatsAppMessageStatus, correlationId: string): void {
    const logData = {
      correlationId,
      notificationId: notification._id,
      messageId: status.id,
      recipientId: status.recipient_id,
      oldWhatsappStatus: notification.whatsappStatus,
      newWhatsappStatus: newStatus,
      oldNotificationStatus: notification.status
    };

    switch (newStatus) {
      case 'sent':
        log.info('Message marked as sent', logData);
        break;
      case 'delivered':
        log.info('Message marked as delivered', logData);
        break;
      case 'read':
        log.info('Message marked as read', logData);
        break;
      case 'failed':
        if (status.errors && status.errors.length > 0) {
          const error = status.errors[0];
          log.warn('Message delivery failed with error', {
            ...logData,
            errorCode: error.code,
            errorTitle: error.title,
            errorMessage: error.message
          });
        } else {
          log.warn('Message delivery failed without error details', logData);
        }
        break;
      default:
        log.warn('Unknown message status received', logData);
    }
  }

  /**
   * Log additional metadata from status update
   * 
   * @param status WhatsApp message status
   * @param correlationId Correlation ID for tracking
   */
  private logAdditionalMetadata(status: WhatsAppMessageStatus, correlationId: string): void {
    // Log conversation information if available
    if (status.conversation) {
      log.debug('Message has conversation metadata', {
        correlationId,
        messageId: status.id,
        conversationId: status.conversation.id,
        originType: status.conversation.origin?.type,
        expirationTimestamp: status.conversation.expiration_timestamp
      });
    }
    
    // Log pricing information if available
    if (status.pricing) {
      log.debug('Message has pricing information', {
        correlationId,
        messageId: status.id,
        billable: status.pricing.billable,
        category: status.pricing.category,
        pricingModel: status.pricing.pricing_model
      });
    }
  }
  
  /**
   * Generate a correlation ID for tracking webhook processing
   * 
   * @returns Unique correlation ID
   */
  private generateCorrelationId(): string {
    return `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Enhanced payload structure validation with detailed error reporting
   * 
   * @param payload The webhook payload to validate
   * @returns Validation result with errors
   */
  private validatePayloadStructure(payload: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if payload exists and is an object
    if (!payload || typeof payload !== 'object') {
      errors.push('Payload is missing or not an object');
      return { isValid: false, errors };
    }

    // Check object field
    if (!payload.object || typeof payload.object !== 'string') {
      errors.push('Missing or invalid "object" field');
    }

    // Check entry field
    if (!payload.entry) {
      errors.push('Missing "entry" field');
    } else if (!Array.isArray(payload.entry)) {
      errors.push('"entry" field must be an array');
    } else if (payload.entry.length === 0) {
      errors.push('"entry" array is empty');
    } else {
      // Validate each entry
      payload.entry.forEach((entry: any, index: number) => {
        if (!entry || typeof entry !== 'object') {
          errors.push(`Entry at index ${index} is not an object`);
        } else {
          if (!entry.id || typeof entry.id !== 'string') {
            errors.push(`Entry at index ${index} missing or invalid "id" field`);
          }
          if (!Array.isArray(entry.changes)) {
            errors.push(`Entry at index ${index} missing or invalid "changes" field`);
          } else if (entry.changes.length === 0) {
            errors.push(`Entry at index ${index} has empty "changes" array`);
          }
        }
      });
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validate individual change structure
   * 
   * @param change The change object to validate
   * @returns Boolean indicating if change is valid
   */
  private isValidChange(change: any): boolean {
    if (!change || typeof change !== 'object') {
      return false;
    }

    if (!change.field || typeof change.field !== 'string') {
      return false;
    }

    if (!change.value || typeof change.value !== 'object') {
      return false;
    }

    return true;
  }

  /**
   * Sanitize payload for logging by removing sensitive information
   * 
   * @param payload The payload to sanitize
   * @returns Sanitized payload safe for logging
   */
  private sanitizePayloadForLogging(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    try {
      // Create a deep copy and remove sensitive fields
      const sanitized = JSON.parse(JSON.stringify(payload));
      
      // Remove or mask sensitive information
      if (sanitized.entry && Array.isArray(sanitized.entry)) {
        sanitized.entry.forEach((entry: any) => {
          if (entry.changes && Array.isArray(entry.changes)) {
            entry.changes.forEach((change: any) => {
              if (change.value && change.value.messages) {
                // Mask message content for privacy
                change.value.messages.forEach((message: any) => {
                  if (message.text && message.text.body) {
                    message.text.body = '[REDACTED]';
                  }
                  if (message.image && message.image.caption) {
                    message.image.caption = '[REDACTED]';
                  }
                  if (message.document && message.document.caption) {
                    message.document.caption = '[REDACTED]';
                  }
                });
              }
            });
          }
        });
      }

      return sanitized;
    } catch (error) {
      log.warn('Failed to sanitize payload for logging', { error });
      return { error: 'Failed to sanitize payload' };
    }
  }

  /**
   * Log incoming messages (for monitoring purposes)
   * Note: This doesn't process the messages, just logs them
   * 
   * @param messages Array of incoming messages
   * @param correlationId Correlation ID for tracking
   */
  private logIncomingMessages(messages: WhatsAppIncomingMessage[], correlationId: string): void {
    for (const message of messages) {
      try {
        log.info('Received incoming WhatsApp message', {
          correlationId,
          messageId: message.id,
          from: message.from,
          timestamp: message.timestamp,
          type: message.type,
          hasContext: Boolean(message.context)
        });
        
        // Log more details based on message type
        switch (message.type) {
          case 'text':
            if (message.text) {
              log.debug('Received text message', {
                messageId: message.id,
                bodyLength: message.text.body?.length || 0
              });
            }
            break;
            
          case 'image':
            if (message.image) {
              log.debug('Received image message', {
                messageId: message.id,
                mimeType: message.image.mime_type,
                hasCaption: Boolean(message.image.caption)
              });
            }
            break;
            
          case 'document':
            if (message.document) {
              log.debug('Received document message', {
                messageId: message.id,
                filename: message.document.filename,
                mimeType: message.document.mime_type
              });
            }
            break;
            
          default:
            log.debug(`Received ${message.type} message`, {
              messageId: message.id
            });
        }
      } catch (error) {
        log.error('Error logging incoming message:', error);
      }
    }
  }
  
  /**
   * Log webhook errors
   * 
   * @param errors Array of error details
   * @param correlationId Correlation ID for tracking
   */
  private logWebhookErrors(errors: WhatsAppErrorDetails[], correlationId: string): void {
    for (const error of errors) {
      log.error('WhatsApp webhook error', {
        correlationId,
        code: error.code,
        title: error.title,
        message: error.message,
        href: error.href,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Validate webhook payload structure
   * 
   * @param payload The webhook payload
   * @returns Boolean indicating if payload is valid
   */
  private isValidPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    
    if (!payload.object || typeof payload.object !== 'string') {
      return false;
    }
    
    if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
      return false;
    }
    
    // Check if at least one entry has valid changes
    return payload.entry.some((entry: any) => 
      entry && 
      Array.isArray(entry.changes) && 
      entry.changes.length > 0
    );
  }
}

export default new WebhookProcessorService();