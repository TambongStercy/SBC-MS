import dotenv from 'dotenv';
import path from 'path'; // Re-add path for loading .env from root
import logger from '../utils/logger'; // Assuming default export for logger

// Load environment variables from .env file (assuming it's in the root of payment-service)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Define Config Interface (based on user-service and payment needs)
interface IConfig {
    nodeEnv: string;
    port: number;
    host: string;
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
    feexpay: {
        apiKey: string;
        shopId: string;
        baseUrl: string;
        webhookSecret: string;
    };
    lygos: {
        apiKey: string;
        baseUrl: string;
        shopName: string;
        webhookSecret: string;
    };
    nowpayments: {
        apiKey: string;
        sandbox: boolean;
        baseUrl: string;
        ipnSecret: string;
        payoutApiKey?: string; // For mass payouts
        webhookSecret: string;
    };
    services: { // Added based on user-service pattern
        serviceSecret: string;
        userServiceUrl?: string;
        notificationServiceUrl?: string; // Add other needed services
        productServiceUrl?: string; // Add product service URL field
        advertisingServiceUrl?: string; // Added
        tombolaServiceUrl?: string;     // Added
    };
    frontendUrl: string;
    paymentServiceBaseUrl: string;
    logLevel: string;
    cinetpay: {
        baseUrl: string;
        transferBaseUrl: string;
        apiKey: string;
        apiSecret: string;
        apiPassword: string;
        transferPassword: string; // Password for transfer API
        siteId: string;
        notificationKey: string;
        alternateNotifyUrl?: string; // Optional HTTPS webhook URL for production
    };
    selfBaseUrl: string; // Base URL of this service for webhooks
}

// Configuration object
const config: IConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3003', 10), // Default to 3003 for payment service?
    host: process.env.HOST || '0.0.0.0',
    mongodb: {
        uri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD as string : process.env.MONGODB_URI_DEV as string,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        }
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'default-payment-secret', // Use a specific secret
        expiresIn: process.env.JWT_EXPIRES_IN || '1h'
    },

    feexpay: {
        apiKey: process.env.FEEXPAY_API_KEY || '',
        shopId: process.env.FEEXPAY_SHOP_ID || '',
        baseUrl: process.env.FEEXPAY_BASE_URL || 'https://api.feexpay.me/api',
        webhookSecret: process.env.FEEXPAY_WEBHOOK_SECRET || ''
    },
    lygos: {
        apiKey: process.env.LYGOS_API_KEY || '',
        baseUrl: process.env.LYGOS_BASE_URL || 'https://api.lygosapp.com/v1',
        shopName: process.env.LYGOS_SHOP_NAME || 'SBC',
        webhookSecret: process.env.LYGOS_WEBHOOK_SECRET || ''
    },
    nowpayments: {
        apiKey: process.env.NOWPAYMENTS_API_KEY || '',
        sandbox: process.env.NOWPAYMENTS_SANDBOX === 'true',
        baseUrl: process.env.NOWPAYMENTS_BASE_URL || 'https://api.nowpayments.io/v1',
        ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
        payoutApiKey: process.env.NOWPAYMENTS_PAYOUT_API_KEY,
        webhookSecret: process.env.NOWPAYMENTS_WEBHOOK_SECRET || ''
    },
    services: { // Populate from .env or provide defaults
        userServiceUrl: process.env.USER_SERVICE_URL,
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL,
        productServiceUrl: process.env.PRODUCT_SERVICE_URL,
        advertisingServiceUrl: process.env.ADVERTISING_SERVICE_URL, // Added
        tombolaServiceUrl: process.env.TOMBOLA_SERVICE_URL,       // Added
        serviceSecret: process.env.SERVICE_SECRET || 'sbc_all_services',
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    paymentServiceBaseUrl: process.env.PAYMENT_SERVICE_BASE_URL || 'http://localhost:3003',
    logLevel: process.env.LOG_LEVEL || 'info',
    cinetpay: {
        baseUrl: process.env.CINETPAY_BASE_URL || 'https://api-checkout.cinetpay.com/v2',
        transferBaseUrl: process.env.CINETPAY_TRANSFER_BASE_URL || 'https://client.cinetpay.com/v1',
        apiKey: process.env.CINETPAY_API_KEY || '',
        apiSecret: process.env.CINETPAY_SECRET_KEY || '',
        apiPassword: process.env.CINETPAY_API_PASSWORD || '',
        transferPassword: process.env.CINETPAY_TRANSFER_PASSWORD || '',
        siteId: process.env.CINETPAY_SITE_ID || '',
        notificationKey: process.env.CINETPAY_NOTIFICATION_KEY || '',
        alternateNotifyUrl: process.env.CINETPAY_ALTERNATE_NOTIFY_URL || ''
    },
    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3003',
};

// Validation function
const validateConfig = (): void => {
    const requiredEnvVars = [
        'NODE_ENV',
        'PORT',
        'HOST',
        'MONGODB_URI_PROD',
        'JWT_SECRET',
        'FEEXPAY_API_KEY',
        'FEEXPAY_SHOP_ID',
        'CINETPAY_API_KEY',
        'CINETPAY_SITE_ID',
        'NOWPAYMENTS_API_KEY', // Added for crypto payments
        'PAYMENT_SERVICE_BASE_URL',
        'FRONTEND_URL', // Likely needed for redirects
        'SERVICE_SECRET',
        'USER_SERVICE_URL',
        'ADVERTISING_SERVICE_URL', // Added
        'TOMBOLA_SERVICE_URL'      // Added
    ];

    const missingEnvs = requiredEnvVars.filter(env => !process.env[env]);

    if (missingEnvs.length > 0) {
        // Use logger if available, otherwise console.error
        const logFunc = logger ? logger.error : console.error;
        logFunc(`Missing required environment variables: ${missingEnvs.join(', ')}`);
        process.exit(1);
    }
};

// Run validation (consider if logger is initialized before this)
validateConfig();

export default config; // Export as default following user-service pattern