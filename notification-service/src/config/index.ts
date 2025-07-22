import * as dotenv from 'dotenv';
import * as path from 'path';
import logger from '../utils/logger';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Define config interface for type safety
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
    app: {
        frontendUrl: string;
        supportUrl: string;
        appLogoUrl: string;
    };
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
        // Add bounce handling configuration
        bounceHandling: {
            enabled: boolean;
            webhookSecret: string;
            maxRetries: number;
            retryDelay: number;
        };
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
    redis: {
        host: string;
        port: number;
        password?: string;
        db: number;
    };
    whatsapp: {
        accessToken: string;
        phoneNumberId: string;
        businessAccountId: string;
        webhookVerifyToken: string;
        apiVersion: string;
        apiBaseUrl: string;
        enableCloudApi: boolean;
        enableWebhookValidation: boolean;
        enableRateLimiting: boolean;
        enableRetryLogic: boolean;
    };
}

const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3002', 10),
    host: process.env.HOST || '0.0.0.0',
    app: {
        frontendUrl: process.env.FRONTEND_URL || 'https://sniperbuisnesscenter.com',
        supportUrl: process.env.SUPPORT_URL || 'https://www.whatsapp.com/channel/0029Vav3mvCElah05C8QuT03',
        appLogoUrl: process.env.APP_LOGO_URL || 'https://sniperbuisnesscenter.com/assets/images/logo.png'
    },
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
        from: process.env.EMAIL_FROM || 'Sniper Business Center <noreply@sniperbuisnesscenter.com>', // Use main verified domain
        // Add bounce handling configuration
        bounceHandling: {
            enabled: process.env.EMAIL_BOUNCE_HANDLING_ENABLED === 'true',
            webhookSecret: process.env.SENDGRID_WEBHOOK_SECRET || '',
            maxRetries: parseInt(process.env.EMAIL_MAX_RETRIES || '3', 10),
            retryDelay: parseInt(process.env.EMAIL_RETRY_DELAY || '300000', 10), // 5 minutes
        }
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

    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10)
    },

    whatsapp: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
        webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
        apiBaseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com',
        enableCloudApi: process.env.WHATSAPP_ENABLE_CLOUD_API === 'true',
        enableWebhookValidation: process.env.WHATSAPP_ENABLE_WEBHOOK_VALIDATION !== 'false',
        enableRateLimiting: process.env.WHATSAPP_ENABLE_RATE_LIMITING !== 'false',
        enableRetryLogic: process.env.WHATSAPP_ENABLE_RETRY_LOGIC !== 'false'
    },

};

// Validation function for required configurations
const validateConfig = (): void => {
    const requiredEnvs = [
        'JWT_SECRET'
    ];

    // Only validate these in production
    if (config.nodeEnv === 'production') {
        requiredEnvs.push(
            'EMAIL_SERVICE',
            'EMAIL_USER',
            'EMAIL_PASSWORD',
            // 'TWILIO_ACCOUNT_SID',
            // 'TWILIO_AUTH_TOKEN',
            // 'TWILIO_PHONE_NUMBER',
            // 'RABBITMQ_URL'
        );

        // Add WhatsApp Cloud API validation in production if enabled
        if (config.whatsapp.enableCloudApi) {
            requiredEnvs.push(
                'WHATSAPP_ACCESS_TOKEN',
                'WHATSAPP_PHONE_NUMBER_ID',
                'WHATSAPP_BUSINESS_ACCOUNT_ID',
                'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
            );
        }
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