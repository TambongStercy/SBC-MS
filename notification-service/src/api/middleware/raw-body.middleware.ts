import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

const log = logger.getLogger('RawBodyMiddleware');

/**
 * Middleware to preserve the raw request body for webhook signature verification
 * This is necessary because Express's body-parser modifies the request body,
 * but we need the original raw body to verify the webhook signature
 * 
 * @param req Express request
 * @param res Express response
 * @param next Next middleware function
 */
export const rawBodyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    let rawBody = '';
    
    // Store the raw body data
    req.on('data', (chunk) => {
      rawBody += chunk.toString();
    });
    
    // When the request is finished, store the raw body on the request object
    req.on('end', () => {
      try {
        // Store the raw body on the request object
        (req as any).rawBody = rawBody;
        
        // If the content type is JSON, parse the body
        if (req.headers['content-type']?.includes('application/json')) {
          req.body = JSON.parse(rawBody);
        }
        
        next();
      } catch (error) {
        log.error('Error parsing request body:', error);
        res.status(400).json({ error: 'Invalid JSON in request body' });
      }
    });
  } catch (error) {
    log.error('Error in raw body middleware:', error);
    next(error);
  }
};