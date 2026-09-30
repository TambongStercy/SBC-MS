import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { randomBytes } from 'crypto';
import config from './config';
import logger from './utils/logger';
import apiRoutes from './api/routes';
import publicRoutes from './api/routes/public.routes';

const log = logger.getLogger('App');

const app: Application = express();

app.use(cors());

const CDN_ORIGIN = 'https://storage.googleapis.com';

// Per-response CSP nonce for the event landing page's inline scripts.
app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'img-src': ["'self'", 'data:', CDN_ORIGIN],
            'media-src': ["'self'", CDN_ORIGIN],
            'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
            'upgrade-insecure-requests': null,
        },
    },
}));

app.use(express.json({ limit: config.server.bodyLimit }));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/api/health' && req.path !== '/health') {
        log.info(`REQ: ${req.method} ${req.originalUrl} ${req.ip}`);
    }
    res.on('finish', () => {
        if (req.path !== '/api/health' && req.path !== '/health') {
            log.info(`RES: ${res.statusCode} ${req.method} ${req.originalUrl}`);
        }
    });
    next();
});

// Expose both /health and /api/health because SBC deploy checks aren't standardised.
const health = (_req: Request, res: Response) =>
    res.status(200).json({ status: 'UP', service: 'event-service' });
app.get('/health', health);
app.get('/api/health', health);

// Landing pages at the root — /e/:slug is shortest for social sharing.
app.use('/', publicRoutes);

app.use('/api', apiRoutes);

app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Resource not found' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error('Unhandled application error:', err);
    const statusCode = (err as any).statusCode || 500;
    const message = (config.nodeEnv === 'production' && statusCode === 500)
        ? 'An unexpected internal server error occurred.'
        : err.message;

    res.status(statusCode).json({
        success: false,
        message,
        // Error codes (SALES_NOT_OPEN, ...) travel to the client; the French
        // message is for humans, the code is for the UI's branching.
        ...((err as any).code && { code: (err as any).code }),
        ...(config.nodeEnv !== 'production' && { stack: err.stack }),
    });
});

export default app;
