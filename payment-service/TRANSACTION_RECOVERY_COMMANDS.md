# 🚀 Complete Transaction Recovery Command Guide

## **Prerequisites**

### **🔥 REQUIRED Services for Webhook Processing**
```bash
# Terminal 1: Start User Service (CRITICAL for webhook processing)
cd user-service
npm run dev

# Terminal 2: Start Notification Service (for commission emails)
cd notification-service
npm run dev

# Terminal 3: Start Payment Service (REQUIRED for recovery script execution)
cd payment-service
npm run dev

# Terminal 4: Run Recovery Commands (in payment-service directory)
cd payment-service
# Recovery commands will be executed here
```

### **Service Health Verification**
```bash
# Verify all required services are running
curl http://localhost:3001/health  # user-service
curl http://localhost:3002/health  # notification-service
curl http://localhost:3003/health  # payment-service
```

### **Initial Statistics Check**
```bash
cd payment-service
npm run recovery -- stats
```

---

## **🔥 NEW: Enhanced Recovery with Webhook Processing**

### **CinetPay Payments with FULL Webhook Processing** (RECOMMENDED)
```bash
cd payment-service

# With complete subscription activation and commission distribution
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment --webhooks
```

### **⚡ Classic CinetPay Payments** (Manual Processing Required)
```bash
cd payment-service

npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment
```

### **CinetPay Payouts** (6 files)
```bash
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout
```

---

## **FeexPay CSV Recovery Commands**

### **🔥 FeexPay Payments with Webhook Processing** (RECOMMENDED)
```bash
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500 --webhooks
```

### **⚡ FeexPay Payments** (Classic Mode)
```bash
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500
```

### **FeexPay Payouts** (No webhook processing needed for payouts)
```bash
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500
```

---

## **Complete Automated Scripts**

### **🔥 RECOMMENDED: Full Recovery with Webhook Processing** (`run_recovery_webhooks.sh`)
```bash
#!/bin/bash
# Complete Transaction Recovery Script with Webhook Processing

cd payment-service

echo "=== Starting ENHANCED Transaction Recovery with Webhook Processing ==="
echo "Checking initial stats..."
npm run recovery -- stats

echo ""
echo "=== PHASE 1: CinetPay Payments with FULL WEBHOOK PROCESSING ==="
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment --webhooks

echo ""
echo "=== PHASE 2: CinetPay Payouts ==="
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout

echo ""
echo "=== PHASE 3: FeexPay Payments with WEBHOOK PROCESSING ==="
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500 --webhooks

echo ""
echo "=== PHASE 4: FeexPay Payouts ==="
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500

echo ""
echo "=== FINAL STATISTICS ==="
npm run recovery -- stats

echo ""
echo "=== ENHANCED RECOVERY COMPLETE ==="
echo "✅ Subscriptions activated automatically"
echo "✅ Commission distributions completed"
echo "✅ Notification emails sent"
```

### **⚡ Classic Recovery Script** (`run_recovery_classic.sh`)
```bash
#!/bin/bash
# Classic Transaction Recovery Script (Manual Processing Required)

cd payment-service

echo "=== Starting Classic Transaction Recovery ==="
echo "Checking initial stats..."
npm run recovery -- stats

echo ""
echo "=== PHASE 1: CinetPay Payments ==="
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment

echo ""
echo "=== PHASE 2: CinetPay Payouts ==="
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout

echo ""
echo "=== PHASE 3: FeexPay Payments ==="
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500

echo ""
echo "=== PHASE 4: FeexPay Payouts ==="
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500

echo ""
echo "=== FINAL STATISTICS ==="
npm run recovery -- stats

echo ""
echo "=== CLASSIC RECOVERY COMPLETE ==="
echo "⚠️  Manual subscription activation required"
echo "⚠️  Manual commission distribution required"
```

### **🔥 PowerShell Script with Webhook Processing** (`run_recovery_webhooks.ps1`)
```powershell
# Enhanced Transaction Recovery Script with Webhook Processing - Windows PowerShell
Set-Location payment-service

Write-Host "=== Starting ENHANCED Transaction Recovery with Webhook Processing ===" -ForegroundColor Green
Write-Host "Checking initial stats..." -ForegroundColor Yellow
npm run recovery -- stats

Write-Host ""
Write-Host "=== PHASE 1: CinetPay Payments with FULL WEBHOOK PROCESSING ===" -ForegroundColor Green
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment --webhooks
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment --webhooks

Write-Host ""
Write-Host "=== PHASE 2: CinetPay Payouts ===" -ForegroundColor Green
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout

Write-Host ""
Write-Host "=== PHASE 3: FeexPay Payments with WEBHOOK PROCESSING ===" -ForegroundColor Green
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500 --webhooks

Write-Host ""
Write-Host "=== PHASE 4: FeexPay Payouts ===" -ForegroundColor Green
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500

Write-Host ""
Write-Host "=== FINAL STATISTICS ===" -ForegroundColor Green
npm run recovery -- stats

Write-Host ""
Write-Host "=== ENHANCED RECOVERY COMPLETE ===" -ForegroundColor Green
Write-Host "✅ Subscriptions activated automatically" -ForegroundColor Cyan
Write-Host "✅ Commission distributions completed" -ForegroundColor Cyan
Write-Host "✅ Notification emails sent" -ForegroundColor Cyan
```

