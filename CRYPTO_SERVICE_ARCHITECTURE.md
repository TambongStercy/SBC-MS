# Crypto Payment Service Architecture

## 🏗️ **Clean Service Structure**

After consolidation, we now have a clean, non-redundant architecture:

### **1. `nowpayments.service.ts`** (API Layer)
**Purpose**: Low-level NOWPayments API wrapper
**Responsibilities**:
- ✅ Direct API communication with NOWPayments
- ✅ Request/response mapping
- ✅ Currency conversion (XAF → USD for API compatibility)
- ✅ Error handling and retries
- ✅ Webhook signature verification
- ✅ Status mapping between NOWPayments and internal statuses

**Key Methods**:
- `getEstimatePrice()` - Get crypto estimates
- `createPayment()` - Create crypto payments
- `getPaymentStatus()` - Check payment status
- `createPayout()` - Create crypto payouts
- `verifyWebhookSignature()` - Verify webhooks

### **2. `payment.service.ts`** (Business Logic Layer)
**Purpose**: High-level payment orchestration and business logic
**Responsibilities**:
- ✅ Payment intent management
- ✅ Crypto payment creation with USD conversion
- ✅ Webhook processing and payment completion
- ✅ USD commission distribution for crypto payments
- ✅ Integration with user service and transaction repository
- ✅ Subscription activation coordination

**Key Crypto Methods**:
- `getCryptoEstimate()` - Get estimates with currency conversion
- `createCryptoPayment()` - Create crypto payments with proper USD handling
- `handleNowPaymentsWebhook()` - Process crypto payment webhooks
- `handleSuccessfulCryptoPayment()` - Handle successful payments
- `distributeCryptoCommissions()` - Distribute USD commissions
- `payCryptoCommission()` - Pay individual commissions

## 🔄 **Payment Flow**

### **Crypto Payment Creation**:
1. **Frontend** → `POST /api/payments/crypto-payment`
2. **PaymentController** → `payment.service.createCryptoPayment()`
3. **PaymentService** → `nowpayments.service.getEstimatePrice()` (converts XAF→USD)
4. **PaymentService** → `nowpayments.service.createPayment()` (creates with USD)
5. **Response** → Crypto address and amount returned to frontend

### **Crypto Payment Completion**:
1. **NOWPayments** → Webhook to `/api/payments/webhooks/nowpayments`
2. **PaymentController** → `payment.service.handleNowPaymentsWebhook()`
3. **PaymentService** → `handleSuccessfulCryptoPayment()`
4. **PaymentService** → Updates USD balance + distributes USD commissions
5. **PaymentService** → Notifies originating service (subscription activation)

## 💰 **Commission Distribution**

### **USD Commission Structure**:
- **CLASSIQUE**: $4 → Commissions: $2, $1, $0.5
- **CIBLE**: $10 → Commissions: $5, $2.5, $1.25  
- **UPGRADE**: $6 → Commissions: $3, $1.5, $0.75

### **Commission Flow**:
1. Crypto payment succeeds → USD deposited to buyer
2. Get referrer hierarchy from user service
3. Calculate commission amounts based on subscription type
4. Create USD transaction records for each referrer
5. Update referrer USD balances via user service client

## 🔧 **Configuration**

### **Currency Conversion** (`crypto-pricing.ts`):
- XAF to USD: 1 USD = 660 XAF (for payments)
- USD to XAF: 1 USD = 590 XAF (for withdrawals)

### **NOWPayments Integration**:
- Automatic XAF→USD conversion for API compatibility
- Support for all major cryptocurrencies (BTC, ETH, USDT, etc.)
- Proper error handling for unsupported currencies
- Webhook signature verification for security

## ✅ **Benefits of This Architecture**

1. **Single Responsibility**: Each service has a clear, distinct purpose
2. **No Duplication**: Eliminated redundant crypto payment logic
3. **Maintainable**: Clear separation between API layer and business logic
4. **Scalable**: Easy to add new crypto providers or payment methods
5. **Testable**: Each layer can be tested independently

## 🚀 **Usage Examples**

### **Get Crypto Estimate**:
```typescript
// Via PaymentService (handles XAF conversion)
const estimate = await paymentService.getCryptoEstimate(3070, 'XAF', 'BTC');
// Returns: { payAmount: 0.00004128, exchangeRate: 8.87e-9, networkFee: 0 }
```

### **Create Crypto Payment**:
```typescript
// Via PaymentService (full business logic)
const result = await paymentService.createCryptoPayment(sessionId, 'BTC');
// Returns: { success: true, data: { cryptoAddress, payAmount, payCurrency } }
```

This clean architecture eliminates confusion and provides a clear path for crypto payment functionality! 🎯