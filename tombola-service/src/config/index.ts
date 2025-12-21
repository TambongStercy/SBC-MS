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

// Define Config Interface (add/remove properties as needed for tombola-service)
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
        settingsService: string;
    };
    logging: {
        level: string;
        format: string;
    };
    tombolaTicketPrice: number;
    selfBaseUrl: string;
    // Impact Challenge specific config
    impactChallenge: {
        maxTicketsPerUserPerMonth: number;
        votePrice: number;
        maxEntrepreneursPerChallenge: number;
        videoMaxDurationSeconds: number;
        lotteryPoolAccountId: string;
        sbcCommissionAccountId: string;
    };
}

// Configuration object
const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3006', 10),
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
        serviceSecret: process.env.SERVICE_SECRET || '__REPLACE_WITH_STRONG_RANDOM_SECRET__',
        userService: process.env.USER_SERVICE_URL || 'http://localhost:3001/api',
        paymentService: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003/api',
        notificationService: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api',
        productService: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3004/api',
        apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000/api',
        settingsService: process.env.SETTINGS_SERVICE_URL || 'http://localhost:3007/api',
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    tombolaTicketPrice: parseInt(process.env.TOMBOLA_TICKET_PRICE || '200', 10),
    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3006',

    // Impact Challenge specific config
    impactChallenge: {
        maxTicketsPerUserPerMonth: parseInt(process.env.MAX_TICKETS_PER_USER_PER_MONTH || '25', 10),
        votePrice: parseInt(process.env.CHALLENGE_VOTE_PRICE || '200', 10),
        maxEntrepreneursPerChallenge: parseInt(process.env.MAX_ENTREPRENEURS_PER_CHALLENGE || '3', 10),
        videoMaxDurationSeconds: parseInt(process.env.VIDEO_MAX_DURATION_SECONDS || '90', 10),
        lotteryPoolAccountId: process.env.LOTTERY_POOL_ACCOUNT_ID || '',
        sbcCommissionAccountId: process.env.SBC_COMMISSION_ACCOUNT_ID || '',
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
        // 'jwt.expiresIn',
        // 'services.serviceSecret',
        // 'services.userService',
        // 'services.paymentService',
        // 'services.notificationService',
        // 'services.productService',
        // 'services.apiGateway',
        // 'tombolaTicketPrice'
        // Add other strictly required variables here
        // e.g., 'apiKey' if using API key auth for all services
    ];

    const missingEnvs: string[] = [];

    requiredEnvVars.forEach(key => {
        // Simple check for top-level keys
        if (typeof key === 'string' && key.includes('.')) {
            // Check nested keys (simple dot notation check)
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
                missingEnvs.push(key.toUpperCase().replace('.', '_')); // Convert back to typical ENV_VAR format for message
            }
        } else if (cfg[key as keyof IConfig] === undefined || cfg[key as keyof IConfig] === null || cfg[key as keyof IConfig] === '') {
            missingEnvs.push(String(key).toUpperCase());
        }
    });

    if (missingEnvs.length > 0) {
        const logFunc = logger?.logger?.error || console.error; // Use the base logger instance for the error message
        logFunc(`FATAL ERROR: Missing required environment variables: ${missingEnvs.join(', ')}`);
        process.exit(1);
    }
};

// Run validation
validateConfig(config);

export default config; 