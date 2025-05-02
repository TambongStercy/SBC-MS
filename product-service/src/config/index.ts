import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Define config interface for type safety
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    server: {
        bodyLimit: string;
        cors: {
            origin: string;
            methods: string[];
            allowedHeaders: string[];
        };
    };
    mongodb: {
        uri: string;
        options: {
            useNewUrlParser: boolean;
            useUnifiedTopology: boolean;
            serverSelectionTimeoutMS: number;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    services: {
        serviceSecret: string;
        userService: string;
        paymentService: string;
        notificationService: string;
        settingsServiceUrl: string;
        apiGateway: string;
    };
    logging: {
        level: string;
        format: string;
    };
    aws: {
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
        bucketName: string;
    };
    uploads: {
        maxFileSize: number;
        allowedImageTypes: string[];
    };
    selfBaseUrl: string;
}

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3004', 10),
    host: process.env.HOST || '0.0.0.0',

    server: {
        bodyLimit: process.env.BODY_LIMIT || '10mb',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }
    },

    mongodb: {
        uri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD as string : process.env.MONGODB_URI_DEV as string,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        }
    },

    jwt: {
        secret: process.env.JWT_SECRET || 'your_jwt_secret',
        expiresIn: process.env.JWT_EXPIRATION || '1d'
    },

    services: {
        serviceSecret: process.env.SERVICE_SECRET || 'sbc_all_services',
        userService: process.env.USER_SERVICE_URL || 'http://localhost:3001/api',
        paymentService: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003/api',
        notificationService: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api',
        settingsServiceUrl: process.env.SETTINGS_SERVICE_URL || 'http://localhost:3007/api',
        apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000/api'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        region: process.env.AWS_REGION || 'us-east-1',
        bucketName: process.env.AWS_BUCKET_NAME || 'product-images'
    },

    uploads: {
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10), // 5MB default
        allowedImageTypes: (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/gif').split(',')
    },

    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3004',
};

// Validation function for required configurations
const validateConfig = (): void => {
    const requiredEnvs = [
        'JWT_SECRET'
    ];

    // Only validate these in production
    if (config.nodeEnv === 'production') {
        // requiredEnvs.push(
        //     'AWS_ACCESS_KEY_ID',
        //     'AWS_SECRET_ACCESS_KEY',
        //     'AWS_REGION',
        //     'AWS_BUCKET_NAME'
        // );
    }

    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);

    if (missingEnvs.length > 0) {
        logger.error(`Missing required environment variables: ${missingEnvs.join(', ')}`);
        process.exit(1);
    }
};

// Run validation in production
if (config.nodeEnv === 'production') {
    validateConfig();
}

export default config; 