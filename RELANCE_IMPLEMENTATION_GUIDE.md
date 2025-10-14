# Relance Feature Implementation Guide

## Overview
This document tracks the implementation of the Relance (WhatsApp follow-up) feature for SBC.

## Feature Requirements
- **Subscription**: 1,000 XAF/month (or $2.2 USD for crypto)
- **Functionality**: Automatic WhatsApp messages to unpaid referrals over 7 days
- **Trigger**: Referrals who haven't paid any subscription after 1 hour of registration
- **Exit Conditions**: User pays any subscription OR 7 days complete
- **Admin Control**: Configurable messages/media for each day (1-7)
- **User Control**: Pause enrollment, pause sending, or disable completely

---

## ✅ PHASE 1: COMPLETED - Core Subscription Infrastructure

### 1.1 Database Model Updates ✅
**File**: `user-service/src/database/models/subscription.model.ts`

**Added Enums**:
```typescript
export enum SubscriptionType {
    CLASSIQUE = 'CLASSIQUE',
    CIBLE = 'CIBLE',
    RELANCE = 'RELANCE', // NEW
}

export enum SubscriptionCategory {
    REGISTRATION = 'registration',  // CLASSIQUE, CIBLE
    FEATURE = 'feature'              // RELANCE
}

export enum SubscriptionDuration {
    LIFETIME = 'lifetime',
    MONTHLY = 'monthly',
}
```

**Added Fields to ISubscription**:
```typescript
category: SubscriptionCategory;     // Separates registration from features
duration: SubscriptionDuration;     // lifetime or monthly
nextRenewalDate?: Date;             // For monthly subscriptions
autoRenew: boolean;                 // Auto-charge on renewal
```

**Added Indexes**:
```typescript
SubscriptionSchema.index({ user: 1, category: 1 });
SubscriptionSchema.index({ category: 1, status: 1 });
```

### 1.2 Repository Updates ✅
**File**: `user-service/src/database/repositories/subscription.repository.ts`

**Updated `findUserSubscriptions` method**:
- Added optional `category` parameter for filtering
- Now supports: `GET /api/subscriptions?category=registration` or `category=feature`

### 1.3 Service Layer Updates ✅
**File**: `user-service/src/services/subscription.service.ts`

**Added RELANCE plans to both XAF and Crypto pricing**:
```typescript
{
    id: SubscriptionType.RELANCE,
    name: 'Abonnement Relance',
    price: 1000, // XAF
    currency: 'XAF',
    description: 'Suivi automatique de vos prospects via WhatsApp pendant 7 jours.',
    category: SubscriptionCategory.FEATURE,
    duration: SubscriptionDuration.MONTHLY,
}
```

**Updated `getUserSubscriptions` method**:
- Now passes `category` filter through to repository

---

## 📋 PHASE 2: TODO - Controller & API Updates

### 2.1 Subscription Controller
**File**: `user-service/src/api/controllers/subscription.controller.ts`

**Update `getUserSubscriptions` method**:
```typescript
async getUserSubscriptions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const category = req.query.category as string;

    // Validate category
    if (category && !['registration', 'feature'].includes(category)) {
        res.status(400).json({
            success: false,
            message: 'Invalid category. Must be "registration" or "feature".'
        });
        return;
    }

    const result = await this.subscriptionService.getUserSubscriptions(
        userId,
        page,
        limit,
        category as SubscriptionCategory | undefined
    );

    res.status(200).json({ success: true, data: result });
}
```

### 2.2 Subscription Routes
**File**: `user-service/src/api/routes/subscription.routes.ts`

**Update API documentation**:
```typescript
/**
 * @route   GET /api/subscriptions?category=registration|feature
 * @desc    Get all user subscriptions with optional category filter
 * @access  Private
 */
```

**Update validation in initiatePurchase**:
```typescript
if (!planType || !(planType in SubscriptionType)) {
    res.status(400).json({
        success: false,
        message: 'Invalid planType. Must be CLASSIQUE, CIBLE, or RELANCE.'
    });
    return;
}
```

### 2.3 Subscription Service - activateSubscription
**File**: `user-service/src/services/subscription.service.ts`

