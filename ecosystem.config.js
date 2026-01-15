module.exports = {
  apps: [
    {
      name: 'gateway-service',
      cwd: './gateway-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_file: './gateway-service/.env'
    },
    {
      name: 'user-service',
      cwd: './user-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      env_file: './user-service/.env'
    },
    {
      name: 'notification-service',
      cwd: './notification-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      env_file: './notification-service/.env'
    },
    {
      name: 'payment-service',
      cwd: './payment-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003
      },
      env_file: './payment-service/.env'
    },
    {
      name: 'product-service',
      cwd: './product-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3004
      },
      env_file: './product-service/.env'
    },
    {
      name: 'tombola-service',
      cwd: './tombola-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3006
      },
      env_file: './tombola-service/.env'
    },
    {
      name: 'settings-service',
      cwd: './settings-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3007
      },
      env_file: './settings-service/.env'
    },
    {
      name: 'chat-service',
      cwd: './chat-service',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3008
      },
      env_file: './chat-service/.env'
    }
  ]
};
