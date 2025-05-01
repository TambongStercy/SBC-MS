# SBC API Gateway Service

This service functions as the API gateway for the Sniper Business Center (SBC) microservices architecture, providing a unified entry point for all client requests.

## Features

- **Centralized Routing**: Routes client requests to the appropriate microservice based on the URL path.
- **Service Authentication**: Handles service-to-service authentication using a shared secret.
- **Request Logging**: Logs all incoming requests for monitoring and debugging.
- **Error Handling**: Provides consistent error responses across all services.
- **Health Checks**: Offers endpoints to check the health of the gateway and underlying services.
- **Cross-Origin Resource Sharing (CORS)**: Configurable CORS policy for browser-based clients.

## Architecture

The gateway service acts as a reverse proxy, forwarding requests to the appropriate microservice:

```
Client → API Gateway → Microservices
```

Routing rules:
- `/api/users/*` and `/api/auth/*` → User Service
- `/api/notifications/*` → Notification Service
- `/api/payments/*` and `/api/transactions/*` → Payment Service
- `/api/products/*` → Product Service

## Setup and Configuration

### Prerequisites

- Node.js 14+
- npm or yarn

### Environment Variables

Configure the service through environment variables in a `.env` file:

```
# Server Configuration
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
CORS_ORIGIN=*

# Service Secrets (IMPORTANT: Replace with strong secrets)
SERVICE_SECRET=your_strong_service_secret
JWT_SECRET=your_strong_jwt_secret

# Microservice URLs
USER_SERVICE_URL=http://localhost:3001/api
NOTIFICATION_SERVICE_URL=http://localhost:3002/api
PAYMENT_SERVICE_URL=http://localhost:3003/api
PRODUCT_SERVICE_URL=http://localhost:3004/api
```

### Installation

```bash
cd gateway-service
npm install
```

### Running the Service

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## API Endpoints

The gateway provides a few direct endpoints:

- `GET /health` - Health check endpoint
- `GET /version` - Returns the gateway version

All other requests are proxied to the appropriate microservice based on the path.

## Service-to-Service Authentication

When the gateway forwards requests to microservices, it adds the following headers:

- `Authorization: Bearer <SERVICE_SECRET>` - For service authentication
- `X-Service-Name: gateway-service` - To identify the calling service

## Production Deployment

For production deployment, ensure:

1. Strong, unique values for `SERVICE_SECRET` and `JWT_SECRET`
2. Appropriate CORS settings
3. SSL/TLS termination (using a reverse proxy like Nginx or a cloud load balancer)
4. Proper containerization (Docker) and orchestration (Kubernetes, etc.)

## Monitoring

The service logs to both console and files (in the `logs` directory):
- `combined.log` - All log levels
- `error.log` - Only error level logs

In production, consider sending logs to a centralized logging system. 