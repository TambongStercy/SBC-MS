import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import logger from './utils/logger'; // Import base logger
import tombolaRoutes from './api/routes/'; // Placeholder routes


const log = logger.getLogger('App'); // Get component-specific logger

const app: Application = express();

// --- Base Middleware ---
app.use(cors()); // TODO: Configure allowed origins in production via config
app.use(helmet()); // Basic security headers
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Request Logging Middleware (Example) ---
app.use((req: Request, res: Response, next: NextFunction) => {
    // Exclude health check from detailed logging if desired
    if (req.path !== '/api/health') {
        log.info(`REQ: ${req.method} ${req.originalUrl} ${req.ip}`);
    }
    // Log response finish
    res.on('finish', () => {
        if (req.path !== '/api/health') {
            log.info(`RES: ${res.statusCode} ${req.method} ${req.originalUrl}`);
        }
    });
    next();
});

// --- API Routes ---
const apiBasePath = '/api'; // Consistent base path

app.get(`${apiBasePath}/health`, (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP', service: 'tombola-service' });
});

app.use(`${apiBasePath}`, tombolaRoutes); // Mount user-facing routes


// --- Not Found Handler ---
app.use((req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({ success: false, message: 'Resource not found' });
});

// --- Global Error Handler ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error('Unhandled application error:', err);
    const statusCode = (err as any).statusCode || 500; // Use custom status code if available
    const message = (config.nodeEnv === 'production' && statusCode === 500)
        ? 'An unexpected internal server error occurred.'
        : err.message;

    res.status(statusCode).json({
        success: false,
        message: message,
        // Optionally include stack in development
        ...(config.nodeEnv !== 'production' && { stack: err.stack })
    });
});

export default app; 