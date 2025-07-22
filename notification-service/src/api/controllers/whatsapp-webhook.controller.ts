import { Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../../utils/logger';
import config from '../../config';
import { WhatsAppWebhookPayload } from '../../types/whatsapp-cloud-api.types';
import { WEBHOOK_CONFIG } from '../../constants/whatsapp-cloud-api.constants';
import webhookProcessorService from '../../services/webhook-processor.service';

const log = logger.getLogger('WhatsAppWebhookController');

/**
 * Controller for handling WhatsApp Cloud API webhooks
 */
export class WhatsAppWebhookController {
  /**
   * Verify webhook endpoint for WhatsApp Cloud API setup
   * This endpoint is called by WhatsApp during initial webhook configuration
   * 
   * @param req Express request
   * @param res Express response
   */
  public verifyWebhook = (req: Request, res: Response): void => {
    try {
      log.info('Received WhatsApp webhook verification request');
      
      // Extract verification parameters from query
      const mode = req.query[WEBHOOK_CONFIG.MODE_PARAM] as string;
      const token = req.query[WEBHOOK_CONFIG.VERIFY_TOKEN_PARAM] as string;
      const challenge = req.query[WEBHOOK_CONFIG.CHALLENGE_PARAM] as string;
      
      // Validate mode and token
      if (mode === WEBHOOK_CONFIG.SUBSCRIBE_MODE && token === config.whatsapp.webhookVerifyToken) {
        log.info('WhatsApp webhook verified successfully');
        
        // Respond with the challenge token to confirm verification
        res.status(200).send(challenge);
      } else {
        // Invalid verification request
        log.warn('Failed WhatsApp webhook verification', {
          expectedToken: config.whatsapp.webhookVerifyToken ? '(configured)' : '(not configured)',
          receivedToken: token ? '(provided)' : '(not provided)',
          mode
        });
        
        res.status(403).json({ error: 'Verification failed' });
      }
    } catch (error) {
      log.error('Error in webhook verification:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Handle incoming webhook events from WhatsApp Cloud API
   * 
   * @param req Express request
   * @param res Express response
   */
  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // Always respond with 200 OK immediately to acknowledge receipt
      // This is a best practice for webhooks to prevent retries
      res.status(200).send('EVENT_RECEIVED');
      
      // Get the raw body from the request (set by rawBodyMiddleware)
      const rawBody = (req as any).rawBody;
      
      // Verify webhook signature if validation is enabled
      if (config.whatsapp.enableWebhookValidation) {
        const signature = req.headers[WEBHOOK_CONFIG.SIGNATURE_HEADER] as string;
        
        if (!signature) {
          log.warn('Missing WhatsApp webhook signature');
          return;
        }
        
        const isValid = this.verifySignature(rawBody, signature, config.whatsapp.webhookVerifyToken);
        
        if (!isValid) {
          log.warn('Invalid WhatsApp webhook signature');
          return;
        }
        
        log.debug('WhatsApp webhook signature verified');
      }
      
      // Process the webhook payload
      const payload = req.body as WhatsAppWebhookPayload;
      
      if (!this.isValidWebhookPayload(payload)) {
        log.warn('Invalid WhatsApp webhook payload structure');
        return;
      }
      
      // Process the webhook event
      await this.processWebhookEvent(payload);
      
    } catch (error) {
      log.error('Error processing WhatsApp webhook:', error);
    }
  };

  /**
   * Process webhook events from WhatsApp Cloud API
   * 
   * @param payload Webhook payload
   */
  private processWebhookEvent = async (payload: WhatsAppWebhookPayload): Promise<void> => {
    try {
      log.info('Processing WhatsApp webhook event', {
        object: payload.object,
        entryCount: payload.entry?.length || 0
      });
      
      // Delegate processing to the webhook processor service
      const success = await webhookProcessorService.processWebhookPayload(payload);
      
      if (success) {
        log.info('Successfully processed webhook payload');
      } else {
        log.warn('Failed to process webhook payload or no relevant updates found');
      }
    } catch (error) {
      log.error('Error processing webhook event:', error);
    }
  };

  /**
   * Verify webhook signature using HMAC SHA-256
   * 
   * @param payload Raw request body
   * @param signature Signature from X-Hub-Signature-256 header
   * @param secret Webhook verify token
   * @returns Boolean indicating if signature is valid
   */
  private verifySignature = (payload: string, signature: string, secret: string): boolean => {
    try {
      // The signature header starts with "sha256=", so we need to extract the actual signature
      const expectedSignature = signature.startsWith('sha256=') ? signature.substring(7) : signature;
      
      // Calculate the HMAC SHA-256 signature of the payload using the webhook verify token
      const calculatedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      
      // Compare the signatures using a timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(calculatedSignature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      log.error('Error verifying webhook signature:', error);
      return false;
    }
  };

  /**
   * Validate webhook payload structure
   * 
   * @param payload Webhook payload
   * @returns Boolean indicating if payload is valid
   */
  private isValidWebhookPayload = (payload: any): boolean => {
    return (
      payload &&
      typeof payload === 'object' &&
      payload.object &&
      Array.isArray(payload.entry)
    );
  };

  /**
   * Test endpoint for webhook development (only available in development)
   * 
   * @param req Express request
   * @param res Express response
   */
  public testWebhook = (req: Request, res: Response): void => {
    try {
      log.info('Received test webhook request');
      
      // Log the request body for debugging
      log.debug('Test webhook payload:', req.body);
      
      // Respond with success
      res.status(200).json({
        success: true,
        message: 'Test webhook received',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      log.error('Error in test webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}