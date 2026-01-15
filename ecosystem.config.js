module.exports = {
  apps: [
    {
      name: 'gateway-service',
      cwd: './gateway-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'user-service',
      cwd: './user-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'notification-service',
      cwd: './notification-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    },
    {
      name: 'payment-service',
      cwd: './payment-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3003
      }
    },
    {
      name: 'product-service',
      cwd: './product-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3004
      }
    },
    {
      name: 'tombola-service',
      cwd: './tombola-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3006
      }
    },
    {
      name: 'settings-service',
      cwd: './settings-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3007
      }
    },
    {
      name: 'chat-service',
      cwd: './chat-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3008
      }
    }
  ]
};
