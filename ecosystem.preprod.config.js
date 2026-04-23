module.exports = {
  apps: [
    {
      name: 'gateway-preprod',
      cwd: './gateway-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6000,
        USER_SERVICE_URL: 'http://localhost:6001',
        NOTIFICATION_SERVICE_URL: 'http://localhost:6002',
        PAYMENT_SERVICE_URL: 'http://localhost:6003',
        PRODUCT_SERVICE_URL: 'http://localhost:6004',
        ADVERTISING_SERVICE_URL: 'http://localhost:6005',
        TOMBOLA_SERVICE_URL: 'http://localhost:6006',
        SETTINGS_SERVICE_URL: 'http://localhost:6007',
        CHAT_SERVICE_URL: 'http://localhost:6008'
      }
    },
    {
      name: 'user-preprod',
      cwd: './user-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6001
      }
    },
    {
      name: 'notification-preprod',
      cwd: './notification-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6002
      }
    },
    {
      name: 'payment-preprod',
      cwd: './payment-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6003
      }
    },
    {
      name: 'product-preprod',
      cwd: './product-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6004
      }
    },
    {
      name: 'tombola-preprod',
      cwd: './tombola-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6006
      }
    },
    {
      name: 'settings-preprod',
      cwd: './settings-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6007
      }
    },
    {
      name: 'chat-preprod',
      cwd: './chat-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'preprod',
        PORT: 6008
      }
    }
  ]
};
