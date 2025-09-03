# 💰 SBC Payout & Withdrawal System Documentation

## 📋 Overview

The SBC Payout System provides comprehensive money transfer capabilities using CinetPay's API, supporting both user withdrawals and admin payouts across 9 African countries.

## 🚀 Features

- **User Withdrawals**: Simple withdrawals using stored momo details
- **Admin User Withdrawals**: Admin-initiated withdrawals for specific users
- **Admin Direct Payouts**: Direct payouts without user account involvement
- **Multi-Country Support**: 9 African countries with mobile money
- **Auto-Detection**: Automatic operator detection from phone numbers
- **Real-time Status**: Webhook notifications for transaction updates

## 🌍 Supported Countries & Operators

### 📱 Valid momoOperator Values

| Country | Country Code | Currency | momoOperator Values | Payment Gateway | Withdrawal Gateway |
|---------|--------------|----------|--------------------|-----------------|--------------------|
| **Cameroun** | CM | XAF | `MTN`, `ORANGE`, `mtn`, `orange` | CinetPay | CinetPay |
| **Côte d'Ivoire** | CI | XOF | `ORANGE`, `MTN`, `MOOV`, `WAVE` | CinetPay | CinetPay ✅ |
| **Sénégal** | SN | XOF | `ORANGE`, `FREE`, `WAVE` | CinetPay | CinetPay ✅ |
| **Burkina Faso** | BF | XOF | `ORANGE`, `MOOV` | CinetPay | CinetPay ✅ |
| **Togo** | TG | XOF | `TMONEY`, `FLOOZ` | FeexPay* | CinetPay |
| **Benin** | BJ | XOF | `MTN`, `MOOV` | FeexPay | FeexPay |
| **Mali** | ML | XOF | `ORANGE`, `MOOV` | CinetPay | CinetPay |
| **Guinea** | GN | GNF | `ORANGE`, `MTN` | FeexPay | FeexPay |
| **Congo (RDC)** | CD | CDF | `ORANGE`, `MPESA`, `AIRTEL` | FeexPay | FeexPay |

*Note: Togo uses FeexPay for payments but CinetPay for withdrawals due to client preference.*

### 🔄 Gateway Routing Logic

**CinetPay Countries (Payments & Withdrawals):**
- Cameroun (CM), Côte d'Ivoire (CI), Sénégal (SN), Burkina Faso (BF), Mali (ML), Niger (NE)

**FeexPay Countries (Payments & Withdrawals):**
- Benin (BJ), Congo Brazzaville (CG), Guinea (GN), Gabon (GA), Congo DRC (CD), Kenya (KE), Nigeria (NG)

**Special Case:**
- **Togo (TG)**: FeexPay for payments, CinetPay for withdrawals

### 📞 Valid momoNumber Format

The `momoNumber` field should include the **full international number with country code**:

#### ✅ Correct Formats:
```
237675080477    (Cameroon MTN)
237655123456    (Cameroon Orange)
225070123456    (Côte d'Ivoire)
221771234567    (Sénégal)
228901234567    (Togo)
229901234567    (Benin)
223701234567    (Mali)
226701234567    (Burkina Faso)
224621234567    (Guinea)
243901234567    (Congo RDC)
```

#### ❌ Incorrect Formats:
```
675080477       (Missing country code)
+237675080477   (Plus sign not needed)
0675080477      (Leading zero with country code)
```

### 🔍 Country Code Detection

The system automatically detects country codes from momoNumber:

| Country Code Prefix | Country | Example |
|-------------------|---------|---------|
| **237** | Cameroun | 237675080477 |
| **225** | Côte d'Ivoire | 225070123456 |
| **221** | Sénégal | 221771234567 |
| **228** | Togo | 228901234567 |
| **229** | Benin | 229901234567 |
| **223** | Mali | 223701234567 |
| **226** | Burkina Faso | 226701234567 |
| **224** | Guinea | 224621234567 |
| **243** | Congo (RDC) | 243901234567 |

## 🔗 API Endpoints

### 1. User Withdrawal

**Endpoint**: `POST /api/withdrawals/user`
**Authentication**: User token required
**Description**: User initiates withdrawal using their stored momo details

#### Request Body:
```json
{
  "amount": 5000
}
```

