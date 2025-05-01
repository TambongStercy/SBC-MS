import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './database/connection';
import config from './config';
// Import the main router
import apiRoutes from './api/routes';
import logger from './utils/logger';
import mongoose from 'mongoose';
import app from './app';

const log = logger.getLogger('TombolaService'); // Create logger instance

// Middleware to log incoming requests to user routes
const logRequestUrlMiddleware = (req: Request, res: Response, next: NextFunction) => {
    log.info(`Request received: ${req.method} ${req.originalUrl}`);
    log.info(`route handler triggered with body: ${JSON.stringify(req.body)}`);

    next(); // Pass control to the next handler
};

// Apply the logging middleware to all routes defined in this router
app.use(logRequestUrlMiddleware);

// Apply middleware
app.use(helmet()); // Security headers
app.use(cors()); // Cross-origin resource sharing
app.use(express.json()); // Parse JSON request body
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request body

// --- Trust Proxy --- 
// This is important for accurately getting req.ip behind a reverse proxy (like Nginx)
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1); // Trust the first proxy hop
}

// Set up logging
if (config.nodeEnv !== 'test') {
    app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
}

// Basic Route
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'user-service',
        timestamp: new Date().toISOString(),
        ip: req.ip
    });
});

// Health Check Route
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'user-service',
        timestamp: new Date().toISOString()
    });
});

// API Routes
// Mount the main router
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    log.error(`[Server] Uncaught error: ${err.message}`);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'An unexpected error occurred';

    res.status(statusCode).json({
        success: false,
        message,
        error: config.nodeEnv === 'development' ? err.stack : undefined
    });
});

const PORT = config.port || 3004;

/**
 * Initializes database connection and starts the HTTP server.
 */
const startServer = async () => {
    try {
        log.info('Connecting to database...');
        await connectDB();
        log.info('Database connected.');

        const server = app.listen(PORT, () => {
            log.info(`Tombola Service started successfully on port ${PORT} in ${config.nodeEnv} mode.`);
        });

        // Graceful Shutdown Handler
        const shutdown = (signal: string) => {
            log.warn(`Received ${signal}. Initiating graceful shutdown...`);
            server.close(async () => {
                log.info('HTTP server closed.');
                try {
                    await mongoose.connection.close(false);
                    log.info('MongoDB connection closed successfully.');
                    process.exit(0);
                } catch (err) {
                    log.error('Error during MongoDB connection closure:', err);
                    process.exit(1); // Exit with error if DB doesn't close cleanly
                }
            });

            // Force shutdown after timeout
            setTimeout(() => {
                log.error('Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000); // 10 seconds timeout
        };

        // Listen for termination signals
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT')); // Catches Ctrl+C

    } catch (error) {
        logger.logger.fatal('Fatal error during server startup:', error);
        process.exit(1);
    }
};

// Start the server execution
startServer();

// Export for testing
export default app; 