import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './database/connection';
import config from './config';
// Import the main router
import apiRoutes from './api/routes/index';
import logger from './utils/logger';
import { vcfCacheScheduler } from './jobs/vcf-cache-scheduler';

// Create Express server
const app: Express = express();
const log = logger.getLogger('UserService'); // Create logger instance


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
    logger.error(`[Server] Uncaught error: ${err.message}`);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'An unexpected error occurred';

    res.status(statusCode).json({
        success: false,
        message,
        error: config.nodeEnv === 'development' ? err.stack : undefined
    });
});

// Start server
const PORT = config.port;

async function startServer() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Start VCF cache scheduler
        vcfCacheScheduler.start();
        logger.info('[Server] VCF cache scheduler started');

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`[Server] User service running on port ${PORT}`);
            logger.info(`[Server] Environment: ${config.nodeEnv}`);
        });

        // Handle shutdown
        const gracefulShutdown = () => {
            logger.info('[Server] Shutting down gracefully...');
            vcfCacheScheduler.stop();
            logger.info('[Server] VCF cache scheduler stopped');
            process.exit(0);
        };

        // Signal handlers
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    } catch (error) {
        logger.error(`[Server] Failed to start server: ${error}`);
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

// Export for testing
export default app;