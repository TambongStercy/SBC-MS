import mongoose from 'mongoose';
import connectDB from './database/connection';
import config from './config';
import logger from './utils/logger';
import app from './app';

const log = logger.getLogger('SbcloveService');

const PORT = config.port || 3009;

/**
 * Initializes the database connection and starts the HTTP server.
 */
const startServer = async () => {
    try {
        log.info('Connecting to database...');
        await connectDB();
        log.info('Database connected.');

        const server = app.listen(PORT, () => {
            log.info(`SBCLOVE Service started successfully on port ${PORT} in ${config.nodeEnv} mode.`);
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
                    process.exit(1);
                }
            });

            setTimeout(() => {
                log.error('Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        log.fatal('Fatal error during server startup:', error);
        process.exit(1);
    }
};

startServer();

// Export for testing
export default app;
