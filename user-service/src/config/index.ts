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
        productService: string;
        apiGateway: string;
        settingsService?: string;
        tombolaService?: string;
    };
    logging: {
        level: string;
        format: string;
    };
    withdrawal: {
        dailyLimit: number;
        maxTransactionsPerDay: number;
    };
    selfBaseUrl: string;
}

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
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
        uri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD as string : process.env.MONGODB_URI_PROD as string,
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
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userService: process.env.USER_SERVICE_URL || 'http://localhost:3001/api',
        paymentService: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003/api',
        notificationService: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api',
        productService: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3004/api',
        apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000/api',
        settingsService: process.env.SETTINGS_SERVICE_URL,
        tombolaService: process.env.TOMBOLA_SERVICE_URL,
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    withdrawal: {
        dailyLimit: Number(process.env.DAILY_WITHDRAWAL_LIMIT) || 50000,
        maxTransactionsPerDay: Number(process.env.MAX_WITHDRAWALS_PER_DAY) || 3
    },

    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3001'
};

// Validation function for required configurations
const validateConfig = (): void => {
    const requiredEnvs = [
        'JWT_SECRET',
        'SERVICE_SECRET'
    ];

    // Only validate these in production
    if (config.nodeEnv === 'production') {
        requiredEnvs.push(
            'DAILY_WITHDRAWAL_LIMIT',
            'MAX_WITHDRAWALS_PER_DAY'
        );
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