### **⚡ PowerShell Script Classic** (`run_recovery_classic.ps1`)
```powershell
# Classic Transaction Recovery Script - Windows PowerShell
Set-Location payment-service

Write-Host "=== Starting Classic Transaction Recovery ===" -ForegroundColor Green
Write-Host "Checking initial stats..." -ForegroundColor Yellow
npm run recovery -- stats

Write-Host ""
Write-Host "=== PHASE 1: CinetPay Payments ===" -ForegroundColor Green
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-15.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-16.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-17.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-18.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-19.csv" --type payment
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transaction_2025-08-20.csv" --type payment

Write-Host ""
Write-Host "=== PHASE 2: CinetPay Payouts ===" -ForegroundColor Green
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout

Write-Host ""
Write-Host "=== PHASE 3: FeexPay Payments ===" -ForegroundColor Green
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500

Write-Host ""
Write-Host "=== PHASE 4: FeexPay Payouts ===" -ForegroundColor Green
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500

Write-Host ""
Write-Host "=== FINAL STATISTICS ===" -ForegroundColor Green
npm run recovery -- stats

Write-Host ""
Write-Host "=== CLASSIC RECOVERY COMPLETE ===" -ForegroundColor Green
Write-Host "⚠️  Manual subscription activation required" -ForegroundColor Yellow
Write-Host "⚠️  Manual commission distribution required" -ForegroundColor Yellow
```

---

## **🔍 Enhanced Progress Monitoring Commands**

### **Check Enhanced Statistics Between Phases**
```bash
npm run recovery -- stats

# Expected output with webhook processing:
# Recovery Statistics:
# Total Records: X
# Not Restored: X  
# Restored: X
# Webhook Processing Succeeded: X  ← Should match restored count
# Webhook Processing Failed: 0     ← Should be 0 for healthy recovery
```

### **🔥 Verify Required Services for Webhook Processing**
```bash
# Check if ALL required services are running
curl http://localhost:3001/health  # user-service (CRITICAL)
curl http://localhost:3002/health  # notification-service (for emails)  
curl http://localhost:3003/health  # payment-service

# Test webhook connectivity during recovery
npm run recovery -- process-user-registration --help
```

### **🎯 Test Webhook Processing with Sample Data**
```bash
# Test small batch first with webhook processing
npm run recovery -- recover \
  --provider cinetpay \
  --type payment \
  --references "test_trans_1,test_trans_2" \
  --webhooks

# Expected results:
# - Webhook Processing Succeeded: 2
# - User subscriptions activated immediately
# - Commission distributions triggered
```

### **MongoDB Recovery Collection Analysis**
```bash
mongosh
use sbc_payment_dev

# Count recovery records
db.recoverUserTransactions.countDocuments()

# Check webhook processing status
db.recoverUserTransactions.find(
  { "webhookProcessed": true }
).count()

# View recent recovery details
db.recoverUserTransactions.find().sort({createdAt: -1}).limit(5).pretty()

# Check payment intents with webhook metadata
db.paymentintents.find({
  "metadata.originatingService": "user-service",
  "metadata.recovered": true
}).limit(3).pretty()

exit
```

---

## **📊 Enhanced Summary**

### **🔥 NEW: Webhook Processing Capabilities**
- **Complete subscription activation** - No manual processing required
- **Automatic commission distribution** - L1: 50%, L2: 25%, L3: 12.5%
- **Commission notification emails** - Sent automatically
- **Enhanced payment intent metadata** - Subscription types, plans, country codes
- **CinetPay amount mapping** - 2142→2070, 5320→5140, 3177→3070

### **File Count**
- **CinetPay Payments**: 6 files (2025-08-15 to 2025-08-20) 
- **CinetPay Payouts**: 6 files (2025-08-15 to 2025-08-20) 
- **FeexPay Payments**: 1 reference file
- **FeexPay Payouts**: 1 reference file

### **Total Commands**
- **🔥 NEW: 16 enhanced webhook recovery commands** 
- **16 classic recovery commands** (for fallback)
- **~45-60 minutes** estimated completion time
- **Thousands of transactions** expected to be recovered

### **🚀 Execution Options**
1. **🔥 RECOMMENDED: Enhanced Webhook Scripts**:
   - Bash: `chmod +x run_recovery_webhooks.sh && ./run_recovery_webhooks.sh`
   - PowerShell: `.\run_recovery_webhooks.ps1`

2. **⚡ Classic Scripts** (Manual processing required):
   - Bash: `chmod +x run_recovery_classic.sh && ./run_recovery_classic.sh`
   - PowerShell: `.\run_recovery_classic.ps1`

3. **Manual**: Copy/paste commands one by one with `--webhooks` flag

### **🎯 Expected Results with Webhook Processing**
- **Immediate subscription activation** ✅ (No manual intervention)
- **Automatic commission payouts** ✅ (L1: 50%, L2: 25%, L3: 12.5%)
- **Commission notification emails sent** ✅ (Automatic)
- **User balances updated correctly** ✅ (Real-time)
- **Enhanced audit trail** ✅ (Complete metadata)
- **Original transaction dates preserved** ✅ (Historical accuracy)
- **Comprehensive user matching** ✅ (Phone, email, momo numbers)

### **🔧 Service-to-Service Interactions**
- **Payment Service** → **User Service**: Subscription webhook (`/api/subscriptions/webhooks/payment-confirmation`)
- **User Service** → **Payment Service**: Commission distribution endpoints
- **Payment Service** → **Notification Service**: Commission email triggers
- **Recovery Script** → **All Services**: Health checks and validation

🚀 **Ready for COMPLETE enhanced transaction recovery with full business logic automation!**