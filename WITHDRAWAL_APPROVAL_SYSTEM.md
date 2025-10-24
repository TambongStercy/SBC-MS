# Withdrawal Approval System Documentation

## Overview

The SBC withdrawal system has been enhanced with an **admin approval layer** to prevent fraud and provide better control over fund disbursements. All user-initiated withdrawals now require admin approval before processing.

---

## 🔄 **New Withdrawal Flow**

### **Previous Flow (Direct Processing)**
```
User initiates withdrawal
   ↓
OTP verification
   ↓
Immediate external payout
   ↓
Funds sent automatically
```

### **New Flow (Admin Approval Required)**
```
User initiates withdrawal
   ↓
OTP verification
   ↓
Status: PENDING_ADMIN_APPROVAL ⏸️
   ↓
Admin reviews in dashboard
   ↓
Admin approves/rejects
   ↓
If approved: External payout initiated
If rejected: Funds refunded to user
```

---

## 📊 **New Transaction Statuses**

Two new statuses have been added to the `TransactionStatus` enum:

| Status | Description | Next Action |
|--------|-------------|-------------|
| `PENDING_ADMIN_APPROVAL` | Withdrawal verified by user (OTP) but awaiting admin approval | Admin must approve/reject |
| `REJECTED_BY_ADMIN` | Withdrawal rejected by admin, funds refunded | None (final status) |

---

## 🎯 **API Endpoints**

### **Admin Withdrawal Management Endpoints**

Base URL: `/api/admin/withdrawals`

#### **1. Get Pending Withdrawals**
```http
GET /api/admin/withdrawals/pending
```

**Query Parameters:**
- `page` (number, default: 1): Page number
- `limit` (number, default: 20): Items per page
- `withdrawalType` (string, optional): Filter by type ('mobile_money' | 'crypto')

**Response:**
```json
{
  "success": true,
  "data": {
    "withdrawals": [
      {
        "_id": "...",
        "transactionId": "TXN_1234567890",
        "userId": "...",
        "type": "withdrawal",
        "amount": 5100,
        "fee": 100,
        "currency": "XAF",
        "status": "pending_admin_approval",
        "metadata": {
          "withdrawalType": "mobile_money",
          "accountInfo": {
            "fullMomoNumber": "237650000000",
            "momoOperator": "MTN_MOMO_CMR",
            "countryCode": "CM"
          }
        },
        "createdAt": "2025-01-24T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

#### **2. Get Withdrawal Statistics**
```http
GET /api/admin/withdrawals/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pendingApproval": 45,
    "approvedToday": 12,
    "rejectedToday": 3,
    "processing": 8
  }
}
```

#### **3. Get Withdrawal Details**
```http
GET /api/admin/withdrawals/:transactionId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "TXN_1234567890",
    "userId": "...",
    "amount": 5100,
    "fee": 100,
    "currency": "XAF",
    "status": "pending_admin_approval",
    "description": "User withdrawal request",
    "metadata": {
      "withdrawalType": "mobile_money",
      "accountInfo": {...},
      "statusDetails": "OTP verified, awaiting admin approval"
    },
    "createdAt": "2025-01-24T10:00:00Z",
    "updatedAt": "2025-01-24T10:05:00Z"
  }
}
```

#### **4. Approve Withdrawal**
```http
POST /api/admin/withdrawals/:transactionId/approve
```

**Request Body:**
```json
{
  "adminNotes": "Verified user identity, approved for processing"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Withdrawal approved successfully and processing initiated",
  "data": {
    "transactionId": "TXN_1234567890",
    "status": "processing",
    "approvedBy": "admin_user_id",
    "approvedAt": "2025-01-24T11:00:00Z"
  }
}
```

#### **5. Reject Withdrawal**
```http
POST /api/admin/withdrawals/:transactionId/reject
```

**Request Body:**
```json
{
  "rejectionReason": "Suspected fraudulent activity",
  "adminNotes": "Multiple withdrawals from same device within 1 hour"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Withdrawal rejected successfully",
  "data": {
    "transactionId": "TXN_1234567890",
    "status": "rejected_by_admin",
    "rejectedBy": "admin_user_id",
    "rejectedAt": "2025-01-24T11:00:00Z",
    "rejectionReason": "Suspected fraudulent activity",
    "refundedAmount": 5100
  }
}
```

#### **6. Bulk Approve Withdrawals**
```http
POST /api/admin/withdrawals/bulk-approve
```

**Request Body:**
```json
{
  "transactionIds": ["TXN_123", "TXN_456", "TXN_789"],
  "adminNotes": "Bulk approval for verified users"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bulk approval completed: 3 approved, 0 failed",
  "data": {
    "approved": 3,
    "failed": 0,
    "errors": []
  }
}
```

---

## 🔐 **Security & Authorization**

### **Admin-Only Access**
All withdrawal approval endpoints require:
1. **Authentication**: Valid JWT token
2. **Admin Role**: User must have admin privileges
3. **Rate Limiting**: General rate limiter applied to all routes

### **Middleware Stack**
```typescript
router.use(authenticate);     // Verify JWT token
router.use(requireAdmin);     // Check admin role
router.use(generalLimiter);   // Rate limiting
```

---

## 💾 **Database Changes**

### **New Fields in Transaction Model**

```typescript
interface ITransaction {
  // ... existing fields ...

