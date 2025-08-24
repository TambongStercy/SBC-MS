# 🔄 Transaction Recovery System Guide

This guide explains how to recover your lost transactions from August 15th onwards using the comprehensive recovery system with **webhook processing** and **enhanced payment structure**.

## 🚀 Quick Start

### 1. Start Your Services
```bash
# Start all services on localhost (REQUIRED for webhook processing)
# Terminal 1: Start User Service
cd user-service
npm run dev

# Terminal 2: Start Notification Service  
cd notification-service
npm run dev

# Terminal 3: Start Payment Service
cd payment-service
npm run dev
```

### 2. Recovery Options

You have **3 ways** to recover transactions with **2 processing modes**:

#### **🔥 NEW: Webhook Processing Mode (RECOMMENDED)**
Triggers complete business logic including subscription activation, commission distribution, and notifications.

```bash
cd payment-service

# Recover CinetPay payments with FULL webhook processing
npm run recovery recover --provider cinetpay --type payment --references "trans_id1,trans_id2" --webhooks

# Recover from CSV with webhook processing
npm run recovery recover-cinetpay-csv --file "./cinetpay_payments.csv" --type payment --webhooks

# Batch recovery with webhook processing
npm run recovery recover-csv --provider cinetpay --type payment --file "./references.csv" --webhooks
```

#### **⚡ Classic Recovery Mode**
Creates payment intents only (manual processing required for subscriptions/commissions).

```bash
# Recover CinetPay withdrawals/payouts
npm run recovery recover --provider cinetpay --type payout --references "ref1,ref2,ref3"

# Recover FeexPay withdrawals/payouts  
npm run recovery recover --provider feexpay --type payout --references "ref1,ref2,ref3"

# Recover CinetPay payments/subscriptions (manual processing required)
npm run recovery recover --provider cinetpay --type payment --references "trans_id1,trans_id2"

# Recover FeexPay payments/subscriptions
npm run recovery recover --provider feexpay --type payment --references "ref1,ref2,ref3"
```

#### **Option B: Admin API Endpoints**
```bash
# Run manual recovery via API
curl -X POST http://localhost:3000/api/admin/recovery/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "provider": "cinetpay",
    "transactionType": "payout", 
    "references": ["ref1", "ref2", "ref3"]
  }'
```

#### **Option C: Admin Dashboard**
- Access your admin dashboard
- Navigate to Recovery section
- Upload transaction references
- Monitor recovery progress

## 📋 What You Need to Provide

### **For CinetPay:**
- **Withdrawals**: Use the `client_transaction_id` (your internal reference)
- **Payments**: Use the `cpm_trans_id` from CinetPay webhook/response

### **For FeexPay:**
- **Withdrawals**: Use the `reference` from FeexPay API response
- **Payments**: Use the transaction `reference` from FeexPay

## 🔍 How It Works

### **🔥 NEW: Enhanced Recovery with Webhook Processing**

#### **Webhook Processing Mode (`--webhooks`):**
1. **Recovery Script** → Creates enhanced payment intent with proper metadata
2. **Recovery Script** → Triggers `paymentService.handlePaymentCompletion()`
3. **Payment Service** → Sends webhook to user-service subscription endpoint
4. **User Service** → Activates subscription & calculates referral commissions
5. **User Service** → Calls payment-service for commission payouts (Level 1: 50%, Level 2: 25%, Level 3: 12.5%)
6. **Payment Service** → Triggers notification-service for commission emails
7. **Complete business logic execution** ✅

#### **Classic Recovery Mode:**
1. Creates payment intent with basic metadata
2. Logs "manual processing required"
3. Subscriptions and commissions need manual activation

### **🔧 Enhanced Payment Intent Structure:**

#### **Before Enhancement:**
```json
{
  "amount": 2142,
  "metadata": { "recovered": true }
}
```

#### **After Enhancement:**
```json
{
  "amount": 2070,  // ✅ Correct subscription amount (fees removed)
  "countryCode": "CM",  // ✅ Geographic tracking
  "metadata": {
    "recovered": true,
    "subscriptionType": "CLASSIQUE",  // ✅ Plan identification
    "subscriptionPlan": "classique_monthly",
    "originalProviderAmount": 2142,  // ✅ Audit trail
    "planDuration": "30days",
    "planFeatures": ["basic_access", "standard_features"],
    // ✅ Webhook metadata for service communication
    "originatingService": "user-service",
    "callbackPath": "http://user-service:3001/api/subscriptions/webhooks/payment-confirmation",
    "userId": "user_id",
    "planId": "CLASSIQUE"
  }
}
```

