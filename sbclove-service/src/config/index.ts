import dotenv from 'dotenv';
import path from 'path';
import logger from '../utils/logger'; // Import logger for validation message

// Load .env files - Attempts .env.<NODE_ENV> first, then falls back to .env
const loadEnv = () => {
    const env = process.env.NODE_ENV || 'development';
    const envPath = path.resolve(__dirname, `../../.env.${env}`);
    const defaultEnvPath = path.resolve(__dirname, '../../.env');

    // Attempt to load specific environment file
    dotenv.config({ path: envPath });

    // If PORT is still not defined, try loading the default .env file
    if (!process.env.PORT) {
        dotenv.config({ path: defaultEnvPath });
    }
};

loadEnv();

// Helper to ensure URL has /api suffix for service-to-service communication
const ensureApiSuffix = (url: string | undefined, defaultUrl: string): string => {
    const baseUrl = url || defaultUrl;
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

// Define Config Interface
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
            maxPoolSize: number;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    services: {
        serviceSecret: string;
        userService: string;
        notificationService: string;
        settingsService: string;
        apiGateway: string;
    };
    logging: {
        level: string;
        format: string;
    };
    selfBaseUrl: string;
    // SBCLOVE module specific config
    sbclove: {
        timezone: string;
        activeWeekday: number;  // 0=Sunday ... 3=Wednesday
        openHour: number;       // 24h
        closeHour: number;      // 24h
        maxInterestsPerWeek: number;
        autoSuspendThreshold: number;
        autoApprove: boolean;
        maxPhotos: number;
        descriptionMaxLength: number;
        otherIntentionMaxLength: number;
    };
}

// Configuration object
const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3009', 10),
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
        // Prod compose sets MONGODB_URI; dev compose sets MONGODB_URI_DEV.
        // Accept either so the service runs in both environments.
        uri: (process.env.NODE_ENV === 'production'
            ? (process.env.MONGODB_URI_PROD || process.env.MONGODB_URI)
            : (process.env.MONGODB_URI_DEV || process.env.MONGODB_URI)) as string,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            // Larger pool helps absorb the weekly concurrency spike per replica.
            maxPoolSize: parseInt(process.env.SBCLOVE_DB_POOL_SIZE || '50', 10),
        }
    },

    jwt: {
        secret: process.env.JWT_SECRET || 'your_jwt_secret',
        expiresIn: process.env.JWT_EXPIRATION || '1d'
    },

    services: {
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userService: ensureApiSuffix(process.env.USER_SERVICE_URL, 'http://localhost:3001'),
        notificationService: ensureApiSuffix(process.env.NOTIFICATION_SERVICE_URL, 'http://localhost:3002'),
        settingsService: ensureApiSuffix(process.env.SETTINGS_SERVICE_URL, 'http://localhost:3007'),
        apiGateway: ensureApiSuffix(process.env.API_GATEWAY_URL, 'http://localhost:3000'),
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3009',

    // SBCLOVE module specific config
    sbclove: {
        timezone: process.env.SBCLOVE_TIMEZONE || 'Africa/Douala',
        activeWeekday: parseInt(process.env.SBCLOVE_ACTIVE_WEEKDAY || '3', 10),
        openHour: parseInt(process.env.SBCLOVE_OPEN_HOUR || '18', 10),
        closeHour: parseInt(process.env.SBCLOVE_CLOSE_HOUR || '21', 10),
        maxInterestsPerWeek: parseInt(process.env.SBCLOVE_MAX_INTERESTS_PER_WEEK || '5', 10),
        autoSuspendThreshold: parseInt(process.env.SBCLOVE_AUTO_SUSPEND_THRESHOLD || '3', 10),
        // Manual validation is recommended by default (spec §7); set true to auto-approve
        // profiles that pass content validation.
        autoApprove: (process.env.SBCLOVE_AUTO_APPROVE || 'false').toLowerCase() === 'true',
        maxPhotos: parseInt(process.env.SBCLOVE_MAX_PHOTOS || '3', 10),
        descriptionMaxLength: parseInt(process.env.SBCLOVE_DESCRIPTION_MAX_LENGTH || '300', 10),
        otherIntentionMaxLength: parseInt(process.env.SBCLOVE_OTHER_INTENTION_MAX_LENGTH || '80', 10),
    },
};

// Validation function
const validateConfig = (cfg: IConfig): void => {
    const requiredEnvVars: (keyof IConfig | string)[] = [
        'nodeEnv',
        'port',
        'host',
        'mongodb.uri',
        'jwt.secret',
    ];

    const missingEnvs: string[] = [];

    requiredEnvVars.forEach(key => {
        if (typeof key === 'string' && key.includes('.')) {
            const keys = key.split('.');
            let current: any = cfg;
            let isMissing = false;
            for (const k of keys) {
                if (current[k] === undefined || current[k] === null || current[k] === '') {
                    isMissing = true;
                    break;
                }
                current = current[k];
            }
            if (isMissing) {
                missingEnvs.push(key.toUpperCase().replace('.', '_'));
            }
        } else if (cfg[key as keyof IConfig] === undefined || cfg[key as keyof IConfig] === null || cfg[key as keyof IConfig] === '') {
            missingEnvs.push(String(key).toUpperCase());
        }
    });

    if (missingEnvs.length > 0) {
        const errorMsg = `FATAL ERROR: Missing required environment variables: ${missingEnvs.join(', ')}`;
        if (logger?.logger?.error) {
            logger.logger.error(errorMsg);
        } else {
            console.error(errorMsg);
        }
        process.exit(1);
    }
};

// Run validation
validateConfig(config);

export default config;
