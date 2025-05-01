import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { Request, Response, NextFunction } from 'express';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('ProxyMiddleware');

/**
 * Adds the service authentication headers to requests forwarded to microservices
 */
const addServiceHeaders = (proxyReq: any, req: Request, res: Response) => {
    // Add the service authentication token
    proxyReq.setHeader('Authorization', `Bearer ${config.services.serviceSecret}`);

    // Add the service name identifier
    proxyReq.setHeader('X-Service-Name', 'gateway-service');

    // Pass through the original user's authentication if present
    if (req.headers.authorization) {
        log.debug('Forwarding user authorization token');
    }

    // Log the proxy request (for debugging)
    log.debug(`Proxying ${req.method} ${req.url} to ${proxyReq.path}`);
};

/**
 * Handle proxy errors
 */
const handleProxyError = (err: Error, req: Request, res: Response) => {
    log.error(`Proxy error: ${err.message}`, { path: req.path, method: req.method });
    if (!res.headersSent) {
        res.status(502).json({
            success: false,
            message: 'Gateway Error: Unable to connect to service',
        });
    }
};

/**
 * Common options for all proxies
 */
const getProxyOptions = (target: string): Options => ({
    target,
    changeOrigin: true,
    onProxyReq: addServiceHeaders,
    onError: handleProxyError,
    logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'error',
    logProvider: () => ({
        log: (msg: string) => log.info(msg),
        debug: (msg: string) => log.debug(msg),
        info: (msg: string) => log.info(msg),
        warn: (msg: string) => log.warn(msg),
        error: (msg: string) => log.error(msg)
    })
});

/**
 * Create a service proxy middleware
 * 
 * Note: When used with app.use('/some/path', serviceProxy), Express will
 * strip the '/some/path' prefix from req.path before our middleware sees it.
 * That's why we match all paths with '.*' and rely on Express's mounting path
 * to determine which proxy handles which request.
 */
export const createServiceProxy = (serviceName: string, serviceUrl: string, pathPattern: string) => {
    log.info(`Creating proxy for ${serviceName} -> ${serviceUrl}`);

    return (req: Request, res: Response, next: NextFunction) => {
        log.debug(`Routing ${req.method} ${req.originalUrl} (path: ${req.path}) to ${serviceName}`);

        // Create the proxy middleware on-demand (this allows for dynamic updates if serviceUrl changes)
        const proxyMiddleware = createProxyMiddleware(getProxyOptions(serviceUrl));
        return proxyMiddleware(req, res, next);
    };
};

// Export pre-configured proxy middlewares for each service
export const userServiceProxy = createServiceProxy(
    'user-service',
    config.services.userServiceUrl,
    '.*' // Match any path
);

export const notificationServiceProxy = createServiceProxy(
    'notification-service',
    config.services.notificationServiceUrl,
    '.*' // Match any path
);

export const paymentServiceProxy = createServiceProxy(
    'payment-service',
    config.services.paymentServiceUrl,
    '.*' // Match any path
);

export const productServiceProxy = createServiceProxy(
    'product-service',
    config.services.productServiceUrl,
    '.*' // Match any path
); 