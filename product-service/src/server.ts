import app from './app';
import config from './config';
import logger from './utils/logger'; // Import the logger
import connectDB from './database/connection'; // Import DB connection
import { flashSaleProcessor } from './jobs/flashsaleProcessor'; // <-- Import processor

// Initialize logger
const log = logger.getLogger('Server');

let server: any; // Define server variable to be accessible in shutdown

async function startServer() {
    try {
        // Connect to DB first
        await connectDB();

        // Start flash sale processor
        flashSaleProcessor.start(); // <-- Start the processor

        // Start Express server
        server = app.listen(config.port, () => {
            log.info(`Product service running at http://${config.host}:${config.port}`);
            log.info(`Environment: ${config.nodeEnv}`);
        });

    } catch (error) {
        log.error(`Failed to start product-service: ${error}`);
        process.exit(1);
    }
}

// Graceful shutdown logic
const gracefulShutdown = () => {
    log.info('Received shutdown signal. Shutting down gracefully...');

    // Stop the flash sale processor
    flashSaleProcessor.stop(); // <-- Stop the processor

    if (server) {
        server.close(() => {
            log.info('HTTP server closed.');
            // Give time for logger to flush
            setTimeout(() => process.exit(0), 500);
        });
    } else {
        process.exit(0);
    }

    // Force shutdown after a timeout
    setTimeout(() => {
        log.error('Could not close connections in time, forcing shutdown');
        process.exit(1);
    }, 10000); // 10 seconds timeout
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: Error | any, promise: Promise<any>) => {
    // Log the reason (often an Error) directly, add promise context
    log.error('Unhandled Rejection', { reason: reason?.message || reason, promiseContext: promise });
    // Recommend restarting in a real scenario, but for now, just log
    // gracefulShutdown(); // Optionally trigger shutdown
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
    log.error('Uncaught Exception thrown:', err);
    gracefulShutdown(); // Trigger graceful shutdown on uncaught exception
});

// Handle SIGTERM and SIGINT
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
startServer(); 