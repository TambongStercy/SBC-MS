import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import proxy from 'express-http-proxy';
import config from './config';
import logger from './utils/logger';
import { errorHandler } from './api/middleware/error.middleware';
import { adminAllowlist } from './api/middleware/admin-allowlist.middleware';
import { activitySignals, startSignalsFlush } from './api/middleware/activity-signals.middleware';
import { ipGeo } from './api/middleware/ip-geo.middleware';
import { ipGeoStats, startIpGeo } from './services/ip-geo';
import { browserChecks, startBrowserChecksFlush } from './api/middleware/browser-checks.middleware';
import { altchaChallenge, robotCheck, startRobotChecksFlush, torSignal } from './api/middleware/robot-check.middleware';
import { httpMetrics, metricsHandler } from './utils/metrics';
import { cookieSession, startCookieSessionLog } from './api/middleware/cookie-session.middleware';
import './utils/host-metrics';
import './utils/backup-metrics';

// Initialize logger
const log = logger.getLogger('Server');

// Create Express app
const app = express();

// Metrics (Security plan item 10): every request timed by route pattern; /metrics behind METRICS_TOKEN.
app.use(httpMetrics);
app.get('/metrics', (req, res) => { void metricsHandler(req, res); });

// Initial Middleware (Security, CORS, Logging)
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  methods: config.cors.methods,
  allowedHeaders: config.cors.allowedHeaders
}));
// Behind Cloudflare and nginx, req.ip is the proxy. Log the visitor's address as
// Cloudflare reports it, next to the direct peer (a request that skipped Cloudflare
// shows no cf= value). Used for logs only, never to grant or refuse anything.
morgan.token('client-ip', (req) => {
  const cf = req.headers['cf-connecting-ip'];
  return `cf=${typeof cf === 'string' ? cf : '-'} peer=${req.socket.remoteAddress ?? '-'}`;
});
app.use(morgan(':client-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'));

// Security plan Phase 9: a member session cookie becomes the Authorization header (and its
// mutations need the CSRF header), before anything reads that header.
app.use(cookieSession);
startCookieSessionLog();

// Before any proxy: admin paths need an allow-listed admin (see the middleware).
app.use(adminAllowlist);

// Country (when Cloudflare gave none) and network of the visitor, from the free IP files
// (services/ip-geo.ts; off until IPGEO_DIR holds them). Before everything that reads them.
startIpGeo();
app.use(ipGeo);

// Security plan Phase 1: per-member country/device/activity counts (off unless ACTIVITY_SIGNALS_ENABLED=true).
app.use(activitySignals);
startSignalsFlush();

// Security plan Phase 9: signed-request / browser checks, log-only (off unless BROWSER_CHECKS=log).
app.use(browserChecks);
startBrowserChecksFlush();

// Phase 9 rule 3: anti-robot check (ALTCHA, self-hosted) on the sensitive actions
// (off unless ROBOT_CHECK=log|enforce and ALTCHA_HMAC_KEY is set).
app.get('/api/altcha/challenge', altchaChallenge);
app.use(torSignal); // Phase 4: protected actions through Tor → fraud engine
app.use(robotCheck);
startRobotChecksFlush();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'up',
    timestamp: new Date().toISOString(),
    services: {
      userService: config.services.userServiceUrl,
      notificationService: config.services.notificationServiceUrl,
      paymentService: config.services.paymentServiceUrl,
      productService: config.services.productServiceUrl,
      chatService: config.services.chatServiceUrl,
      supportService: config.services.supportServiceUrl
    },
    ipGeo: { loaded: ipGeoStats.loaded, loadedAt: ipGeoStats.loadedAt, rows: ipGeoStats.rows, lastError: ipGeoStats.lastError }
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
  parseReqBody: false,
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

// SSO — OAuth-style flows for third-party apps (SBC Live etc.). Lives in user-service.
// Missing here caused 404s on /api/sso/grant-code through the gateway after PR #60.
app.use('/api/sso', proxy(config.services.userServiceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to sso (user-service)`);
    return '/api/sso' + req.url;
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

// Activation Balance service (user service)
app.use('/api/activation-balance', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to activation-balance service (user service)`);
    return '/api/activation-balance' + req.url;
  }
}));

