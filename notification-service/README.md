# Notification Service

A microservice for sending and managing notifications via multiple channels (email, SMS, push) for the SBC Platform.

## Features

- Send notifications via email and SMS
- Template-based notification content
- Background processing for reliability
- JWT-based authentication
- Notification history and statistics

## Prerequisites

- Node.js >= 18.0.0
- MongoDB
- SMTP server (for email notifications)
- Twilio account (for SMS notifications)

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file (use `.env.example` as a template)
4. Build the TypeScript:
   ```
   npm run build
   ```
5. Start the service:
   ```
   npm start
   ```

For development:
```
npm run dev
```

## Environment Variables

See the `.env.example` file for all required environment variables.

## API Endpoints

### Authentication

All endpoints except `/health` and `/api/notifications/otp` require JWT authentication with a Bearer token in the Authorization header.

### User Endpoints

- `GET /api/notifications/me` - Get notifications for the authenticated user
- `GET /api/notifications/me/stats` - Get notification statistics for the authenticated user

### Admin Endpoints

- `POST /api/notifications/custom` - Send a custom notification (requires admin role)
- `POST /api/notifications/templated` - Send a templated notification (requires admin role)

### Service-to-Service Endpoints

- `POST /api/notifications/otp` - Send an OTP notification (typically called by the User Service)

## Health Check

- `GET /health` - Service health check endpoint

## Architecture

The notification service follows a layered architecture:

1. **API Layer** - Controllers and routes handling HTTP requests
2. **Service Layer** - Business logic for notifications
3. **Repository Layer** - Data access layer for MongoDB
4. **Delivery Layer** - Integration with email and SMS providers

## Notification Processor

The service includes a background processor that regularly checks for pending notifications and attempts to deliver them. This ensures reliability even if a notification delivery fails initially.

## Templates

Notification templates are defined in `src/utils/templates.ts` and organized by notification type. Templates support variable substitution using the `{{variable}}` syntax. 