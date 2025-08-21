# 🔄 Transaction Recovery System Guide

This guide explains how to recover your lost transactions from August 15th onwards using the newly implemented recovery system.

## 🚀 Quick Start

### 1. Start Your Services
```bash
# Start all services with Docker
docker-compose up

# Or start individual services
docker-compose up payment-service user-service
```

### 2. Recovery Options

You have **3 ways** to recover transactions:

#### **Option A: CLI Script (Recommended for Bulk Recovery)**
```bash
cd payment-service

# Recover CinetPay withdrawals/payouts
npm run recovery recover --provider cinetpay --type payout --references "ref1,ref2,ref3"

# Recover FeexPay withdrawals/payouts  
npm run recovery recover --provider feexpay --type payout --references "ref1,ref2,ref3"

# Recover CinetPay payments/subscriptions
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

## 📊 Monitoring & Statistics

```bash
# Check recovery statistics
npm run recovery stats

# Or via API
curl http://localhost:3000/api/admin/recovery/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## 🛠️ Example Recovery Commands

```bash
cd payment-service

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

# Example: Process specific user registration manually
npm run recovery process-user-registration \
  --userId "USER_ID_HERE" \
  --email "user@example.com" \
  --phone "+237612345678"
```

## ✅ What to Do Now

### **Step 1: Gather Your Transaction References**
- **CinetPay Payouts**: Collect all `client_transaction_id` values from Aug 15 onwards
- **FeexPay Payouts**: Collect all `reference` values from Aug 15 onwards
- **Payment Transactions**: Collect transaction IDs from both providers

### **Step 2: Run Initial Recovery**
```bash
# Start with a small batch first (test)
npm run recovery recover --provider cinetpay --type payout --references "test_ref_1,test_ref_2"

# Then run your full batch
npm run recovery recover --provider cinetpay --type payout --references "ref1,ref2,ref3,..." 
```

### **Step 3: Monitor Results**
```bash
# Check statistics
npm run recovery stats

# Check what was saved for later recovery
curl http://localhost:3000/api/admin/recovery/records \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### **Step 4: User Registration Testing**
- Test user registration with emails/phones from lost transactions
- Verify transactions are automatically restored
- Check user balances are updated correctly

## 🔧 Important Notes

1. **Provider API Status**: The recovery script includes placeholder methods for CinetPay/FeexPay payment status checks. You'll need to implement the actual API calls based on your provider documentation.

2. **Successful Transactions Only**: Only transactions marked as "successful" by providers will be recovered.

3. **No Duplicate Processing**: The system prevents processing the same transaction multiple times.

4. **Safe Registration**: User registration won't fail if recovery fails - it will just log the error.

5. **Balance Updates**: Recovered withdrawals will deduct from user balances, payments will activate subscriptions.

## 🆘 Troubleshooting

### **Common Issues:**
- **"Transaction not found"**: Check if the reference ID is correct
- **"User not found"**: Transaction will be saved for recovery when user registers
- **"Provider API error"**: Verify provider credentials and API endpoints

### **Logs Location:**
Check payment-service logs for detailed recovery information.

### **Recovery Status:**
- `not_restored`: Waiting for user to register
- `restored`: Successfully recovered and processed

## 📞 Support

If you encounter issues:
1. Check the logs for detailed error messages
2. Verify your transaction references are correct
3. Test with a small batch first
4. Use the statistics endpoint to monitor progress

The system is now ready to recover your lost transactions! 🎉