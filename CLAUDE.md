# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a microservices-based backend system for Sniper Business Center (SBC) with an admin frontend. The system consists of 8 Node.js/TypeScript microservices, a React admin frontend, and supporting infrastructure components.

### Core Services

- **Gateway Service** (port 3000): API gateway and routing
- **User Service** (port 3001): User management, authentication, referrals, subscriptions  
- **Notification Service** (port 3002): Email, SMS, WhatsApp notifications with Redis queue
- **Payment Service** (port 3003): Payment processing, transactions, crypto payments, withdrawals
- **Product Service** (port 3004): Product management and flash sales
- **Advertising Service** (port 3005): Advertisement management
- **Tombola Service** (port 3006): Lottery/tombola functionality
- **Settings Service** (port 3007): Global settings and file storage (Google Drive integration)
- **Admin Frontend** (port 3030): React/TypeScript admin dashboard with Vite

### Infrastructure

- **MongoDB**: Each service has its own database (e.g., `sbc_user_dev`, `sbc_payment_dev`)
- **Redis**: Used by notification service for job queues
- **Nginx**: Reverse proxy serving frontend and routing API requests

## Development Commands

### Docker Development (Recommended)
```bash
# Start all services
docker-compose up

# Start specific service
docker-compose up user-service

# Rebuild and start
docker-compose up --build

# View logs
docker-compose logs -f user-service
```

### Individual Service Development
Each backend service supports:
```bash
# Development with auto-reload
npm run dev

# Build TypeScript
npm run build

# Production start
npm start
```

### Admin Frontend
```bash
cd admin-frontend-ms
npm run dev     # Development server
npm run build   # Production build
npm run lint    # ESLint check
```

### Testing Commands
- **Notification Service**: `npm test` (Jest)
- **Gateway Service**: `npm test` (Jest) 
- **Product Service**: `npm test` or `npm run test:watch` (Jest)
- **Other services**: Tests not implemented

### Linting
- **Admin Frontend**: `npm run lint`
- **Tombola Service**: `npm run lint` or `npm run lint:fix`
- **Notification Service**: `npm run lint` or `npm run lint:fix`

## Service Architecture Patterns

### Common Structure
```
service-name/
├── src/
│   ├── api/
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/      # Auth, validation, rate limiting
│   │   └── routes/          # Route definitions
│   ├── database/
│   │   ├── models/          # Mongoose schemas
│   │   └── repositories/    # Data access layer
│   ├── services/            # Business logic
│   ├── utils/               # Shared utilities
│   └── server.ts            # Entry point
├── Dockerfile & Dockerfile.dev
└── package.json
```

### Key Technologies
- **Backend**: Node.js, TypeScript, Express, Mongoose, JWT
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Recharts
- **Infrastructure**: Docker, Nginx, Redis, MongoDB

## Admin Frontend Development Rules

### UI/UX Standards

**CRITICAL: Never use browser alerts, prompts, or confirms in the admin frontend.**

The admin frontend must maintain professional UI/UX standards. Follow these rules:

1. **No JavaScript Alerts**: Never use `alert()`, `window.alert()`, `confirm()`, `window.confirm()`, or `prompt()` for user feedback.

2. **Use Toast Notifications**: For non-blocking feedback (success, error, warning, info):
   ```typescript
   import { useToast } from '../hooks/useToast';
   import ToastContainer from '../components/common/ToastContainer';

   const { toasts, removeToast, showSuccess, showError, showWarning, showInfo } = useToast();

   // Success feedback
   showSuccess('Operation completed successfully!');

   // Error feedback
   showError('Operation failed. Please try again.');

   // Add ToastContainer to JSX
   <ToastContainer toasts={toasts} onRemove={removeToast} />
   ```

3. **Use Confirmation Modals**: For user confirmations before dangerous actions:
   ```typescript
   import ConfirmationModal from '../components/common/ConfirmationModal';

   const [showConfirmModal, setShowConfirmModal] = useState(false);
   const [confirmAction, setConfirmAction] = useState<{
       title: string;
       message: string;
       onConfirm: () => void;
   } | null>(null);

   // Trigger confirmation
   setConfirmAction({
       title: 'Confirm Action',
       message: 'Are you sure you want to proceed?',
       onConfirm: async () => {
           // Execute action
           setShowConfirmModal(false);
       }
   });
   setShowConfirmModal(true);

   // Add ConfirmationModal to JSX
   {confirmAction && (
       <ConfirmationModal
           isOpen={showConfirmModal}
           title={confirmAction.title}
           message={confirmAction.message}
           confirmText="Confirm"
           cancelText="Cancel"
           onConfirm={confirmAction.onConfirm}
           onCancel={() => setShowConfirmModal(false)}
       />
   )}
   ```

4. **Available Toast Systems**:
   - Custom toast system: `useToast()` hook with ToastContainer component
   - React Hot Toast: `toast.success()`, `toast.error()` (used in some pages)

5. **When to Use Each**:
   - **Toast Notifications**: Success messages, error messages, warnings, non-critical info
   - **Confirmation Modals**: Delete operations, irreversible actions, role changes, bulk operations
   - **Form Validation**: Display errors inline or in modals, never with alerts

### Inter-Service Communication
Services communicate via HTTP REST APIs through the gateway. Service URLs are configured in docker-compose environment variables (e.g., `USER_SERVICE_URL: http://user-service:3001`).

### Authentication & Authorization
- JWT tokens for authentication
- Service-to-service auth via `SERVICE_SECRET` headers
- Role-based access control (RBAC) in user service

## Payment System Integration

The payment service integrates with multiple providers:
- **CinetPay**: Mobile money and card payments for African markets
- **FeexPay**: Local payment processing
- **NOWPayments**: Cryptocurrency payments
- **QR Code**: Payment UI with real-time updates

## Database Conventions

- Each service uses its own MongoDB database
- Development databases: `sbc_{service}_dev` (e.g., `sbc_user_dev`)
- Models use Mongoose schemas with TypeScript interfaces
- Repository pattern for data access

## File Structure Notes

- Payment service includes EJS views and public assets for payment UI
- Settings service handles file uploads to Google Drive
- Notification service supports WhatsApp Business API integration
- Multiple documentation files exist for specific features (crypto payments, withdrawals, etc.)

## Special Scripts

### User Service
```bash
npm run recalc:partners           # Recalculate partner transactions (dry run)
npm run recalc:partners:apply     # Apply partner transaction recalculation
npm run check:countries           # Analyze country data
npm run fix:countries             # Fix country data issues
```

### Payment Service  
```bash
npm run build-css                # Build Tailwind CSS for payment UI
```

### Notification Service
```bash
npm run dev:worker:broadcast      # Run broadcast worker in development
npm run validate:whatsapp         # Validate WhatsApp setup
```

When working with this codebase, always check the specific service's package.json for available scripts and refer to the comprehensive README.md for deployment instructions.