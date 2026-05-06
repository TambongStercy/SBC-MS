import dotenv from 'dotenv';
import path from 'path'; // Re-add path for loading .env from root
import logger from '../utils/logger'; // Assuming default export for logger

// Load environment variables from .env file (assuming it's in the root of payment-service)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also load local environment file for development
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Helper to ensure URL has /api suffix for service-to-service communication
const ensureApiSuffix = (url: string | undefined, defaultUrl: string): string => {
    const baseUrl = url || defaultUrl;
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

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
        withdrawalsEnabled: boolean;
    };
    lygos: {
        apiKey: string;
        baseUrl: string;
        shopName: string;
        webhookSecret: string;
    };
    nowpayments: {
        apiKey: string;
        email: string;
        password: string;
        sandbox: boolean;
        baseUrl: string;
        ipnSecret: string;
        userPaysNetworkFees: boolean;
        defaultFeePaidByUser: boolean;
        maxRetries: number;
        timeoutMs: number;
        enableEstimation: boolean;
        withdrawalsEnabled: boolean;
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
        baseUrl: string; // New unified API: https://api.cinetpay.net
        withdrawalsEnabled: boolean;
        // Per-country credentials (new platform requires one account per country)
        countries: {
            [countryCode: string]: {
                apiKey: string;
                apiPassword: string;
                currency: string;
            };
        };
    };
    moneyfusion: {
        apiUrl: string;
        payoutUrl: string;
        privateKey: string;
        withdrawalsEnabled: boolean;
    };
    selfBaseUrl: string; // Base URL of this service for webhooks
    withdrawalsEnabled: boolean; // Global withdrawal control switch
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
        webhookSecret: process.env.FEEXPAY_WEBHOOK_SECRET || '',
        withdrawalsEnabled: process.env.FEEXPAY_WITHDRAWALS_ENABLED === 'true' // Default to false for security
    },
    lygos: {
        apiKey: process.env.LYGOS_API_KEY || '',
        baseUrl: process.env.LYGOS_BASE_URL || 'https://api.lygosapp.com/v1',
        shopName: process.env.LYGOS_SHOP_NAME || 'SBC',
        webhookSecret: process.env.LYGOS_WEBHOOK_SECRET || ''
    },
    nowpayments: {
        apiKey: process.env.NOWPAYMENTS_API_KEY || '',
        email: process.env.NOWPAYMENTS_EMAIL || '',
        password: process.env.NOWPAYMENTS_PASSWORD || '',
        sandbox: process.env.NOWPAYMENTS_SANDBOX === 'true',
        baseUrl: process.env.NOWPAYMENTS_BASE_URL || 'https://api.nowpayments.io/v1',
        ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
        userPaysNetworkFees: process.env.NOWPAYMENTS_USER_PAYS_FEES !== 'false',
        defaultFeePaidByUser: process.env.NOWPAYMENTS_DEFAULT_FEE_PAID_BY_USER !== 'false',
        maxRetries: parseInt(process.env.NOWPAYMENTS_MAX_RETRIES || '3', 10),
        timeoutMs: parseInt(process.env.NOWPAYMENTS_TIMEOUT_MS || '30000', 10),
        enableEstimation: process.env.NOWPAYMENTS_ENABLE_ESTIMATION !== 'false',
        withdrawalsEnabled: process.env.NOWPAYMENTS_WITHDRAWALS_ENABLED === 'true'
    },
    services: { // Populate from .env or provide defaults
        userServiceUrl: process.env.USER_SERVICE_URL ? ensureApiSuffix(process.env.USER_SERVICE_URL, '') : undefined,
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL ? ensureApiSuffix(process.env.NOTIFICATION_SERVICE_URL, '') : undefined,
        productServiceUrl: process.env.PRODUCT_SERVICE_URL ? ensureApiSuffix(process.env.PRODUCT_SERVICE_URL, '') : undefined,
        advertisingServiceUrl: process.env.ADVERTISING_SERVICE_URL ? ensureApiSuffix(process.env.ADVERTISING_SERVICE_URL, '') : undefined,
        tombolaServiceUrl: process.env.TOMBOLA_SERVICE_URL ? ensureApiSuffix(process.env.TOMBOLA_SERVICE_URL, '') : undefined,
        serviceSecret: process.env.SERVICE_SECRET || 'sbc_all_services',
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    paymentServiceBaseUrl: process.env.PAYMENT_SERVICE_BASE_URL || 'http://localhost:3003',
    logLevel: process.env.LOG_LEVEL || 'info',
    cinetpay: {
        baseUrl: process.env.CINETPAY_BASE_URL || 'https://api.cinetpay.co',
        withdrawalsEnabled: process.env.CINETPAY_WITHDRAWALS_ENABLED === 'true',
        // Per-country credentials loaded from env vars: CINETPAY_{CC}_API_KEY, CINETPAY_{CC}_API_PASSWORD
        countries: (() => {
            const countryCurrencies: Record<string, string> = {
                CM: 'XAF', CI: 'XOF', SN: 'XOF', BF: 'XOF', ML: 'XOF', NE: 'XOF',
                GN: 'GNF', CD: 'CDF', BJ: 'XOF', TG: 'XOF'
            };
            const countries: Record<string, { apiKey: string; apiPassword: string; currency: string }> = {};
            for (const [cc, currency] of Object.entries(countryCurrencies)) {
                const apiKey = process.env[`CINETPAY_${cc}_API_KEY`];
                const apiPassword = process.env[`CINETPAY_${cc}_API_PASSWORD`];
                if (apiKey && apiPassword) {
                    countries[cc] = { apiKey, apiPassword, currency };
                }
            }
            return countries;
        })(),
    },
    moneyfusion: {
        apiUrl: process.env.MONEYFUSION_API_URL || '', // The API URL from the dashboard
        payoutUrl: process.env.MONEYFUSION_PAYOUT_URL || 'https://pay.moneyfusion.net/api/v1/withdraw',
        privateKey: process.env.MONEYFUSION_PRIVATE_KEY || '', // For payout auth header
        withdrawalsEnabled: process.env.MONEYFUSION_WITHDRAWALS_ENABLED === 'true',
    },
    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3003',
    withdrawalsEnabled: process.env.WITHDRAWALS_ENABLED === 'true', // Global withdrawal control - default false
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
        'MONEYFUSION_API_URL', // CM, CD, GA, NE, ML route through MoneyFusion
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