  // Admin Approval Fields
  approvedBy?: ObjectId;        // Admin who approved
  approvedAt?: Date;            // Approval timestamp
  rejectedBy?: ObjectId;        // Admin who rejected
  rejectedAt?: Date;            // Rejection timestamp
  rejectionReason?: string;     // Reason for rejection
  adminNotes?: string;          // Admin notes/comments
}
```

### **Transaction Status Flow**

```
PENDING_OTP_VERIFICATION
        ↓ (OTP verified)
PENDING_ADMIN_APPROVAL ←── NEW STATUS
        ↓
   ┌────┴────┐
   ↓         ↓
PROCESSING  REJECTED_BY_ADMIN ←── NEW STATUS
   ↓
COMPLETED
```

---

## 📧 **Notifications**

### **User Notifications**

#### **1. After OTP Verification**
- **Type**: `withdrawal_pending_approval`
- **Message**: "Your withdrawal request has been verified and is now awaiting admin approval."
- **Channels**: Email, WhatsApp

#### **2. After Admin Approval**
- **Type**: `withdrawal_approved`
- **Message**: "Your withdrawal has been approved and is now being processed."
- **Channels**: Email, WhatsApp

#### **3. After Admin Rejection**
- **Type**: `withdrawal_rejected`
- **Message**: "Your withdrawal has been rejected. Reason: [reason]. Amount refunded to your balance."
- **Channels**: Email, WhatsApp, SMS

---

## 🛠️ **Admin Dashboard Integration**

### **Required UI Components**

#### **1. Pending Withdrawals Table**
Display columns:
- Transaction ID
- User Name/Email
- Amount + Currency
- Withdrawal Type (Mobile Money/Crypto)
- Date Requested
- Actions (Approve/Reject/View Details)

#### **2. Withdrawal Details Modal**
Show:
- Full transaction details
- User information
- Account/wallet details
- Transaction history
- Risk indicators
- Approve/Reject buttons with reason input

#### **3. Statistics Dashboard**
Metrics:
- Pending approvals (count)
- Approved today (count)
- Rejected today (count)
- Currently processing (count)
- Average approval time
- Rejection rate

#### **4. Bulk Actions**
- Select multiple withdrawals
- Bulk approve for trusted users
- Filter by amount/type/date
- Search by transaction ID or user

---

## ⚙️ **Business Logic**

### **Approval Process**

When admin approves a withdrawal:
1. Update transaction status to `PROCESSING`
2. Record admin ID and approval timestamp
3. Add admin notes to transaction metadata
4. Determine withdrawal type (mobile money or crypto)
5. Initiate external payout via appropriate gateway:
   - **Mobile Money**: CinetPay or FeexPay
   - **Crypto**: NOWPayments
6. Send approval notification to user
7. Return success response

### **Rejection Process**

When admin rejects a withdrawal:
1. Calculate refund amount (original amount + fee)
2. Refund to user's balance (XAF or USD depending on withdrawal type)
3. Update transaction status to `REJECTED_BY_ADMIN`
4. Record rejection reason and admin details
5. Add rejection metadata to transaction
6. Send rejection notification to user with reason
7. Return success response

### **Balance Handling**

**Important**: User balance is NOT debited during OTP verification anymore. It's only debited when:
- Admin approves the withdrawal, OR
- During approval, balance is checked again before processing

This prevents balance being held up for extended periods while awaiting approval.

---

## 🚨 **Error Handling**

### **Common Errors**

| Error | Status | Cause | Solution |
|-------|--------|-------|----------|
| `Transaction not found` | 404 | Invalid transaction ID | Verify transaction ID |
| `Cannot approve withdrawal with status: X` | 400 | Wrong status | Only `PENDING_ADMIN_APPROVAL` can be approved |
| `Rejection reason is required` | 400 | Missing required field | Provide rejection reason |
| `Admin not authenticated` | 401 | Missing/invalid token | Re-authenticate |
| `Insufficient balance` | 400 | User spent funds while waiting | Cancel/reject withdrawal |

---

## 📈 **Monitoring & Analytics**

### **Key Metrics to Track**

1. **Approval Rate**: `(Approved / Total) * 100`
2. **Average Approval Time**: Time from `PENDING_ADMIN_APPROVAL` to `PROCESSING`
3. **Rejection Reasons**: Group by reason to identify patterns
4. **Peak Withdrawal Times**: Identify when most withdrawals occur
5. **Admin Performance**: Track which admins approve/reject and response times

### **Logging**

All actions are logged:
```
[INFO] Admin {adminId} approving withdrawal {transactionId}
[INFO] Withdrawal {transactionId} approved by admin {adminId} and processing initiated
[INFO] Admin {adminId} rejecting withdrawal {transactionId}: {reason}
[INFO] Withdrawal {transactionId} rejected by admin {adminId}. {amount} refunded to user {userId}
```

---

## 🔄 **Migration Guide**

### **For Existing Deployments**

1. **Database Migration** (automatic via Mongoose):
   - New fields will be added automatically
   - Existing transactions unaffected
   - No manual migration needed

2. **Pending Withdrawals**:
   - Any withdrawals in `PENDING` status before deployment will continue processing automatically
   - Only NEW withdrawals after deployment will require admin approval

3. **Admin Dashboard**:
   - Deploy new admin UI components
   - Train admins on new approval workflow
   - Set up monitoring dashboards

---

## 🧪 **Testing**

### **Test Scenarios**

#### **1. Normal Flow**
```
1. User initiates withdrawal
2. User verifies OTP
3. Check status = PENDING_ADMIN_APPROVAL
4. Admin approves
5. Check status = PROCESSING
6. Verify external payout initiated
7. User receives notification
```

#### **2. Rejection Flow**
```
1. User initiates withdrawal
2. User verifies OTP
3. Admin rejects with reason
4. Check status = REJECTED_BY_ADMIN
5. Verify balance refunded
6. User receives rejection notification
```

#### **3. Bulk Approval**
```
1. Create 5 pending withdrawals
2. Admin bulk approves all 5
3. Verify all 5 move to PROCESSING
4. Check all users notified
```

### **Test Endpoints**

```bash
# Get pending withdrawals
curl -X GET "http://localhost:3003/api/admin/withdrawals/pending" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Approve withdrawal
curl -X POST "http://localhost:3003/api/admin/withdrawals/TXN_123/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adminNotes": "Approved"}'

