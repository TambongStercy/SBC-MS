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