### **🎯 CinetPay Amount Mapping:**
- `2142 XAF` → `2070 XAF` (CLASSIQUE subscription)
- `5320 XAF` → `5140 XAF` (CIBLE subscription)  
- `3177 XAF` → `3070 XAF` (UPGRADE subscription)

### **Automatic Recovery (During User Registration):**
1. When a user registers with email/phone matching a lost transaction
2. System automatically restores all their transactions
3. Updates balances and activates subscriptions
4. Marks transactions as "restored"

### **Manual Recovery:**
1. Fetches transaction details from provider APIs
2. If user exists → immediately restores transaction
3. If user doesn't exist → saves to recovery collection for later
4. When user registers → automatically processes saved transactions

## 📊 Enhanced Monitoring & Statistics

### **Recovery Result Output:**
```bash
Recovery Results:
Total Processed: 50
Successful Recoveries: 45
Saved for Later Recovery: 3
Failed: 2
Webhook Processing Succeeded: 42  # 🔥 NEW
Webhook Processing Failed: 3      # 🔥 NEW
```

### **Statistics Commands:**
```bash
# Check recovery statistics
npm run recovery stats

# Or via API
curl http://localhost:3000/api/admin/recovery/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## 🛠️ Example Recovery Commands

### **🔥 RECOMMENDED: Full Recovery with Webhooks**
```bash
cd payment-service

# Example: Recover CinetPay payments with COMPLETE processing
npm run recovery recover \
  --provider cinetpay \
  --type payment \
  --references "cpm_trans_001,cpm_trans_002,cpm_trans_003" \
  --webhooks

# Example: Batch CSV recovery with webhooks
npm run recovery recover-cinetpay-csv \
  --file "./august_payments.csv" \
  --type payment \
  --webhooks \
  --batch-size 20 \
  --delay 1000

# Example: Small test batch with webhooks
npm run recovery recover \
  --provider cinetpay \
  --type payment \
  --references "test_trans_1,test_trans_2" \
  --webhooks
```

### **⚡ Classic Recovery (Manual Processing Required)**
```bash
# Example: Recover specific CinetPay payouts
npm run recovery recover \
  --provider cinetpay \
  --type payout \
  --references "SBC_WITHDRAW_001,SBC_WITHDRAW_002,SBC_WITHDRAW_003"

# Example: Recover FeexPay payments
npm run recovery recover \
  --provider feexpay \
  --type payment \
  --references "FX_PAY_001,FX_PAY_002"
```

## ✅ What to Do Now

### **🚀 Step 1: Start Required Services**
```bash
# CRITICAL: Start all services for webhook processing
# Terminal 1: Start User Service
cd user-service && npm run dev

# Terminal 2: Start Notification Service  
cd notification-service && npm run dev

# Terminal 3: Start Payment Service
cd payment-service && npm run dev

# Verify services are running
curl http://localhost:3001/health  # user-service
curl http://localhost:3002/health  # notification-service
curl http://localhost:3003/health  # payment-service
```

### **📋 Step 2: Gather Your Transaction References**
- **CinetPay Payments**: Collect `cpm_trans_id` values from successful payments
- **CinetPay Payouts**: Collect all `client_transaction_id` values from Aug 15 onwards
- **FeexPay Payouts**: Collect all `reference` values from Aug 15 onwards
- **Payment Transactions**: Collect transaction IDs from both providers

### **🧪 Step 3: Run Test Recovery (RECOMMENDED)**
```bash
cd payment-service

# Test with 1-2 transactions first using webhook processing
npm run recovery recover \
  --provider cinetpay \
  --type payment \
  --references "test_cpm_trans_1,test_cpm_trans_2" \
  --webhooks

# Verify results show:
# - Successful Recoveries: 2
# - Webhook Processing Succeeded: 2
# - Check user subscriptions are activated
# - Check commission distributions occurred
```

### **🚀 Step 4: Full Recovery with Webhooks**
```bash
# Recover all payment transactions with COMPLETE processing
npm run recovery recover \
  --provider cinetpay \
  --type payment \
  --references "cpm_trans_1,cpm_trans_2,cmp_trans_3,..." \
  --webhooks

