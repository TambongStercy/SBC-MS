import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define config interface for type safety
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    logLevel: string;
    cors: {
        origin: string;
        methods: string[];
        allowedHeaders: string[];
    };
    jwt: {
        secret: string;
    };
    services: {
        serviceSecret: string;
        userServiceUrl: string;
        notificationServiceUrl: string;
        paymentServiceUrl: string;
        productServiceUrl: string;
        tombolaServiceUrl: string;
        advertisingServiceUrl: string;
        settingsServiceUrl: string;
    };
}

// Configuration object
const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',

    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Name']
    },

    jwt: {
        secret: process.env.JWT_SECRET || '__REPLACE_WITH_STRONG_JWT_SECRET__'
    },

    services: {
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001',
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002',
        paymentServiceUrl: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
        productServiceUrl: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3004',
        tombolaServiceUrl: process.env.TOMBOLA_SERVICE_URL || 'http://localhost:3005',
        advertisingServiceUrl: process.env.ADVERTISING_SERVICE_URL || 'http://localhost:3006',
        settingsServiceUrl: process.env.SETTINGS_SERVICE_URL || 'http://localhost:3007'
    }
};

// Validate required configuration
function validateConfig() {
    const requiredEnvVars = [
        'JWT_SECRET',
        'SERVICE_SECRET'
    ];

    // Only enforce these in production
    if (config.nodeEnv === 'production') {
        requiredEnvVars.push(
            'USER_SERVICE_URL',
            'NOTIFICATION_SERVICE_URL',
            'PAYMENT_SERVICE_URL',
            'PRODUCT_SERVICE_URL',
            'TOMBOLA_SERVICE_URL',
            'ADVERTISING_SERVICE_URL',
            'SETTINGS_SERVICE_URL'
        );
    }

    const missingEnvVars = requiredEnvVars.filter(envVar =>
        !process.env[envVar] || process.env[envVar] === '__REPLACE_WITH_STRONG_JWT_SECRET__' ||
        process.env[envVar] === '__REPLACE_WITH_STRONG_RANDOM_SECRET__'
    );

    if (missingEnvVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }
}

// Only validate in production to allow easier local development
if (config.nodeEnv === 'production') {
    validateConfig();
}

export default config; 