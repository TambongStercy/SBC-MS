# Activation Balance Feature - Implementation Plan

## Overview

This feature adds a dedicated **Activation Balance** (`activationBalance`) that allows users to:
1. Transfer funds from their main balance to activation balance
2. Use activation balance ONLY to activate accounts of their referrals (direct and indirect)
3. Transfer activation balance to other users' activation balance (P2P activation transfer)

**BEAC Compliance**: This separation is required by BEAC regulations - activation funds are segregated from regular balance to avoid regulatory sanctions.

---

## Pricing Reference

| Action | Price (XAF) |
|--------|-------------|
| Inscription (Basic Pack - CLASSIQUE) | 2,150 XAF |
| Upgrade (CLASSIQUE → CIBLE) | 3,150 XAF |
| Pack Ciblé (CIBLE) | 5,300 XAF |

---

## Architecture Changes

### 1. User Model Changes (user-service)

**File:** `user-service/src/database/models/user.model.ts`

Add new field to IUser interface:
```typescript
interface IUser extends Document {
    // ... existing fields
    balance: number;           // Main balance (XAF)
    usdBalance: number;        // USD balance
    activationBalance: number; // NEW: Activation-only balance (XAF only)
    // ...
}
```

Default value: `activationBalance: 0`

### 2. New Model: Activation Transfer (user-service)

**File:** `user-service/src/database/models/activation-transfer.model.ts`

```typescript
interface IActivationTransfer extends Document {
    fromUser: Types.ObjectId;           // Sender
    toUser: Types.ObjectId;             // Receiver
    amount: number;                      // Amount in XAF
    type: 'BALANCE_TO_ACTIVATION' | 'ACTIVATION_TO_USER';
    description: string;
    createdAt: Date;
}
```

### 3. New Model: Sponsored Activation (user-service)

**File:** `user-service/src/database/models/sponsored-activation.model.ts`

```typescript
interface ISponsoredActivation extends Document {
    sponsor: Types.ObjectId;            // User who paid for activation
    beneficiary: Types.ObjectId;        // User who got activated
    subscriptionType: SubscriptionType; // CLASSIQUE, CIBLE, or UPGRADE
    amount: number;                      // Amount deducted from sponsor
    subscription: Types.ObjectId;       // Created subscription reference
    createdAt: Date;
}
```

---

## New API Endpoints

### User Service Endpoints

#### 1. Get Activation Balance
```
GET /api/users/activation-balance
Response: { activationBalance: number }
```

#### 2. Transfer Main Balance → Activation Balance
```
POST /api/users/activation-balance/transfer-in
Body: { amount: number }
Response: { success: true, newActivationBalance: number, newBalance: number }
```

Validation:
- Amount must be positive
- Amount must be ≤ user's main balance
- Minimum transfer: 100 XAF

#### 3. Transfer Activation Balance → Another User's Activation Balance
```
POST /api/users/activation-balance/transfer-to-user
Body: { recipientId: string, amount: number }
Response: { success: true, newActivationBalance: number }
```

Validation:
- Amount must be positive
- Amount must be ≤ sender's activation balance
- Recipient must exist and be active
- Minimum transfer: 100 XAF

#### 4. Activate Referral's Account (Sponsor Activation)
```
POST /api/users/referrals/:referralUserId/sponsor-activation
Body: { subscriptionType: 'CLASSIQUE' | 'CIBLE' | 'UPGRADE' }
Response: { success: true, subscription: ISubscription, amountDeducted: number }
```

Validation:
- Referral must be in sponsor's referral tree (direct or indirect)
- Sponsor must have sufficient activation balance
- Referral must not already have the subscription type (or must be eligible for upgrade)
- Correct pricing based on subscription type

#### 5. Get Activation Transfer History
```
GET /api/users/activation-balance/history
Query: { page?: number, limit?: number, type?: 'BALANCE_TO_ACTIVATION' | 'ACTIVATION_TO_USER' | 'SPONSOR_ACTIVATION' }
Response: { transfers: IActivationTransfer[], pagination: {...} }
```

#### 6. Get Referrals Available for Activation
```
GET /api/users/referrals/available-for-activation
Response: {
    referrals: [{
        user: { _id, name, email, referralCode },
        level: 1 | 2 | 3,
        currentSubscription: SubscriptionType | null,
        canActivate: boolean,
        canUpgrade: boolean,
        activationPrice: number,
        upgradePrice: number
    }]
}
```

---

## Service Layer Implementation

### User Service

**File:** `user-service/src/services/activation-balance.service.ts` (NEW)