# For large batches, use CSV recovery
npm run recovery recover-cinetpay-csv \
  --file "./cinetpay_payments_export.csv" \
  --type payment \
  --webhooks \
  --batch-size 50 \
  --delay 500
```

### **📊 Step 5: Monitor Results**
```bash
# Check enhanced statistics
npm run recovery stats

# Verify webhook processing results
# Expected output:
# Total Processed: X
# Successful Recoveries: X
# Webhook Processing Succeeded: X  ← Should match Successful Recoveries
# Webhook Processing Failed: 0    ← Should be 0 for healthy recovery

# Check what was saved for later recovery
curl http://localhost:3000/api/admin/recovery/records \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### **✅ Step 6: Verification Checklist**
- ✅ User subscriptions activated automatically
- ✅ Referral commissions distributed (L1: 50%, L2: 25%, L3: 12.5%)
- ✅ Commission notification emails sent
- ✅ User balances updated correctly
- ✅ Payment intents show proper amounts (2070, 5140, 3070)
- ✅ No manual subscription activation required

## 🔧 Important Notes

### **🔥 NEW: Webhook Processing Requirements**
1. **Service Dependencies**: Webhook processing requires user-service and notification-service to be running
2. **Service Validation**: Recovery script validates service connectivity before webhook processing
3. **Graceful Degradation**: If services are down, recovery continues without webhooks (manual processing required)

### **Enhanced Features**
4. **CinetPay Amount Mapping**: Automatically removes provider fees (2142→2070, 5320→5140, 3177→3070)
5. **Rich Metadata**: Payment intents include subscription type, plan features, and webhook metadata
6. **Country Code Detection**: Automatic country mapping from operator information
7. **Complete Business Logic**: Webhook mode triggers full subscription activation and commission flow

### **Recovery Behavior**
8. **Successful Transactions Only**: Only transactions marked as "successful" by providers will be recovered
9. **No Duplicate Processing**: The system prevents processing the same transaction multiple times
10. **Safe Registration**: User registration won't fail if recovery fails - it will just log the error
11. **Enhanced Withdrawals**: Include fee calculation, net/gross amounts, and operator mapping

## 🆘 Troubleshooting

### **🔥 NEW: Webhook Processing Issues**
- **"User service not accessible"**: Ensure user-service is running on port 3001
- **"Webhook Processing Failed: X"**: Check user-service logs for subscription activation errors
- **"Commission distribution failed"**: Verify payment-service internal endpoints are accessible

### **Common Issues:**
- **"Transaction not found"**: Check if the reference ID is correct
- **"User not found"**: Transaction will be saved for recovery when user registers
- **"Provider API error"**: Verify provider credentials and API endpoints
- **"Missing webhook metadata"**: Use webhook mode (`--webhooks`) for complete processing

### **Service Health Checks:**
```bash
# Verify services are accessible
curl http://localhost:3001/health  # user-service
curl http://localhost:3002/health  # notification-service
curl http://localhost:3003/health  # payment-service

# Check service logs (check the terminal windows where services are running)
# Or use npm logs if available
cd user-service && npm run logs 2>/dev/null || echo "Check user-service terminal"
cd notification-service && npm run logs 2>/dev/null || echo "Check notification-service terminal"  
cd payment-service && npm run logs 2>/dev/null || echo "Check payment-service terminal"
```

### **Recovery Status:**
- `not_restored`: Waiting for user to register
- `restored`: Successfully recovered and processed
- `webhookProcessed: true`: Complete business logic executed
- `webhookProcessed: false`: Manual processing required

### **Expected Webhook Flow Results:**
- ✅ Subscriptions activated automatically
- ✅ Commission transactions created
- ✅ Notification emails sent
- ✅ User balances updated
- ✅ Payment intents have correct amounts

## 📞 Support

If you encounter issues:
1. **Check service health** using health endpoints
2. **Verify your transaction references** are correct
3. **Test with a small batch first** using `--webhooks`
4. **Use the enhanced statistics** to monitor webhook processing
5. **Check logs** for detailed webhook processing information

### **🚀 Success Indicators:**
- `Webhook Processing Succeeded` count matches `Successful Recoveries`
- Users can see active subscriptions immediately
- Referrers receive commission notifications
- No manual subscription activation needed

The enhanced recovery system with webhook processing is ready to completely restore your lost transactions! 🎉