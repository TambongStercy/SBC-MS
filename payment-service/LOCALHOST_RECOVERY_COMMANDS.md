# 🚀 LOCALHOST Transaction Recovery Command Guide

## **Prerequisites**

### **🔥 REQUIRED Services for Webhook Processing (LOCALHOST)**
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
# Verify all required services are running on localhost
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

## **🔥 LOCALHOST: Enhanced Recovery with Webhook Processing**

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

### **CinetPay Payouts** (6 files)
```bash
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-15.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-16.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-17.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-18.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-19.csv" --type payout
npm run recovery -- recover-cinetpay-csv --file "recovery transactions/cinetpay_daily_transfer_2025-08-20.csv" --type payout
```

### **FeexPay Payments with Webhook Processing** (RECOMMENDED)
```bash
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payin.csv" --batch-size 10 --delay 1500 --webhooks
```

### **FeexPay Payouts** (No webhook processing needed for payouts)
```bash
npm run recovery -- recover-csv --provider feexpay --type auto --file "recovery transactions/feexpay_reference_payout.csv" --batch-size 10 --delay 1500
```

---

## **Complete Automated Script - LOCALHOST**

### **🔥 RECOMMENDED: Full Recovery with Webhook Processing** (`run_recovery_webhooks_localhost.sh`)
```bash
#!/bin/bash
# Complete Transaction Recovery Script with Webhook Processing - LOCALHOST

echo "=== Starting ENHANCED Transaction Recovery with Webhook Processing (LOCALHOST) ==="
echo "Checking initial stats..."
npm run recovery -- stats

echo ""
echo "=== Verifying LOCALHOST Services ==="
echo "Checking user-service (localhost:3001)..."
curl -s http://localhost:3001/health || echo "❌ user-service not running - START IT FIRST!"
echo "Checking notification-service (localhost:3002)..."
curl -s http://localhost:3002/health || echo "❌ notification-service not running - START IT FIRST!"
echo "Checking payment-service (localhost:3003)..."
curl -s http://localhost:3003/health || echo "❌ payment-service not running - START IT FIRST!"

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
echo "=== ENHANCED RECOVERY COMPLETE (LOCALHOST) ==="
echo "✅ Subscriptions activated automatically"
echo "✅ Commission distributions completed"
echo "✅ Notification emails sent"
```

### **🔥 PowerShell Script with Webhook Processing - LOCALHOST** (`run_recovery_webhooks_localhost.ps1`)
```powershell
# Enhanced Transaction Recovery Script with Webhook Processing - LOCALHOST PowerShell
Write-Host "=== Starting ENHANCED Transaction Recovery with Webhook Processing (LOCALHOST) ===" -ForegroundColor Green
Write-Host "Checking initial stats..." -ForegroundColor Yellow
npm run recovery -- stats

Write-Host ""
Write-Host "=== Verifying LOCALHOST Services ===" -ForegroundColor Cyan
Write-Host "Checking user-service (localhost:3001)..." -ForegroundColor Yellow
try { Invoke-RestMethod http://localhost:3001/health | Out-Null; Write-Host "✅ user-service running" -ForegroundColor Green } catch { Write-Host "❌ user-service not running - START IT FIRST!" -ForegroundColor Red }
Write-Host "Checking notification-service (localhost:3002)..." -ForegroundColor Yellow
try { Invoke-RestMethod http://localhost:3002/health | Out-Null; Write-Host "✅ notification-service running" -ForegroundColor Green } catch { Write-Host "❌ notification-service not running - START IT FIRST!" -ForegroundColor Red }
Write-Host "Checking payment-service (localhost:3003)..." -ForegroundColor Yellow
try { Invoke-RestMethod http://localhost:3003/health | Out-Null; Write-Host "✅ payment-service running" -ForegroundColor Green } catch { Write-Host "❌ payment-service not running - START IT FIRST!" -ForegroundColor Red }

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
Write-Host "=== ENHANCED RECOVERY COMPLETE (LOCALHOST) ===" -ForegroundColor Green
Write-Host "✅ Subscriptions activated automatically" -ForegroundColor Cyan
Write-Host "✅ Commission distributions completed" -ForegroundColor Cyan
Write-Host "✅ Notification emails sent" -ForegroundColor Cyan
```

---

## **🎯 Quick Start - LOCALHOST**

### **Step 1: Start All Services**
```bash
# Terminal 1
cd user-service
npm run dev

# Terminal 2  
cd notification-service
npm run dev

# Terminal 3
cd payment-service
npm run dev
```

### **Step 2: Verify Services**
```bash
curl http://localhost:3001/health  # user-service
curl http://localhost:3002/health  # notification-service  
curl http://localhost:3003/health  # payment-service
```

### **Step 3: Run Recovery**
```bash
cd payment-service

# For bash/git bash:
bash run_recovery_webhooks_localhost.sh

# For PowerShell:  
.\run_recovery_webhooks_localhost.ps1
```

## **📊 Expected Results**
- Services running on localhost ports (3001, 3002, 3003)
- Webhook processing connects to localhost URLs
- Complete transaction recovery with subscription activation
- Commission distributions triggered automatically
- No Docker dependencies required

**🚀 Your localhost recovery system is ready!**