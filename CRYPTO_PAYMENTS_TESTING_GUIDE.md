# Crypto Payments Testing Guide

## 🧪 **Complete Testing Checklist**

### **Prerequisites**
1. ✅ Run USD balance migration: `node user-service/src/scripts/add-usd-balance-migration.js`
2. ✅ Ensure NOWPayments API credentials are configured
3. ✅ Verify all services are running (user-service, payment-service)

### **1. Test USD Balance System**

#### **Test USD Balance Operations**
```http
# Get user USD balance
GET http://localhost:3001/api/users/internal/USER_ID/usd-balance

# Update user USD balance
POST http://localhost:3001/api/users/internal/USER_ID/usd-balance
Content-Type: application/json
{
  "amount": 10.50
}

# Convert USD to XAF
POST http://localhost:3001/api/users/internal/USER_ID/convert-usd-to-xaf
Content-Type: application/json
{
  "usdAmount": 5.0
}

# Convert XAF to USD  
POST http://localhost:3001/api/users/internal/USER_ID/convert-xaf-to-usd
Content-Type: application/json
{
  "xafAmount": 3300
}
```

**Expected Results**:
- ✅ USD balance operations work correctly
- ✅ Conversions use correct rates (660 XAF = 1 USD, 590 XAF = 1 USD for withdrawals)
- ✅ Atomic balance updates (no race conditions)

### **2. Test Crypto Payment Estimates**

#### **Test Crypto Estimates**
```http
# Test with USD (direct)
POST http://localhost:3002/api/payments/crypto-estimate
Content-Type: application/json
{
  "amount": 4.65,
  "currency": "USD",
  "cryptoCurrency": "BTC"
}

# Test with XAF (auto-conversion)
POST http://localhost:3002/api/payments/crypto-estimate
Content-Type: application/json
{
  "amount": 3070,
  "currency": "XAF",
  "cryptoCurrency": "BTC"
}

# Test different cryptocurrencies
POST http://localhost:3002/api/payments/crypto-estimate
Content-Type: application/json
{
  "amount": 10,
  "currency": "USD",
  "cryptoCurrency": "ETH"
}
```

**Expected Results**:
- ✅ XAF amounts automatically convert to USD
- ✅ Real-time crypto estimates returned
- ✅ Proper exchange rates calculated
- ✅ No "Currency XAF was not found" errors

### **3. Test Crypto Payment Creation**

#### **Create Payment Intent First**
```http
# Create subscription payment intent
POST http://localhost:3002/api/payments/intents
Content-Type: application/json
{
  "userId": "USER_ID",
  "paymentType": "SUBSCRIPTION",
  "subscriptionType": "CLASSIQUE",
  "amount": 3070,
  "currency": "XAF",
  "metadata": {
    "originatingService": "user-service",
    "callbackPath": "http://localhost:3001/api/subscriptions/internal/webhook"
  }
}
```

#### **Create Crypto Payment**
```http
# Create crypto payment
POST http://localhost:3002/api/payments/crypto-payment
Content-Type: application/json
{
  "sessionId": "SESSION_ID_FROM_ABOVE",
  "cryptoCurrency": "BTC"
}
```

**Expected Results**:
- ✅ Payment intent created successfully
- ✅ Crypto payment created with valid Bitcoin address
- ✅ Correct crypto amount calculated
- ✅ Payment status: WAITING_FOR_CRYPTO_DEPOSIT

### **4. Test Payment Status Polling**

#### **Check Payment Status**
```http
# Get payment status
GET http://localhost:3002/api/payments/status/SESSION_ID
```

**Expected Results**:
- ✅ Current payment status returned
- ✅ Status updates properly as payment progresses

### **5. Test Webhook Processing**

