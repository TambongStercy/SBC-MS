import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger'; // Assuming logger is in utils

const log = logger.getLogger('Database');

const connectDB = async () => {
    try {
        console.log(`Connecting to MongoDB at ${config.mongodbUri}...`);
        await mongoose.connect(config.mongodbUri);
        log.info('MongoDB connected successfully.');

        mongoose.connection.on('error', (err) => {
            log.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            log.warn('MongoDB disconnected.');
        });

    } catch (error) {
        log.error('Could not connect to MongoDB:', error);
        process.exit(1); // Exit process with failure
    }
};

export default connectDB; 