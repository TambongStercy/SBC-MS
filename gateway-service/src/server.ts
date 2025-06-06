import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import proxy from 'express-http-proxy';
import config from './config';
import logger from './utils/logger';
import { errorHandler } from './api/middleware/error.middleware';

// Initialize logger
const log = logger.getLogger('Server');

// Create Express app
const app = express();

// Initial Middleware (Security, CORS, Logging)
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  methods: config.cors.methods,
  allowedHeaders: config.cors.allowedHeaders
}));
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'up',
    timestamp: new Date().toISOString(),
    services: {
      userService: config.services.userServiceUrl,
      notificationService: config.services.notificationServiceUrl,
      paymentService: config.services.paymentServiceUrl,
      productService: config.services.productServiceUrl
    }
  });
});

// Gateway version endpoint
app.get('/version', (req, res) => {
  res.json({
    name: 'SBC API Gateway',
    version: '1.0.0',
    environment: config.nodeEnv
  });
});

// --- PROXY ROUTES ---
// Define ALL proxy routes BEFORE global body parsers

// Note: Static assets are handled by the payment service itself at /api/payments/static/*
// No separate proxy rules needed here

// User services
app.use('/api/users', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to users service`);
    return '/api/users' + req.url;
  }
}));

// Partner services
app.use('/api/partners', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to partners service`);
    return '/api/partners' + req.url;
  }
}));


// // Admin services (for now, proxy to user service)
// app.use('/api/admin', proxy(config.services.userServiceUrl, {
//   proxyReqPathResolver: (req) => {
//     log.debug(`Proxying ${req.method} ${req.originalUrl} to admin service`);
//     return '/api/admin' + req.url;
//   }
// }));

app.use('/api/subscriptions', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to subscriptions service`);
    return '/api/subscriptions' + req.url;
  }
}));

app.use('/api/withdrawals', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to withdrawals service (payment service)`);
    return '/api/withdrawals' + req.url;
  }
}));

app.use('/api/contacts', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to contacts service`);
    return '/api/contacts' + req.url;
  }
}));

// Notification service
app.use('/api/notifications', proxy(config.services.notificationServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to notifications service`);
    return '/api/notifications' + req.url;
  }
}));

// Payment service
app.use('/api/payments', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to payments service`);
    return '/api/payments' + req.url;
  }
}));

app.use('/api/transactions', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to payments service`);
    return '/api/transactions' + req.url;
  }
}));

app.use('/api/payouts', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to payouts service`);
    return '/api/payouts' + req.url;
  }
}));

// Product service
app.use('/api/products', proxy(config.services.productServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to products service`);
    return '/api/products' + req.url;
  }
}));

// Flash sale service
app.use('/api/flash-sales', proxy(config.services.productServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to flash sale service`);
    return '/api/flash-sales' + req.url;
  }
}));

// Tombola service
app.use('/api/tombolas', proxy(config.services.tombolaServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to tombola service`);
    // Assuming tombola service expects paths relative to its own /api root
    return req.originalUrl;
  }
}));

// Advertising service
app.use('/api/advertising', proxy(config.services.advertisingServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to advertising service`);
    // Assuming advertising service expects paths relative to its own /api root
    return req.originalUrl;
  }
}));

// Settings service (keep specific config for file uploads if needed)
app.use('/api/settings', proxy(config.services.settingsServiceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to event service`);
    return '/api/settings' + req.url;
  }
}));

// Event service (Add back explicit limit)
app.use('/api/events', proxy(config.services.settingsServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to event service`);
    return '/api/events' + req.url;
  }
}));

// --- GLOBAL MIDDLEWARE ---
// Apply body parsers AFTER proxy routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 404 handler
app.use((req, res) => {
  log.warn(`Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Error handler
app.use(errorHandler);

// Start the server
const server = app.listen(config.port, config.host, () => {
  log.info(`Gateway service running at http://${config.host}:${config.port}`);
  log.info(`Environment: ${config.nodeEnv}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;