```typescript
class ActivationBalanceService {
    // Transfer from main balance to activation balance
    async transferToActivationBalance(userId: string, amount: number): Promise<TransferResult>

    // Transfer activation balance to another user
    async transferActivationToUser(fromUserId: string, toUserId: string, amount: number): Promise<TransferResult>

    // Sponsor a referral's activation
    async sponsorReferralActivation(
        sponsorId: string,
        referralUserId: string,
        subscriptionType: SubscriptionType
    ): Promise<SponsorActivationResult>

    // Get activation balance
    async getActivationBalance(userId: string): Promise<number>

    // Get transfer history
    async getTransferHistory(userId: string, options: HistoryOptions): Promise<TransferHistory>

    // Get referrals available for activation
    async getReferralsForActivation(userId: string): Promise<ReferralActivationInfo[]>
}
```

### User Repository Updates

**File:** `user-service/src/database/repositories/user.repository.ts`

Add methods:
```typescript
async updateActivationBalance(userId: string, amount: number): Promise<IUser | null>
async transferToActivationBalance(userId: string, amount: number): Promise<{ balance: number, activationBalance: number }>
async transferActivationBetweenUsers(fromUserId: string, toUserId: string, amount: number): Promise<boolean>
```

---

## Pricing Constants

**File:** `user-service/src/config/activation-pricing.ts` (NEW)

```typescript
export const ACTIVATION_PRICES = {
    CLASSIQUE: 2150,      // Basic inscription
    CIBLE: 5300,          // Pack ciblé (direct)
    UPGRADE: 3150,        // Upgrade from CLASSIQUE to CIBLE
};

export const MIN_ACTIVATION_TRANSFER = 100; // Minimum transfer amount in XAF
```

---

## Commission Distribution for Sponsored Activations

When a user sponsors another user's activation:

1. **Deduct from sponsor's activation balance** (not main balance)
2. **Create subscription** for the beneficiary
3. **Distribute commissions** to referrers above the BENEFICIARY (not the sponsor)
   - The referral chain is based on WHO WAS ACTIVATED, not who paid
   - This maintains the MLM commission structure integrity

Example:
- User A refers User B
- User B refers User C
- User C sponsors (activates) User D's account
- Commission goes to: User D's referrers (if any), NOT User C's chain

---

## Database Migration

### Migration Script

```javascript
// Add activationBalance field to all existing users
db.users.updateMany(
    { activationBalance: { $exists: false } },
    { $set: { activationBalance: 0 } }
);

// Create index for activation transfers
db.activationtransfers.createIndex({ fromUser: 1, createdAt: -1 });
db.activationtransfers.createIndex({ toUser: 1, createdAt: -1 });

// Create index for sponsored activations
db.sponsoredactivations.createIndex({ sponsor: 1, createdAt: -1 });
db.sponsoredactivations.createIndex({ beneficiary: 1 });
```

---

## Frontend Requirements (Admin + Mobile App)

### Admin Dashboard
- View user's activation balance alongside main balance
- View activation transfer history
- View sponsored activation history

### Mobile App
1. **Wallet Screen**: Show activation balance separately
2. **Transfer to Activation**: Button to move funds from main → activation
3. **Referral List**: Show "Activate Account" button for unactivated referrals
4. **Activation Modal**: Select subscription type, confirm deduction
5. **P2P Transfer**: Transfer activation balance to another user (search by referral code or phone)
6. **History**: View all activation-related transactions

---

## Implementation Order

### Phase 1: Core Infrastructure
1. Add `activationBalance` field to User model
2. Create `ActivationTransfer` model
3. Create `SponsoredActivation` model
4. Create `activation-pricing.ts` config
5. Update User repository with new methods

### Phase 2: Service Layer
1. Create `ActivationBalanceService`
2. Implement balance transfer logic
3. Implement P2P activation transfer
4. Implement sponsor activation logic
5. Integrate with existing subscription service

### Phase 3: API Endpoints
1. Create activation balance controller
2. Implement all 6 endpoints
3. Add validation middleware
4. Add authentication/authorization checks

### Phase 4: Integration
1. Update admin frontend to display activation balance
2. Document API changes for mobile team
3. Run migration script on production

---

## Security Considerations

1. **Atomic Operations**: All balance transfers use MongoDB transactions
2. **Race Conditions**: Use optimistic locking or `$inc` operators
3. **Validation**: Check referral relationship before allowing sponsored activation
4. **Audit Trail**: All transfers logged in `ActivationTransfer` collection
5. **BEAC Compliance**: Activation balance cannot be withdrawn or converted back to main balance (one-way transfer)

---

## Questions for Clarification

1. **Can activation balance be transferred back to main balance?**
   - Current assumption: NO (one-way transfer for BEAC compliance)

2. **Can non-referrals be activated?**
   - Current assumption: NO (only direct/indirect referrals)

3. **Commission on sponsored activations goes to whom?**
   - Current assumption: Beneficiary's referrer chain (not sponsor's)

4. **Is there a limit on activation balance transfers per day?**
   - Current assumption: No daily limit (unlike withdrawals)

5. **What about RELANCE subscription?**
   - Current assumption: Not included in sponsor activation (only CLASSIQUE, CIBLE, UPGRADE)
