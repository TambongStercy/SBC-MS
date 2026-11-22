import express, { Application } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestId } from './api/middleware/request-id';
import { errorHandler } from './api/middleware/error';
import deskRoutes from './api/routes/desk';
import meRoutes from './api/routes/me.routes';
import internalRoutes from './api/routes/internal.routes';
import { health } from './api/routes/health';
import publicRoutes from './api/routes/public.routes';
import { httpMetrics, metricsHandler } from './utils/metrics';

/** Everything lives under /api/support (the gateway keeps the path). Same origin: no CORS. */
export function createApp(): Application {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', true);
    app.use(requestId);
    app.use(httpMetrics);
    app.get('/metrics', (req, res) => { void metricsHandler(req, res); });
    app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
    app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    app.use(express.json({ limit: '200kb' }));
    app.use(cookieParser());

    app.get('/health', health);
    app.get('/api/support/health', health);

    app.use('/api/support/desk', deskRoutes);
    app.use('/api/support/me', meRoutes);
    app.use('/api/support/internal', internalRoutes);
    app.use('/api/support/public', publicRoutes);

    app.use((_req, res) => res.status(404).json({ success: false, message: 'Ressource introuvable.', code: 'NOT_FOUND' }));
    app.use(errorHandler);
    return app;
}

export default createApp;
