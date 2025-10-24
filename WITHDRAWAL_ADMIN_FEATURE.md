# Withdrawal Sub-Admin Feature Implementation Guide

## Overview
This document outlines the implementation of a sub-admin system specifically for managing withdrawal requests. This feature allows the main admin to create multiple withdrawal administrators who can help manage withdrawal approvals.

---

## Features Implemented

### Backend Features

1. **New User Role: `WITHDRAWAL_ADMIN`**
   - Added to `UserRole` enum in user-service
   - Sub-admins can only access withdrawal-related features
   - Multiple withdrawal admins can be created

2. **Sub-Admin Management API** (User Service)
   - **POST** `/api/users/sub-admins` - Create new withdrawal admin
   - **GET** `/api/users/sub-admins` - List all withdrawal admins
   - **PUT** `/api/users/sub-admins/:id` - Update sub-admin details
   - **PATCH** `/api/users/sub-admins/:id/block` - Block/unblock sub-admin
   - **DELETE** `/api/users/sub-admins/:id` - Delete sub-admin

3. **Referral Statistics Service** (User Service)
   - Calculates direct and indirect referrals (3 levels deep)
   - Counts referrals with active CLASSIQUE/CIBLE subscriptions
   - **Internal API**: `GET /api/users/internal/:userId/referral-stats`
   - Returns:
     ```json
     {
       "directReferrals": number,
       "indirectReferrals": number,
       "totalReferrals": number,
       "directSubscribedReferrals": number,
       "indirectSubscribedReferrals": number,
       "totalSubscribedReferrals": number
     }
     ```

4. **Enhanced Withdrawal Details** (Payment Service)
   - Withdrawal requests now include:
     - Complete user information
     - Referral statistics (direct/indirect with active subscriptions)
     - User's withdrawal history
     - Current balance across all currencies

---

## Files Created/Modified

### User Service

#### New Files:
1. **`src/services/referral-stats.service.ts`**
   - Service for calculating referral statistics
   - Traverses 3 levels of referrals
   - Checks for active subscriptions

2. **`src/api/controllers/sub-admin.controller.ts`**
   - Controller for managing withdrawal sub-admins
   - Create, list, update, block, delete operations
   - Only accessible by main ADMIN

3. **`src/api/routes/sub-admin.routes.ts`**
   - Routes for sub-admin management
   - All routes protected with `isAuthenticated` and `isAdmin` middleware

#### Modified Files:
1. **`src/database/models/user.model.ts`**
   ```typescript
   export enum UserRole {
       USER = 'user',
       ADMIN = 'admin',
       WITHDRAWAL_ADMIN = 'withdrawal_admin', // NEW
   }
   ```

2. **`src/api/controllers/user.controller.ts`**
   - Added `getReferralStats()` method for internal service calls

3. **`src/api/routes/user.routes.ts`**
   - Added route: `GET /users/internal/:userId/referral-stats`
   - Added route: `POST/GET/PUT/DELETE /users/sub-admins/*`

### Payment Service

#### Modified Files:
1. **`src/services/clients/user.service.client.ts`**
   - Added `ReferralStats` interface
   - Added `getReferralStats(userId)` method
   - Calls user service to get referral statistics

---

## Pending Implementation

### Backend (Still Needed)

1. **Update Withdrawal Approval Controller** (Payment Service)
   ```typescript
   // In getPendingWithdrawals() and getWithdrawalDetails()
   // Need to add:
   - referralStats = await userServiceClient.getReferralStats(userId)
   - withdrawalHistory = await getWithdrawalHistoryForUser(userId)
   ```

2. **Create Withdrawal History Endpoints** (Payment Service)
   - `GET /api/payments/admin/withdrawals/history/:userId` - Get user's withdrawal history
   - `GET /api/payments/admin/withdrawals/validated` - Get all validated withdrawals
   - Need to query Transaction model for past withdrawals

3. **Role-Based Access Control Middleware** (Payment Service)
   ```typescript
   // Allow both ADMIN and WITHDRAWAL_ADMIN to access withdrawal routes
   export const isWithdrawalAdminOrAdmin = (req, res, next) => {
       if (req.user.role === 'admin' || req.user.role === 'withdrawal_admin') {
           next();
       } else {
           res.status(403).json({ message: 'Access denied' });
       }
   };
   ```

4. **Update Auth Middleware** (Gateway/User Service)
   - Ensure WITHDRAWAL_ADMIN can authenticate
   - Return role in JWT token

---

### Frontend (Needed)

1. **Sub-Admin Management Page**
   - Create page at `/sub-admins`
   - List all withdrawal admins
   - Add new withdrawal admin form
   - Edit/block/delete actions
   - Only accessible by main admin

