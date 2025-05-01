import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Database');

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongodb.uri);
        log.info('MongoDB Connected successfully.');

        mongoose.connection.on('error', (err) => {
            log.error('MongoDB connection error after initial connection:', err);
        });

        mongoose.connection.on('disconnected', () => {
            log.warn('MongoDB disconnected.');
            // Optional: implement reconnection logic here if needed
        });

    } catch (error: any) {
        log.error('MongoDB initial connection error:', error);
        // Exit process with failure
        process.exit(1);
    }
};

export default connectDB; 