#### Response:
```json
{
  "success": true,
  "message": "Withdrawal initiated successfully",
  "data": {
    "transactionId": "SBC_user123_1640995200000",
    "cinetpayTransactionId": "EA250601.001443.R477918",
    "amount": 5000,
    "recipient": "+237675080477",
    "status": "pending",
    "estimatedCompletion": "2024-01-01T13:05:00.000Z"
  }
}
```

#### Requirements:
- ✅ User must be authenticated
- ✅ User must have sufficient balance
- ✅ User must have `momoNumber` and `momoOperator` configured
- ✅ Amount must be ≥ 500 and multiple of 5

### 2. Admin User Withdrawal

**Endpoint**: `POST /api/withdrawals/admin/user`
**Authentication**: Admin token required
**Description**: Admin initiates withdrawal for a specific user (with optional override parameters)

#### Request Body (Normal):
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "amount": 5000
}
```

#### Request Body (With Override):
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "amount": 5000,
  "phoneNumber": "675080477",
  "countryCode": "CM",
  "paymentMethod": "MTNCM",
  "recipientName": "Alternative Recipient"
}
```

#### Response (Normal):
```json
{
  "success": true,
  "message": "Admin withdrawal initiated successfully",
  "data": {
    "transactionId": "SBC_user123_1640995200000",
    "cinetpayTransactionId": "EA250601.001443.R477918",
    "amount": 5000,
    "recipient": "+237675080477",
    "targetUser": {
      "id": "65d2b0344a7e2b9efbf6205d",
      "name": "Tambong Stercy",
      "email": "user@example.com"
    },
    "status": "pending",
    "estimatedCompletion": "2024-01-01T13:05:00.000Z",
    "isOverride": false
  }
}
```

#### Response (With Override):
```json
{
  "success": true,
  "message": "Admin override withdrawal initiated successfully",
  "data": {
    "transactionId": "SBC_user123_1640995200000",
    "cinetpayTransactionId": "EA250601.001443.R477918",
    "amount": 5000,
    "recipient": "+237675080477",
    "targetUser": {
      "id": "65d2b0344a7e2b9efbf6205d",
      "name": "Tambong Stercy",
      "email": "user@example.com"
    },
    "status": "pending",
    "estimatedCompletion": "2024-01-01T13:05:00.000Z",
    "isOverride": true,
    "overrideDetails": {
      "originalMomo": "237655123456",
      "overrideRecipient": "+237675080477",
      "reason": "Admin override for problem resolution"
    }
  }
}
```

#### Requirements:
- ✅ Admin authentication required
- ✅ Target user must exist and have sufficient balance
- ✅ **Normal Mode**: Target user must have momo details configured
- ✅ **Override Mode**: When override parameters provided, user momo details not required
- ✅ **Override Validation**: Both `phoneNumber` and `countryCode` required when using override

### 3. Admin Direct Payout

**Endpoint**: `POST /api/withdrawals/admin/direct`
**Authentication**: Admin token required
**Description**: Admin direct payout without user account involvement

#### Request Body:
```json
{
  "amount": 5000,
  "phoneNumber": "675080477",
  "countryCode": "CM",
  "recipientName": "John Doe",
  "recipientEmail": "john@example.com",
  "paymentMethod": "MTNCM",
  "description": "Direct admin payout"
}
```

#### Response:
```json
{
  "success": true,
  "message": "Admin direct payout initiated successfully",
  "data": {
    "transactionId": "SBC_admin_admin123_1640995200000",
    "cinetpayTransactionId": "EA250601.001443.R477918",
    "amount": 5000,
    "recipient": "+237675080477",
    "status": "pending",
    "estimatedCompletion": "2024-01-01T13:05:00.000Z",
    "note": "This is a direct admin payout - no user balance affected"
  }
}
```

#### Requirements:
- ✅ Admin authentication required
- ✅ All fields required except `recipientEmail`, `paymentMethod`, `description`
- ✅ No user balance validation (affects only API balance)

## 💡 Usage Examples

### User Profile Setup

Before users can withdraw, they must configure their momo details:

```json
{
  "momoNumber": "237675080477",
  "momoOperator": "MTN"
}
```

### Simple User Withdrawal

```bash
curl -X POST http://localhost:3003/api/withdrawals/user \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5000}'
```

### Admin User Withdrawal (Normal)

```bash
curl -X POST http://localhost:3003/api/withdrawals/admin/user \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "65d2b0344a7e2b9efbf6205d", "amount": 5000}'
```

### Admin User Withdrawal (Override)

