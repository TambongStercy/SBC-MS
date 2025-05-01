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
    rabbitMQ: {
        url: string;
        queueName: string;
    };
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
        userService: string;
        paymentService: string;
        notificationService: string;
        apiGateway: string;
        serviceSecret: string;
    };
    logging: {
        level: string;
        format: string;
    };
    email: {
        service: string;
        user: string;
        password: string;
        from: string;
    };
    sms: {
        twilioAccountSid: string;
        twilioAuthToken: string;
        twilioPhoneNumber: string;
        provider: string;
        queenSmsApiKey: string;
        queenSmsApiUrl: string;
        queenSmsSenderId: string;
    };
    rabbitmq: {
        url: string;
        notificationQueue: string;
    };
    notification: {
        processingIntervalMs: number;
        processingBatchSize: number;
    };
}

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3002', 10),
    host: process.env.HOST || '0.0.0.0',
    rabbitMQ: {
        url: process.env.RABBITMQ_URL || 'amqp://localhost',
        queueName: process.env.RABBITMQ_NOTIFICATION_QUEUE || 'notification_queue'
    },
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
        userService: process.env.USER_SERVICE_URL || 'http://localhost:3001/api',
        paymentService: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003/api',
        notificationService: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api',
        apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000/api',
        serviceSecret: process.env.SERVICE_SECRET || 'sbc_all_services'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined'
    },

    email: {
        service: process.env.EMAIL_SERVICE || '',
        user: process.env.EMAIL_USER || '',
        password: process.env.EMAIL_PASSWORD || '',
        from: process.env.EMAIL_FROM || 'Sniper Business Center <notification@example.com>'
    },

    sms: {
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
        twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
        provider: process.env.SMS_PROVIDER || 'twilio',
        queenSmsApiKey: process.env.QUEEN_SMS_API_KEY || '',
        queenSmsApiUrl: process.env.QUEEN_SMS_API_URL || '',
        queenSmsSenderId: process.env.QUEEN_SMS_SENDER_ID || ''
    },

    rabbitmq: {
        url: process.env.RABBITMQ_URL || 'amqp://localhost',
        notificationQueue: process.env.RABBITMQ_NOTIFICATION_QUEUE || 'notification_queue'
    },

    notification: {
        processingIntervalMs: parseInt(process.env.NOTIFICATION_PROCESSING_INTERVAL_MS || '60000', 10),
        processingBatchSize: parseInt(process.env.NOTIFICATION_PROCESSING_BATCH_SIZE || '50', 10)
    },

};

// Validation function for required configurations
const validateConfig = (): void => {
    const requiredEnvs = [
        'MONGODB_URI',
        'JWT_SECRET'
    ];

    // Only validate these in production
    if (config.nodeEnv === 'production') {
        requiredEnvs.push(
            'EMAIL_SERVICE',
            'EMAIL_USER',
            'EMAIL_PASSWORD',
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN',
            'TWILIO_PHONE_NUMBER',
            'RABBITMQ_URL'
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