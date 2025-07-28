# Minimum Withdrawal Amount Validation - 500 FCFA

## Overview

All withdrawal operations in the SBC payment system now enforce a **minimum withdrawal amount of 500 FCFA**. This validation is consistently applied across all withdrawal endpoints to ensure operational efficiency and compliance with payment gateway requirements.

## Implementation

### ✅ Validation Rules

1. **Minimum Amount**: 500 FCFA
2. **Amount Type**: Must be a positive number
3. **Multiple Requirement**: Must be a multiple of 5 (CinetPay requirement)
4. **Currency**: Amounts are in FCFA (XOF)

### 🔧 Validation Middleware

The validation is implemented in three middleware functions in `src/api/middleware/validation.ts`:

#### 1. `validateWithdrawal`
Used for user-initiated withdrawals.

```typescript
if (amount < 500) {
    return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is 500'
    });
}
```

#### 2. `validateAdminUserWithdrawal` 
Used for admin-initiated user withdrawals.

```typescript
if (amount < 500) {
    return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is 500'
    });
}
```

#### 3. `validateAdminDirectPayout`
Used for admin direct payouts.

```typescript
if (amount < 500) {
    return res.status(400).json({
        success: false,
        message: 'Minimum payout amount is 500'
    });
}
```

## Protected Endpoints

### 🔐 User Endpoints

| Endpoint | Method | Middleware | Description |
|----------|--------|------------|-------------|
| `/api/transactions/withdrawal/initiate` | POST | `validateWithdrawal` | User withdrawal initiation |

### 👨‍💼 Admin Endpoints

| Endpoint | Method | Middleware | Description |
|----------|--------|------------|-------------|
| `/api/withdrawals/admin/user` | POST | `validateAdminUserWithdrawal` | Admin user withdrawal |
| `/api/withdrawals/admin/direct` | POST | `validateAdminDirectPayout` | Admin direct payout |

## Error Responses

### ❌ Below Minimum Amount

**Request**: 
```json
{
  "amount": 250
}
```

**Response**: 
```json
{
  "success": false,
  "message": "Minimum withdrawal amount is 500"
}
```

### ❌ Not Multiple of 5

**Request**: 
```json
{
  "amount": 503
}
```

**Response**: 
```json
{
  "success": false,
  "message": "Amount must be a multiple of 5"
}
```

### ✅ Valid Amount

**Request**: 
```json
{
  "amount": 1000
}
```

**Response**: 
```json
{
  "success": true,
  "data": {
    "transactionId": "SBC_...",
    "amount": 1000,
    "status": "pending"
  }
}
```

## Testing

### 🧪 Run Validation Tests

```bash
node test-minimum-withdrawal-validation.js
```

### Test Cases Covered

| Amount | Expected Result | Reason |
|--------|----------------|---------|
| 100 | ❌ Fail | Below minimum (500) |
| 250 | ❌ Fail | Below minimum (500) |
| 499 | ❌ Fail | Below minimum (500) |
| 503 | ❌ Fail | Not multiple of 5 |
| 500 | ✅ Pass | Minimum valid amount |
| 1000 | ✅ Pass | Valid amount |
| 2500 | ✅ Pass | Valid higher amount |

## Country-Specific Considerations

While the general minimum is 500 FCFA, individual payment gateways may have different minimums by country:

### CinetPay Minimums (in local currency)
- **CI** (Côte d'Ivoire): 200 XOF → **Enforced: 500 XOF**
- **SN** (Sénégal): 200 XOF → **Enforced: 500 XOF**
- **CM** (Cameroun): 500 XAF → **Enforced: 500 XAF**
- **TG** (Togo): 150 XOF → **Enforced: 500 XOF**

**Note**: Our system enforces the **higher** of 500 or the gateway minimum.

## Benefits

### 🎯 Operational Benefits
1. **Reduced Transaction Costs**: Fewer micro-transactions
2. **Improved Success Rates**: Above gateway minimums
3. **Better User Experience**: Clear, consistent limits
4. **Simplified Processing**: Standardized amounts

### 🛡️ Security Benefits
1. **Fraud Prevention**: Reduces micro-transaction abuse
2. **Rate Limiting**: Natural transaction volume control
3. **Cost Management**: Prevents fee-heavy small withdrawals

## Implementation History

### Changes Made
1. ✅ Added `validateWithdrawal` middleware to user withdrawal route
2. ✅ Added `validateAdminUserWithdrawal` middleware to admin user withdrawal route  
3. ✅ Added `validateAdminDirectPayout` middleware to admin direct payout route
4. ✅ Consistent 500 FCFA minimum across all endpoints
5. ✅ Proper error messaging for validation failures

### Files Modified
- `src/api/routes/transaction.routes.ts` - Added user validation
- `src/api/routes/withdrawal.routes.ts` - Added admin validation
- `src/api/middleware/validation.ts` - Contains validation logic (pre-existing)

## Future Considerations

### Potential Enhancements
1. **Dynamic Minimums**: Country-specific minimums via configuration
2. **User Tier Limits**: Different minimums for different user levels
3. **Time-based Rules**: Different minimums based on time of day/week
4. **Volume Discounts**: Lower minimums for high-volume users

### Monitoring
- Track rejection rates due to minimum amount validation
- Monitor user behavior changes after implementation
- Assess impact on transaction volumes and success rates

## Support

For questions about minimum withdrawal validation:
1. Check the validation middleware in `src/api/middleware/validation.ts`
2. Review route implementations in `src/api/routes/`
3. Run test script: `node test-minimum-withdrawal-validation.js`
4. Check logs for validation-related rejections 