```bash
# Withdraw from user account but send to different number
curl -X POST http://localhost:3003/api/withdrawals/admin/user \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "65d2b0344a7e2b9efbf6205d",
    "amount": 5000,
    "phoneNumber": "675080477",
    "countryCode": "CM",
    "recipientName": "Alternative Recipient"
  }'
```

### Admin Direct Payout

```bash
curl -X POST http://localhost:3003/api/withdrawals/admin/direct \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "phoneNumber": "675080477",
    "countryCode": "CM",
    "recipientName": "John Doe"
  }'
```

## 🔄 Transaction Flow

### User Withdrawal Flow:
1. **User Request** → Amount only
2. **System Validation** → Balance, momo details
3. **Country Detection** → From momoNumber
4. **CinetPay Contact** → Add/verify contact
5. **Transfer Initiation** → Auto-detect operator
6. **Balance Deduction** → Update user balance
7. **Webhook Updates** → Real-time status

### Admin Flows:
- **Admin User Withdrawal (Normal)**: Same as user flow but initiated by admin
- **Admin User Withdrawal (Override)**: Deduct from user balance but send to different recipient
- **Admin Direct Payout**: No user balance involved, direct API transaction

### 🔧 Admin Override Feature

The admin override feature allows administrators to withdraw money from a user's account but send it to a different mobile money number. This is useful for:

#### Use Cases:
- **Wrong Number**: User configured incorrect momoNumber
- **Account Issues**: User's registered number has problems
- **Emergency Transfers**: Send to family member or alternative number
- **Problem Resolution**: Handle customer service issues
- **Account Recovery**: When user lost access to registered number

#### How It Works:
1. **Balance Deduction**: Money is deducted from the specified user's account
2. **Override Recipient**: Money is sent to the admin-specified phone number
3. **Full Audit Trail**: All override details are logged and returned in response
4. **Validation**: Override parameters are validated just like direct payouts

#### Override Parameters:
- `phoneNumber` (required with override): Target phone number without country code
- `countryCode` (required with override): Target country code (CM, CI, SN, etc.)
- `paymentMethod` (optional): Specific payment method or auto-detect
- `recipientName` (optional): Override recipient name or use user's name

## 📊 Transaction Status

| Status | Description |
|--------|-------------|
| `pending` | Transaction created, awaiting processing |
| `processing` | Being processed by mobile operator |
| `completed` | Successfully completed |
| `failed` | Transaction failed |

## ⚠️ Important Notes

### Minimum Amounts by Country:
- **Cameroun (XAF)**: 500
- **Côte d'Ivoire (XOF)**: 200
- **Sénégal (XOF)**: 200
- **Togo (XOF)**: 150
- **Benin (XOF)**: 500
- **Mali (XOF)**: 500
- **Burkina Faso (XOF)**: 500
- **Guinea (GNF)**: 1000
- **Congo RDC (CDF)**: 1000

### CinetPay Requirements:
- ✅ Amount must be multiple of 5
- ✅ Phone numbers auto-detected for operator
- ✅ Contacts automatically managed
- ✅ HTTPS webhook URLs required

### Error Handling:
- **Insufficient Balance**: User-friendly error message
- **Invalid Momo Details**: Clear validation errors
- **Network Issues**: Automatic retry mechanisms
- **Webhook Failures**: Status polling fallback

## 🔧 Configuration

### Environment Variables:
```env
CINETPAY_API_KEY=your_api_key
CINETPAY_TRANSFER_PASSWORD=your_password
CINETPAY_SITE_ID=your_site_id
SELF_BASE_URL=https://your-domain.com
USER_SERVICE_URL=http://localhost:3001/api
```

### Service Dependencies:
- **User Service**: For user details and balance updates
- **CinetPay API**: For money transfers
- **MongoDB**: For transaction logging
- **Webhook Endpoint**: For status updates

## 🚨 Security

- **Authentication**: JWT tokens required
- **Authorization**: Role-based access (user/admin)
- **Validation**: Comprehensive input validation
- **Rate Limiting**: Prevents abuse
- **Logging**: Full audit trail
- **Balance Protection**: Prevents overdrafts

## 📈 Monitoring

- **Transaction Logs**: All operations logged
- **Balance Tracking**: Real-time balance updates
- **Error Alerts**: Failed transaction notifications
- **Performance Metrics**: Response time monitoring
- **Webhook Status**: Delivery confirmation

This documentation provides complete guidance for implementing and using the SBC Payout & Withdrawal system! 🎯
