import mongoose from 'mongoose';
import { config } from '../config';
import { childLogger } from './logger';

const log = childLogger('Database');

export async function connectDB(uri: string = config.mongoUri): Promise<void> {
    await mongoose.connect(uri, { maxPoolSize: 20 });
    log.info({ db: mongoose.connection.name }, 'MongoDB connected');
}
