import mongoose from 'mongoose';
import config from '../config'; // Use the unified config
import logger from '../utils/logger';

const log = logger.getLogger('Database');

const connectDB = async () => {
    if (!config.mongodb.uri) {
        log.error('MongoDB URI not found in config.');
        process.exit(1);
    }

    try {
        const conn = await mongoose.connect(config.mongodb.uri);

        log.info(`MongoDB Connected: ${conn.connection.host}`);

        // Optional: Log connection events
        mongoose.connection.on('error', (err) => {
            log.error(`MongoDB connection error: ${err}`);
            // Consider adding reconnection logic or exiting if critical
        });

        mongoose.connection.on('disconnected', () => {
            log.info('MongoDB disconnected.');
        });

    } catch (error: any) {
        log.error(`Error connecting to MongoDB: ${error.message}`);
        process.exit(1); // Exit process with failure
    }
};

export default connectDB; 