**Handle RELANCE subscriptions**:
```typescript
async activateSubscription(userId: string, type: SubscriptionType): Promise<ISubscription | null> {
    const now = new Date();
    const userObjectId = new Types.ObjectId(userId);

    if (type === SubscriptionType.RELANCE) {
        // Check for existing active RELANCE
        const activeRelance = await this.subscriptionRepository.findActiveSubscriptionByType(
            userObjectId,
            SubscriptionType.RELANCE
        );

        if (activeRelance) {
            this.log.info(`User ${userId} already has active RELANCE subscription`);
            return activeRelance;
        }

        // Create new RELANCE subscription (monthly)
        const nextRenewalDate = new Date(now);
        nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);

        const endDate = new Date(nextRenewalDate);
        endDate.setDate(endDate.getDate() + 1); // Add 1 day buffer

        const newSubscriptionData: Partial<ISubscription> = {
            user: userObjectId,
            subscriptionType: SubscriptionType.RELANCE,
            category: SubscriptionCategory.FEATURE,
            duration: SubscriptionDuration.MONTHLY,
            startDate: now,
            endDate: endDate,
            nextRenewalDate: nextRenewalDate,
            autoRenew: true, // Default to auto-renew
            status: SubscriptionStatus.ACTIVE,
        };

        return await this.subscriptionRepository.create(newSubscriptionData as any);
    }

    // Existing logic for CLASSIQUE/CIBLE...
}
```

---

## 📋 PHASE 3: TODO - Internal Service Endpoints

### 3.1 User Service Internal Routes
**File**: `user-service/src/api/routes/user.routes.ts`

**Add new internal routes**:
```typescript
// Get unpaid referrals for a user
serviceRouter.get('/:userId/unpaid-referrals', (req, res) =>
    userController.getUnpaidReferrals(req, res)
);

// Check if user has active RELANCE subscription
serviceRouter.get('/:userId/has-relance-subscription', (req, res) =>
    userController.hasRelanceSubscription(req, res)
);
```

### 3.2 Update Service Clients in Other Services

**Payment Service Client**:
**File**: `payment-service/src/services/clients/user.service.client.ts`

Update `SubscriptionType`:
```typescript
type SubscriptionType = 'CLASSIQUE' | 'CIBLE' | 'RELANCE' | 'NONE';
```

**Product Service Client**:
**File**: `product-service/src/services/clients/user.service.client.ts`