# Reject withdrawal
curl -X POST "http://localhost:3003/api/admin/withdrawals/TXN_123/reject" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rejectionReason": "Fraud suspected", "adminNotes": "Multiple requests"}'
```

---

## 🎯 **Benefits**

### **Fraud Prevention**
- ✅ Manual review of all withdrawals
- ✅ Identify suspicious patterns
- ✅ Prevent unauthorized fund transfers
- ✅ Admin notes for future reference

### **Control & Oversight**
- ✅ Full audit trail of all approvals/rejections
- ✅ Admin accountability
- ✅ Bulk operations for efficiency
- ✅ Statistics and monitoring

### **User Experience**
- ✅ Clear status updates
- ✅ Notifications at each step
- ✅ Transparent rejection reasons
- ✅ Automatic refunds on rejection

---

## 📝 **Future Enhancements**

1. **Auto-Approval Rules**
   - Approve withdrawals below threshold automatically
   - Whitelist trusted users
   - Time-based auto-approval (e.g., after 24h)

2. **Risk Scoring**
   - Calculate risk score for each withdrawal
   - Flag high-risk withdrawals for review
   - ML-based fraud detection

3. **Multi-Level Approval**
   - Require 2 admins for large amounts
   - Escalation workflows
   - Role-based approval limits

4. **Enhanced Analytics**
   - Fraud detection dashboard
   - Pattern recognition
   - Automated alerts for suspicious activity

---

## 🆘 **Support & Troubleshooting**

### **Common Issues**

**Issue**: Withdrawals stuck in PENDING_ADMIN_APPROVAL
**Solution**: Check admin dashboard, ensure admins are actively reviewing

**Issue**: Balance not refunded after rejection
**Solution**: Check transaction metadata for refundedAmount, verify user service connection

**Issue**: Bulk approval failing for some transactions
**Solution**: Check response errors array, some may have wrong status

### **Contact**

For issues or questions:
- Check logs: `payment-service/logs`
- Review transaction metadata
- Contact development team

---

**Last Updated**: January 2025
**Version**: 1.0.0