#### **Simulate NOWPayments Webhook**
```http
# Simulate successful payment webhook
POST http://localhost:3002/api/payments/webhooks/nowpayments
Content-Type: application/json
{
  "payment_id": "GATEWAY_PAYMENT_ID",
  "order_id": "SESSION_ID",
  "payment_status": "finished",
  "actually_paid": "0.00004128",
  "pay_currency": "BTC",
  "price_amount": 4.65,
  "price_currency": "USD"
}
```

**Expected Results**:
- ✅ Webhook processed successfully
- ✅ Payment status updated to SUCCEEDED
- ✅ USD balance credited to user
- ✅ USD commissions distributed to referrers
- ✅ Subscription activated

### **6. Test Commission Distribution**

#### **Verify Commission Transactions**
```http
# Check user transactions for commissions
GET http://localhost:3002/api/transactions/user/REFERRER_ID?currency=USD&type=DEPOSIT
```

**Expected Commission Amounts**:
- **CLASSIQUE ($4)**:
  - Level 1: $2.00 USD
  - Level 2: $1.00 USD  
  - Level 3: $0.50 USD

- **CIBLE ($10)**:
  - Level 1: $5.00 USD
  - Level 2: $2.50 USD
  - Level 3: $1.25 USD

- **UPGRADE ($6)**:
  - Level 1: $3.00 USD
  - Level 2: $1.50 USD
  - Level 3: $0.75 USD

### **7. Test Frontend Integration**

#### **Frontend Testing Steps**
1. ✅ Navigate to payment page
2. ✅ Select cryptocurrency payment method
3. ✅ Choose cryptocurrency (BTC, ETH, USDT, etc.)
4. ✅ Verify real-time estimate displays
5. ✅ Create payment and get crypto address
6. ✅ Verify QR code generation (if supported)
7. ✅ Test payment status polling

### **8. Test Error Scenarios**

#### **Test Error Handling**
```http
# Test invalid crypto currency
POST http://localhost:3002/api/payments/crypto-estimate
Content-Type: application/json
{
  "amount": 10,
  "currency": "USD", 
  "cryptoCurrency": "INVALID"
}

# Test insufficient amount
POST http://localhost:3002/api/payments/crypto-estimate
Content-Type: application/json
{
  "amount": 0.01,
  "currency": "USD",
  "cryptoCurrency": "BTC"
}
```

**Expected Results**:
- ✅ Proper error messages returned
- ✅ No system crashes
- ✅ Graceful error handling

## 🎯 **Success Criteria**

### **All Tests Pass When**:
- ✅ USD balance system works correctly
- ✅ XAF to USD conversion works automatically  
- ✅ Crypto estimates return real-time rates
- ✅ Crypto payments create valid addresses
- ✅ Webhooks process successfully
- ✅ USD commissions distribute correctly
- ✅ Frontend crypto payments work end-to-end
- ✅ Error scenarios handled gracefully

## 🚨 **Common Issues & Solutions**

### **Issue**: "Currency XAF was not found"
**Solution**: ✅ Fixed - XAF now auto-converts to USD

### **Issue**: Commission not distributed
**Solution**: Check referrer hierarchy and USD balance updates

### **Issue**: Crypto address not generated
**Solution**: Verify NOWPayments API credentials and network connectivity

### **Issue**: Frontend crypto option disabled
**Solution**: ✅ Fixed - Beta flag removed, crypto payments enabled

## 📊 **Monitoring & Logs**

### **Key Log Messages to Watch**:
- `Converted X XAF to Y USD for NOWPayments`
- `Created crypto payment intent for X USD`
- `Successfully processed crypto payment for user`
- `Paid X USD commission to referrer`

### **Database Checks**:
- Users have `usdBalance` field
- Transactions recorded in USD for crypto payments
- Payment intents have proper crypto details
- Commission transactions created correctly

## 🎉 **Ready for Production**

Once all tests pass, the crypto payment system is ready for production deployment with:
- Full USD balance management
- Seamless XAF to crypto conversion
- Automated commission distribution
- Complete audit trail
- Robust error handling

The system now supports both traditional XAF payments and modern cryptocurrency payments with a unified user experience! 🚀