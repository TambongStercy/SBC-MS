import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './database/connection';
import config from './config';
import apiRoutes from './api/routes';
import { notificationProcessor } from './jobs/notificationProcessor';
import { queueService } from './services/queue.service';
import logger from './utils/logger';

// Create Express server
const app = express();

// Apply middleware
app.use(helmet()); // Security headers
app.use(cors()); // Cross-origin resource sharing
app.use(express.json({ limit: '50mb' })); // Parse JSON request body with increased limit
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded request body with increased limit

// Set up logging
if (config.nodeEnv !== 'test') {
    app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
}

// API Routes
// Mount the main router
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'notification-service',
        timestamp: new Date().toISOString()
    });
});

// Basic Route
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'notification-service',
        timestamp: new Date().toISOString(),
        ip: req.ip
    });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

        // Start notification processor
        notificationProcessor.start();

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`[Server] Notification service running on port ${PORT}`);
            logger.info(`[Server] Environment: ${config.nodeEnv}`);
        });

        // Handle shutdown
        const gracefulShutdown = async () => {
            logger.info('[Server] Shutting down gracefully...');

            // Stop notification processor
            notificationProcessor.stop();

            // Shutdown queue service
            await queueService.shutdown();

            // Close server
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