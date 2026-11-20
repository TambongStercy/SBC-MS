// Test environment: own database (sbc_support_test), Redis DB 15 with its own
// prefix, no real outbound service (every URL points at a closed port and
// fetch is mocked in the tests).
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/sbc_support_test';
process.env.REDIS_URL = 'redis://localhost:6379/15';
process.env.REDIS_KEY_PREFIX = 'sbc-support:test:';
process.env.SUPPORT_JWT_SECRET = 'test-support-jwt-secret-0123456789abcdefghij';
process.env.JWT_SECRET = 'test-member-jwt-secret';
process.env.SERVICE_SECRET = 'test-service-secret';
process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPPORT_PUBLIC_URL = 'https://support.test';
process.env.SUPPORT_ALLOWED_ORIGINS = 'https://support.test';
process.env.USER_SERVICE_URL = 'http://127.0.0.1:9';
process.env.PAYMENT_SERVICE_URL = 'http://127.0.0.1:9';
process.env.ADVERTISING_SERVICE_URL = 'http://127.0.0.1:9';
process.env.NOTIFICATION_SERVICE_URL = 'http://127.0.0.1:9';
process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
process.env.DEEPSEEK_BASE_URL = 'http://deepseek.test';
process.env.TURNSTILE_SECRET = '';
process.env.LOGIN_MIN_MS = '60';
process.env.JOBS_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
