import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config';
import connectDB from './database/connection';
import logger from './utils/logger';
import apiRoutes from './api/routes'; // Import main router
const log = logger.getLogger('Server');

const app: Express = express();

// Connect to Database
connectDB();

// Middleware
app.use(helmet({
    crossOriginOpenerPolicy: false,
    // crossOriginResourcePolicy: { policy: "cross-origin" }
})); // Basic security headers
app.use(cors({ origin: config.cors.allowedOrigins }));
app.use(morgan('dev')); // HTTP request logger

// Apply body parsers BEFORE API routes with increased limit for file uploads
// Note: For multipart/form-data (file uploads), specific routes using multer
// will also need their own limits configured if necessary, but this sets a global default.
app.use(express.json({ limit: '50mb' })); // Body parser for JSON
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Body parser for URL-encoded


// Middleware to log incoming requests
app.use((req: Request, res: Response, next: NextFunction) => {
    log.info(`Incoming request: ${req.method} ${req.originalUrl}`);
    next(); // Pass control to the next middleware function
});

// --- API Routes ---
// Mount API routes AFTER global body parsers and logging middleware.
// Multer middleware within these routes should handle multipart forms correctly.
app.use('/api', apiRoutes); // Mount main router

// --- Health Check ---
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP' });
});

// --- Not Found Handler ---
app.use((req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({ success: false, message: 'Resource not found' });
});

// --- Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    log.error('Unhandled Error:', err);

    // Handle payload too large errors specifically
    if (err instanceof SyntaxError && (err as any).status === 413 && 'body' in err) {
        return res.status(413).json({ success: false, message: 'Payload too large' });
    }
    // Handle generic payload too large errors (might come from urlencoded or other parsers)
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, message: 'Payload too large' });
    }


    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        // Optionally include stack trace in development
        ...(config.nodeEnv === 'development' && { stack: err.stack }),
    });
});

const PORT = config.port;

app.listen(PORT, () => {
    log.info(`Settings Service started on port ${PORT} in ${config.nodeEnv} mode`);
});

export default app; // Optional: export for testing