// SBC Event organizer earnings. Same pattern as /api/advertising-balance —
// held in user-service so all of a user's money is in one place; only exit
// is transferToMain, then the standard withdrawal path.
app.use('/api/event-organizer-balance', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to event-organizer-balance (user service)`);
    return '/api/event-organizer-balance' + req.url;
  }
}));

// Diffuseur advertising earnings. Lives in user-service alongside the other
// balances, not in advertising-service, so all of a user's money is in one place.
app.use('/api/advertising-balance', proxy(config.services.userServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to advertising-balance (user service)`);
    return '/api/advertising-balance' + req.url;
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

app.use('/api/whatsapp', proxy(config.services.notificationServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to whatsapp service`);
    return '/api/whatsapp' + req.url;
  }
}));

app.use('/api/webhook', proxy(config.services.notificationServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to webhook service`);
    return '/api/webhook' + req.url;
  }
}));

// Relance service (notification service)
app.use('/api/relance', proxy(config.services.notificationServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to relance service (notification service)`);
    return '/api/relance' + req.url;
  }
}));

// Recovery service (payment service)
app.use('/api/recovery', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to recovery service (payment service)`);
    return '/api/recovery' + req.url;
  }
}));

// Admin withdrawal approval routes (payment service)
// This must come BEFORE the generic /api/payments route to match first
app.use('/api/payments/admin/withdrawals', proxy(config.services.paymentServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to admin withdrawals service (payment service)`);
    return '/api/admin/withdrawals' + req.url;
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
  limit: '200mb',
  parseReqBody: false,
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

// Impact Challenge service (part of tombola service)
app.use('/api/challenges', proxy(config.services.tombolaServiceUrl, {
  parseReqBody: false, // Allow for file uploads in entrepreneur video submissions
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to challenges service (tombola)`);
    return '/api/challenges' + req.url;
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
    log.debug(`Proxying ${req.method} ${req.originalUrl} to settings service`);
    return '/api/settings' + req.url;
  }
}));

// Storage service (keep specific config for file uploads if needed)
app.use('/api/storage', proxy(config.services.settingsServiceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to storage service`);
    return '/api/storage' + req.url;
  }
}));

// Event service (Add back explicit limit)
app.use('/api/events', proxy(config.services.settingsServiceUrl, {
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to event service`);
    return '/api/events' + req.url;
  }
}));

// Chat service (messaging and status/stories)
app.use('/api/chat', proxy(config.services.chatServiceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to chat service`);
    return '/api/chat' + req.url;
  }
}));

// SBCLOVE service (community matchmaking module)
app.use('/api/sbclove', proxy(config.services.sbcloveServiceUrl, {
  parseReqBody: false, // Allow profile photo uploads (multipart) to stream through
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to sbclove service`);
    return '/api/sbclove' + req.url;
  }
}));

// SBC Event — ticketing platform + resale marketplace. Note the prefix is
// /api/tickets (not /api/events) because /api/events was already taken by the
// small settings-service community-events feature; the product brand is still
// "SBC Event".
app.use('/api/tickets', proxy(config.services.eventServiceUrl, {
  parseReqBody: false, // event posters upload as multipart
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to event service`);
    return req.originalUrl;
  }
}));

// SBC Support: agent desk (/api/support/desk/*, its own session cookies, CSRF
// header and TOTP; deliberately not in admin-routes.ts), member help
// (/api/support/me/*) and internal routes. Path kept; cookies and the
// x-csrf-token / x-reauth-token headers pass through untouched; multipart
// attachments stream.
app.use('/api/support', proxy(config.services.supportServiceUrl, {
  parseReqBody: false,
  proxyReqPathResolver: (req) => {
    log.debug(`Proxying ${req.method} ${req.originalUrl} to support service`);
    return req.originalUrl;
  }
}));

// --- GLOBAL MIDDLEWARE ---
// Apply body parsers AFTER proxy routes
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

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

// Uploads stream through this proxy, and a large one on mobile data can run
// for several minutes. Node's 5-minute default cut them off mid-flight.
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;