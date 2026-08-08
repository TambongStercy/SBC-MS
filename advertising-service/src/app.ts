import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import config from './config';
import logger from './utils/logger';
import apiRoutes from './api/routes';
import publicRoutes from './api/routes/public.routes';

const log = logger.getLogger('App');

const app: Application = express();

app.use(cors());
// The landing page renders advertiser-supplied media and is embedded from
// WhatsApp's in-app browser, so the default cross-origin resource policy is too
// strict here. API routes are unaffected.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
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
