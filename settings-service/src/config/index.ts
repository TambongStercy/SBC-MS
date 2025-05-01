import dotenv from 'dotenv';

dotenv.config(); // Load .env file

const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '3007',
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sbc_settings_dev',
    jwt: {
        secret: process.env.JWT_SECRET || 'supersecretkey',
        accessExpiry: process.env.ACCESS_TOKEN_EXPIRY || '1h',
        refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    },
    // Add Google Drive config
    googleDrive: {
        clientEmail: process.env.DRIVE_CLIENT_EMAIL,
        privateKey: process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Handle escaped newlines
        parentFolderId: process.env.DRIVE_SETTINGS_FOLDER_ID // Optional: Specify a folder for settings files
    },
    cors: {
        // Example: ALLOWED_ORIGINS=http://localhost:5173,https://your-admin-frontend.com
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'], // Default to allow all
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

export default config; 