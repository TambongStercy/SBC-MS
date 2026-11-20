import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Database');

export async function connectDB(uri = config.mongoUri): Promise<void> {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 });
    log.info('MongoDB connected', { db: mongoose.connection.name });
}

export async function closeDB(): Promise<void> {
    await mongoose.connection.close(false);
}
