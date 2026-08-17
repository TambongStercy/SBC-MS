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

/** Where uploaded media actually ends up; /api/settings/files redirects there. */
const CDN_ORIGIN = 'https://storage.googleapis.com';

// A per-response nonce lets the landing page keep its inline player script
// without opening the door to 'unsafe-inline', which would let any script that
// ever reached this page — including through advertiser-supplied text — run.
app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
});

// The landing page renders advertiser-supplied media and is embedded from
// WhatsApp's in-app browser, so the default cross-origin resource policy is too
// strict here. API routes are unaffected.
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            // The file proxy 302s to the bucket, and CSP is judged on where the
            // request finally lands — so the CDN has to be named here or every
            // creative is blocked.
            'img-src': ["'self'", 'data:', CDN_ORIGIN],
            'media-src': ["'self'", CDN_ORIGIN],
            'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
            // Nothing here posts anywhere else, and upgrade-insecure-requests
            // would rewrite the localhost URLs used in development.
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

// Health endpoints are not standardised across SBC services, so expose both and
// let the deploy check hit whichever it knows about.
const health = (_req: Request, res: Response) =>
    res.status(200).json({ status: 'UP', service: 'advertising-service' });
app.get('/health', health);
app.get('/api/health', health);

// Landing pages and tracking redirects. Mounted at the root, not under /api,
// because these URLs are pasted into WhatsApp statuses and shortness matters.
app.use('/', publicRoutes);

app.use('/api', apiRoutes);

app.use((req: Request, res: Response) => {
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
        ...(config.nodeEnv !== 'production' && { stack: err.stack }),
    });
});

export default app;