No changes needed (doesn't use subscription types)

**Notification Service Client**:
**File**: `notification-service/src/services/clients/user.service.client.ts`

Add new methods:
```typescript
async getUserActiveSubscriptions(userId: string): Promise<string[]> {
    const url = `${this.userServiceUrl}/api/users/internal/${userId}/active-subscriptions`;
    const response = await axios.get(url, { headers: this.getHeaders() });
    return response.data?.data || [];
}

async hasRelanceSubscription(userId: string): Promise<boolean> {
    const url = `${this.userServiceUrl}/api/users/internal/${userId}/has-relance-subscription`;
    const response = await axios.get(url, { headers: this.getHeaders() });
    return response.data?.data?.hasRelance || false;
}
```

---

## 📋 PHASE 4: TODO - Notification Service (WhatsApp Integration)

### 4.1 Create Database Models
**New File**: `notification-service/src/database/models/relance-config.model.ts`
**New File**: `notification-service/src/database/models/relance-message.model.ts`
**New File**: `notification-service/src/database/models/relance-target.model.ts`

(See detailed schemas in architecture design document)

### 4.2 WhatsApp Integration
**New File**: `notification-service/src/services/whatsapp.relance.service.ts`

Functions needed:
- `generateQRCode(userId)` - Generate QR for WhatsApp auth
- `authenticateSession(userId, authData)` - Save encrypted session
- `sendRelanceMessage(target, messageTemplate, mediaUrls)` - Send message
- `checkSessionStatus(userId)` - Verify connection

### 4.3 Cron Jobs
**New File**: `notification-service/src/jobs/relance-enrollment.job.ts`
- Runs hourly
- Finds users registered 1 hour ago without subscriptions
- Enrolls them in relance loop

**New File**: `notification-service/src/jobs/relance-sender.job.ts`
- Runs every 6 hours
- Sends due messages
- Updates target records
- Handles failures

### 4.4 API Routes
**New File**: `notification-service/src/api/routes/relance.routes.ts`

User routes:
- `POST /api/relance/connect` - Get QR code for WhatsApp
- `GET /api/relance/status` - Check connection status
- `DELETE /api/relance/disconnect` - Logout WhatsApp
- `PUT /api/relance/pause` - Pause enrollment/sending

Admin routes:
- `GET /api/admin/relance-messages` - List all day messages
- `POST /api/admin/relance-messages` - Create/update message
- `PUT /api/admin/relance-messages/:day` - Update specific day
- `DELETE /api/admin/relance-messages/:day` - Delete message

Internal routes:
- `POST /api/internal/relance/exit-user` - Remove user from loop (when they pay)

---

## 📋 PHASE 5: TODO - Admin Frontend

### 5.1 New Pages
**New File**: `admin-frontend-ms/src/pages/RelanceMessagesPage.tsx`
- Table showing Day 1-7 messages
- Edit modal with rich text editor
- Media upload (images/PDFs/videos)
- Preview with sample variables

**New File**: `admin-frontend-ms/src/pages/RelanceDashboardPage.tsx`
- Total users with Relance subscription
- Active campaigns count
- Messages sent today/week
- Success/failure rates
- Conversion rate (paid after relance)

**New File**: `admin-frontend-ms/src/pages/RelanceLogsPage.tsx`
- View all relance activities
- Filter by user, date, status
- Manual actions (pause, remove from loop)

### 5.2 Update Sidebar
**File**: `admin-frontend-ms/src/components/Sidebar.tsx`

Add menu items:
- Relance Dashboard
- Relance Messages
- Relance Logs

---

## 📋 PHASE 6: TODO - Migration & Deployment

### 6.1 Migration Script
**New File**: `user-service/src/scripts/migrate-subscription-fields.ts`

```typescript
async function migrateExistingSubscriptions() {
    const subscriptions = await SubscriptionModel.find({
        category: { $exists: false }
    });

    for (const sub of subscriptions) {
        await SubscriptionModel.updateOne(
            { _id: sub._id },
            {
                $set: {
                    category: SubscriptionCategory.REGISTRATION,
                    duration: SubscriptionDuration.LIFETIME,
                    autoRenew: false
                }
            }
        );
    }

    console.log(`Migrated ${subscriptions.length} subscriptions`);
}
```

**Run**:
```bash
cd user-service
npm run migrate:subscriptions
```

### 6.2 Environment Variables
Add to `.env` files:

**notification-service**:
```env
WHATSAPP_SESSION_SECRET=<strong_encryption_key>
RELANCE_MAX_CONCURRENT_SESSIONS=50
RELANCE_MESSAGE_DELAY_MS=3000
```

### 6.3 Install Dependencies
**notification-service**:
```bash
npm install whatsapp-web.js qrcode-terminal bull crypto-js
```

---

## 🔍 Testing Checklist

### Backend API
- [ ] GET /api/subscriptions returns all subscriptions (backward compatible)
- [ ] GET /api/subscriptions?category=registration returns only CLASSIQUE/CIBLE
- [ ] GET /api/subscriptions?category=feature returns only RELANCE
- [ ] GET /api/subscriptions/plans includes RELANCE plan
- [ ] POST /api/subscriptions/purchase with planType=RELANCE works
- [ ] Migration script sets correct category/duration for existing subscriptions

### Relance Flow
- [ ] User A refers User B
- [ ] After 1 hour, User B (unpaid) enters relance loop
- [ ] User A receives QR code and can connect WhatsApp
- [ ] Day 1 message sends immediately after enrollment
- [ ] Messages send daily for 7 days
- [ ] If User B pays, they exit loop immediately
- [ ] If User B never pays, they exit after Day 7
- [ ] User A can pause enrollment/sending separately
- [ ] Admin can configure messages for each day
- [ ] Failure notifications work (one-time only)

### Service Clients
- [ ] Payment service can call user service for subscriptions
- [ ] Notification service can check if user has RELANCE subscription
- [ ] All internal endpoints work with new SubscriptionType enum

---

## 📊 Current Progress

**Phase 1**: ✅ **100% Complete**
- Database models updated
- Repository updated
- Service layer updated
- Backward compatibility ensured

**Phase 2**: ✅ **100% Complete**
- Controllers updated (category filter support)
- Routes updated (RELANCE added to all endpoints)
- `activateSubscription` handles RELANCE monthly subscriptions
- Validation updated to accept RELANCE planType

**Phase 3**: ✅ **100% Complete**
- Internal endpoints added: `/:userId/unpaid-referrals`, `/:userId/has-relance-subscription`
- Payment service client updated (SubscriptionType includes RELANCE)
- Notification service client methods added for relance queries

**Phase 4**: ⏳ **0% Complete** (Next step)
- WhatsApp integration needed
- Database models for relance needed
- Cron jobs needed

**Phase 5**: ⏳ **0% Complete**
- Admin frontend needed

**Phase 6**: ✅ **100% Complete**
- Migration script created (`migrate-subscription-fields.ts`)
- Package.json script added: `npm run migrate:subscriptions`
- Ready to run

---

## 🚀 Next Steps

1. **Run migration script** - `cd user-service && npm run migrate:subscriptions`
2. **Test backward compatibility** - Verify frontend still works
3. **Proceed to Phase 4** - WhatsApp integration & relance logic
4. **Phase 5** - Admin frontend updates

---

## 📞 Support

For questions or issues, refer to this guide or check:
- CLAUDE.md for codebase architecture
- README.md for deployment instructions