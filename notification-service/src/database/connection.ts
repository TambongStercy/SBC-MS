import mongoose from 'mongoose';
import config from '../config';

const connectDB = async (): Promise<void> => {
    try {
        // MongoDB connection options
        const options: mongoose.ConnectOptions = {
            // No need to set useNewUrlParser, useUnifiedTopology, useFindAndModify in Mongoose 6+
            // They are set to true by default
        };

        // Connect to MongoDB
        const conn = await mongoose.connect(config.mongodb.uri, options);

        console.log(`[Notification Service]: MongoDB Connected: ${conn.connection.host}`);
    } catch (error: any) {
        console.error(`[Notification Service]: Error connecting to MongoDB: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB; 