2. **Update Withdrawal Approval Page**
   - Add referral statistics display:
     ```
     Direct Referrals: 10 (5 with active subscriptions)
     Indirect Referrals: 25 (12 with active subscriptions)
     Total Subscribed Referrals: 17
     ```
   - Add withdrawal history section showing past requests
   - Show user's complete profile information

3. **Withdrawal History Page**
   - Dedicated page showing all validated withdrawals
   - Filter by date range, user, amount
   - Export to CSV functionality

4. **Update Sidebar & Authentication**
   - Add conditional rendering based on user role
   - Show only withdrawal-related menu items for WITHDRAWAL_ADMIN
   - Main admin sees everything including sub-admin management

5. **Login Page Updates**
   - Support WITHDRAWAL_ADMIN login
   - Redirect to appropriate dashboard based on role

---

## API Response Examples

### Get Withdrawal with Enhanced Data

**Request**: `GET /api/payments/admin/withdrawals/pending`

**Response**:
```json
{
  "success": true,
  "data": {
    "withdrawals": [
      {
        "_id": "...",
        "transactionId": "TXN_123...",
        "userId": "user123",
        "userName": "John Doe",
        "userEmail": "john@example.com",
        "userPhoneNumber": "+237123456789",
        "amount": 50000,
        "currency": "XAF",
        "status": "pending_admin_approval",
        "createdAt": "2025-01-24T10:00:00.000Z",
        "userBalance": {
          "XAF": 75000,
          "USD": 120
        },
        "referralStats": {
          "directReferrals": 10,
          "indirectReferrals": 25,
          "totalReferrals": 35,
          "directSubscribedReferrals": 5,
          "indirectSubscribedReferrals": 12,
          "totalSubscribedReferrals": 17
        },
        "withdrawalHistory": [
          {
            "transactionId": "TXN_PREV_001",
            "amount": 30000,
            "status": "completed",
            "createdAt": "2025-01-15T10:00:00.000Z"
          },
          {
            "transactionId": "TXN_PREV_002",
            "amount": 20000,
            "status": "completed",
            "createdAt": "2025-01-10T10:00:00.000Z"
          }
        ]
      }
    ],
    "pagination": {...}
  }
}
```

---

## Database Schema

No database changes required - using existing User and Transaction models.

---

## Security Considerations

1. **Sub-Admin Permissions**
   - Can ONLY access withdrawal routes
   - Cannot access user management, settings, other services
   - Cannot create other sub-admins (only main admin can)

2. **Password Security**
   - Passwords hashed with bcrypt
   - Minimum password requirements enforced

3. **Audit Trail**
   - Log all sub-admin actions (approval/rejection)
   - Include sub-admin email in logs

---

## Testing Checklist

### Backend Tests
- [ ] Create sub-admin successfully
- [ ] List all sub-admins with pagination
- [ ] Update sub-admin details
- [ ] Block/unblock sub-admin
- [ ] Delete sub-admin
- [ ] Referral stats calculation correct
- [ ] Withdrawal details include all required data
- [ ] Role-based access control works
- [ ] WITHDRAWAL_ADMIN can access withdrawal routes
- [ ] WITHDRAWAL_ADMIN cannot access admin-only routes

### Frontend Tests
- [ ] Sub-admin management page loads
- [ ] Create new sub-admin form works
- [ ] List displays all sub-admins
- [ ] Edit/block/delete actions work
- [ ] Withdrawal approval page shows referral stats
- [ ] Withdrawal history displays correctly
- [ ] Sidebar shows correct items based on role
- [ ] Login works for WITHDRAWAL_ADMIN
- [ ] Redirects to appropriate dashboard

---

## Deployment Steps

1. **Deploy User Service**
   ```bash
   cd user-service
   npm run build
   pm2 restart user-service
   ```

2. **Deploy Payment Service**
   ```bash
   cd payment-service
   npm run build
   pm2 restart payment-service
   ```

3. **Deploy Admin Frontend**
   ```bash
   cd admin-frontend-ms
   npm run build
   # Copy dist folder to server
   pm2 restart admin-frontend-ms
   ```

4. **Create First Sub-Admin** (via API or admin panel)
   ```bash
   POST /api/users/sub-admins
   {
     "name": "Withdrawal Admin 1",
     "email": "withdrawals@sbc.com",
     "password": "SecurePassword123!",
     "phoneNumber": "+237123456789"
   }
   ```

---

## Next Steps

1. Complete payment service withdrawal controller updates
2. Create withdrawal history endpoints
3. Implement frontend pages
4. Add role-based access control middleware
5. Test entire workflow
6. Deploy to production

---

**Status**: ✅ Backend partially complete (user service done, payment service needs updates)
**Next**: Complete payment service updates and start frontend implementation
