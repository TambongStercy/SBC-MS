import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Database');

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongodb.uri);
        log.info('MongoDB Connected successfully to advertising_db.');

        mongoose.connection.on('error', (err) => {
            log.error('MongoDB connection error (advertising_db):', err);
        });

        mongoose.connection.on('disconnected', () => {
            log.warn('MongoDB disconnected (advertising_db).');
        });

    } catch (error: any) {
        log.error('MongoDB initial connection error (advertising_db):', error);
        process.exit(1);
    }
};

export default connectDB; 