import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    mongodb: {
        uri: string;
        options: {
            serverSelectionTimeoutMS: number;
            socketTimeoutMS: number;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    redis: {
        host: string;
        port: number;
        password?: string;
        db: number;
    };
    services: {
        serviceSecret: string;
        userServiceUrl: string;
        settingsServiceUrl: string;
        advertisingServiceUrl: string;
    };
    cors: {
        origin: string | string[];
        methods: string[];
        allowedHeaders: string[];
    };
    logging: {
        level: string;
    };
    status: {
        defaultExpiryHours: number;
        maxVideoSeconds: number;
        maxContentLength: number;
    };
    message: {
        maxContentLength: number;
    };
    moderation: {
        enabled: boolean;
        provider: string;
        sightengine: {
            apiUser: string;
            apiSecret: string;
        };
        thresholds: {
            block: number;
            warn: number;
        };
    };
}

const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3030', 'http://localhost:5173'];

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3008', 10),
    host: process.env.HOST || '0.0.0.0',
    mongodb: {
        uri: process.env.NODE_ENV === 'production'
            ? process.env.MONGODB_URI_PROD as string
            : process.env.MONGODB_URI_DEV as string,
        options: {
            serverSelectionTimeoutMS: 60000,
            socketTimeoutMS: 45000,
        }
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your_jwt_secret',
        expiresIn: process.env.JWT_EXPIRATION || '1d'
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '1', 10)
    },
    services: {
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001/api',
        settingsServiceUrl: process.env.SETTINGS_SERVICE_URL || 'http://localhost:3007/api',
        advertisingServiceUrl: process.env.ADVERTISING_SERVICE_URL || 'http://localhost:3005/api'
    },
    cors: {
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Name']
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info'
    },
    status: {
        defaultExpiryHours: 24,
        maxVideoSeconds: 30,
        maxContentLength: 2000
    },
    message: {
        maxContentLength: 5000
    },
    moderation: {
        enabled: process.env.CONTENT_MODERATION_ENABLED === 'true',
        provider: process.env.CONTENT_MODERATION_PROVIDER || 'sightengine',
        sightengine: {
            apiUser: process.env.SIGHTENGINE_API_USER || '',
            apiSecret: process.env.SIGHTENGINE_API_SECRET || ''
        },
        thresholds: {
            block: parseFloat(process.env.MODERATION_BLOCK_THRESHOLD || '0.85'),
            warn: parseFloat(process.env.MODERATION_WARN_THRESHOLD || '0.60')
        }
    }
};

export default config;
