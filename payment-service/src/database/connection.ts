import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('DatabaseConnection');

/**
 * Connect to MongoDB
 */
async function connectDB(): Promise<void> {
    try {
        const conn = await mongoose.connect(config.mongodb.uri);
        log.info(`MongoDB connected: ${conn.connection.host}`);
    } catch (error) {
        log.error(`Error connecting to MongoDB: ${error}`);
        process.exit(1);
    }
}

export default connectDB; 