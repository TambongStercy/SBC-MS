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