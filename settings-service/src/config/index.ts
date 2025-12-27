import dotenv from 'dotenv';

dotenv.config(); // Load .env file

// Helper to ensure URL has /api suffix for service-to-service communication
const ensureApiSuffix = (url: string | undefined, defaultUrl: string): string => {
    const baseUrl = url || defaultUrl;
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '3007',
    mongodbUri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI_PROD as string : process.env.MONGODB_URI_DEV as string,
    jwt: {
        secret: process.env.JWT_SECRET || 'supersecretkey',
        accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '1h',
        refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    },
    // Add Google Drive config
    googleDrive: {
        clientEmail: process.env.DRIVE_CLIENT_EMAIL,
        privateKey: process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Handle escaped newlines
        parentFolderId: process.env.DRIVE_SETTINGS_FOLDER_ID, // Optional: Default folder for general settings files
        profilePictureFolderId: process.env.PP_FOLDER, // Folder for Profile Pictures
        productDocsFolderId: process.env.PD_FOLDER    // Folder for Product documents/images
    },
    cors: {
        // Example: ALLOWED_ORIGINS=http://localhost:5173,https://your-admin-frontend.com
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'], // Default to allow all
    },

    services: {
        serviceSecret: process.env.SERVICE_SECRET || 'sbc_all_services',
        userService: ensureApiSuffix(process.env.USER_SERVICE_URL, 'http://localhost:3001'),
        productService: ensureApiSuffix(process.env.PRODUCT_SERVICE_URL, 'http://localhost:3004'),
        paymentService: ensureApiSuffix(process.env.PAYMENT_SERVICE_URL, 'http://localhost:3003'),
        notificationService: ensureApiSuffix(process.env.NOTIFICATION_SERVICE_URL, 'http://localhost:3002'),
        settingsServiceUrl: ensureApiSuffix(process.env.SETTINGS_SERVICE_URL, 'http://localhost:3007'),
        apiGateway: ensureApiSuffix(process.env.API_GATEWAY_URL, 'http://localhost:3000')
    },

    log: {
        level: process.env.LOG_LEVEL || 'info',
        logDir: process.env.LOG_DIR || './logs',
    }
    // Add other configurations as needed
};

// Validate essential Google Drive configuration
if (!config.googleDrive.clientEmail || !config.googleDrive.privateKey) {
    console.warn('Google Drive configuration (Client Email, Private Key) is missing in environment variables. File uploads will fail.');
    // Optionally throw error:
    // throw new Error('Missing Google Drive configuration');
}

// Validate specific folder IDs if they are considered essential
if (!config.googleDrive.profilePictureFolderId) {
    console.warn('Google Drive configuration for Profile Pictures (PP_FOLDER) is missing. Uploads to this folder might fail or use default.');
}
if (!config.googleDrive.productDocsFolderId) {
    console.warn('Google Drive configuration for Product Docs (PD_FOLDER) is missing. Uploads to this folder might fail or use default.');
}

export default config; 