import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Database');

const connectDB = async () => {
    if (!config.mongodb.uri) {
        log.error('MongoDB URI not found in config.');
        process.exit(1);
    }

    try {
        const conn = await mongoose.connect(config.mongodb.uri, config.mongodb.options);
        log.info(`MongoDB Connected: ${conn.connection.host}`);

        mongoose.connection.on('error', (err) => {
            log.error(`MongoDB connection error: ${err}`);
        });

        mongoose.connection.on('disconnected', () => {
            log.info('MongoDB disconnected.');
        });

    } catch (error: any) {
        log.error(`Error connecting to MongoDB: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;
