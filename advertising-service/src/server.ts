import app from './app';
import config from './config';
import connectDB from './database/connection';
import logger from './utils/logger';
import mongoose from 'mongoose';

const log = logger.getLogger('Server');
const PORT = config.port;

const startServer = async () => {
    try {
        log.info('Connecting to database...');
        await connectDB();
        log.info('Database connected.');

        const server = app.listen(PORT, () => {
            log.info(`Advertising Service started successfully on port ${PORT} in ${config.nodeEnv} mode.`);
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
        logger.logger.fatal('Fatal error during server startup:', error);
        process.exit(1);
    }
};

startServer(); 