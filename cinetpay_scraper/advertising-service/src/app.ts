import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import logger from './utils/logger';
import apiRouter from './api/routes/index';

const log = logger.getLogger('App');

const app: Application = express();

// --- Base Middleware ---
app.use(cors()); // TODO: Configure origins
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Request Logging ---
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/api/health') {
        log.info(`REQ: ${req.method} ${req.originalUrl} ${req.ip}`);
    }
    res.on('finish', () => {
        if (req.path !== '/api/health') {
            log.info(`RES: ${res.statusCode} ${req.method} ${req.originalUrl}`);
        }
    });
    next();
});

// --- API Routes ---
const apiBasePath = '/api';

// Health Check
app.get(`${apiBasePath}/health`, (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP', service: 'advertising-service' });
});

// Mount the main API router
app.use(apiBasePath, apiRouter);

// --- Error Handling ---

// Not Found Handler (404)
app.use((req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({ success: false, message: 'Resource not found' });
});

// Global Error Handler (500)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error('Unhandled application error:', err);
    const statusCode = (err as any).statusCode || 500;
    const message = (config.nodeEnv === 'production' && statusCode === 500)
        ? 'An unexpected internal server error occurred.'
        : err.message;

    res.status(statusCode).json({
        success: false,
        message: message,
        ...(config.nodeEnv !== 'production' && { stack: err.stack })
    });
});

export default app; 