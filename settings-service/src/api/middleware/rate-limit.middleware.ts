import rateLimit from 'express-rate-limit';
import logger from '../../utils/logger';

const log = logger.getLogger('RateLimiter');

// Options for rate limiters
const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req: any, res: any, next: any, options: any) => {
        log.warn(`Rate limit exceeded for ${req.ip} on ${req.originalUrl}`);
        res.status(options.statusCode).json({
            success: false,
            message: options.message,
        });
    },
};

// Stricter limiter for sensitive actions like login, OTP verification
export const strictLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: 'Too many login or verification attempts from this IP, please try again after 5 minutes',
});

// Medium limiter for actions like registration
export const mediumLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each IP to 20 requests per hour
    message: 'Too many registration attempts from this IP, please try again after an hour',
});

// General limiter for most authenticated API calls
export const generalLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per 15 minutes
    message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Limiter specifically for admin actions (could be more lenient or stricter)
export const adminLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Example: Allow more requests for admins
    message: 'Too many admin requests from this IP, please try again after 15 minutes',
});

// Limiter for webhooks (can be very strict based on expected traffic)
export const webhookLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Example: Allow 1 webhook call per second average
    message: 'Too many webhook requests received.',
});

// Limiter for file uploads (can be stricter to prevent abuse)
export const uploadLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 15, // Limit each IP to 15 uploads per 5 minutes
    message: 'Too many file upload attempts, please try again later.',
}); 