import dotenv from 'dotenv';
import path from 'path';
// import logger from '../utils/logger'; // Removed logger import to break circular dependency

const loadEnv = () => {
    const env = process.env.NODE_ENV || 'development';
    const envPath = path.resolve(__dirname, `../../.env.${env}`);
    const defaultEnvPath = path.resolve(__dirname, '../../.env');
    dotenv.config({ path: envPath });
    if (!process.env.PORT) {
        dotenv.config({ path: defaultEnvPath });
    }
};

loadEnv();

// Define Config Interface
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    currency: string;
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
    };
    logging: {
        level: string;
        format: string;
    };
    selfBaseUrl: string;
    // Add any advertising-specific config here
}

// Configuration object
const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3005', 10),
    host: process.env.HOST || '0.0.0.0',
    currency: process.env.CURRENCY || 'XAF',
    server: {
        bodyLimit: process.env.BODY_LIMIT || '10mb',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }
    },

    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sbc_advertising_dev',
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
        apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000/api'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },
    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3005',
};

// Validation function
const validateConfig = (cfg: IConfig): void => {
    const requiredEnvVars: (keyof IConfig | string)[] = [
        'nodeEnv',
        'port',
        'host',
        'mongodb.uri',
        'services.paymentService',
        'services.notificationService',
        'services.userService',
        'services.productService',
        'services.apiGateway',
        'jwt.secret',
        'jwt.expiresIn',
        'services.serviceSecret',
        // Add other required vars like API key if essential
    ];

    const missingEnvs: string[] = [];
    requiredEnvVars.forEach(key => {
        if (typeof key === 'string' && key.includes('.')) {
            const keys = key.split('.');
            let current: any = cfg;
            let isMissing = false;
            for (const k of keys) {
                if (current[k] === undefined || current[k] === null || current[k] === '') {
                    isMissing = true; break;
                }
                current = current[k];
            }
            if (isMissing) missingEnvs.push(key.toUpperCase().replace('.', '_'));
        } else if (cfg[key as keyof IConfig] === undefined || cfg[key as keyof IConfig] === null || cfg[key as keyof IConfig] === '') {
            missingEnvs.push(String(key).toUpperCase());
        }
    });

    if (missingEnvs.length > 0) {
        // Use console.error directly as logger is not available here due to potential circular dependency
        console.error(`FATAL ERROR: Missing required environment variables: ${missingEnvs.join(', ')}`);
        process.exit(1);
    }
};

// Run validation
validateConfig(config);

export default config; 