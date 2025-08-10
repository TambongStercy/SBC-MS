# FeexPay Withdrawal Management

## Overview

This document explains how to manage FeexPay withdrawals in the payment service. FeexPay withdrawals have been secured with a configuration-based blocking mechanism to prevent unauthorized withdrawals.

## Security Implementation

### 1. Configuration-Based Control

FeexPay withdrawals are controlled via the `FEEXPAY_WITHDRAWALS_ENABLED` environment variable:

```bash
# Disable FeexPay withdrawals (default and recommended for security)
FEEXPAY_WITHDRAWALS_ENABLED=false

# Enable FeexPay withdrawals (only when safe to do so)
FEEXPAY_WITHDRAWALS_ENABLED=true
```

### 2. Blocking Points

The system blocks FeexPay withdrawals at multiple points:

- **User-initiated withdrawals** (`initiateWithdrawal`)
- **Admin user withdrawals** (`adminInitiateUserWithdrawal`)
- **Admin direct payouts** (`adminInitiateDirectPayout`)

### 3. Error Handling

When FeexPay withdrawals are blocked, users receive a user-friendly error message:
```
"Withdrawals are temporarily unavailable for your region. Please contact support for assistance."
```

## Monitoring and Tracking

### 1. Blocked Attempt Tracking

All blocked withdrawal attempts are tracked with the following information:
- User ID
- Amount attempted
- Country code
- Timestamp
- Reason for blocking
- Admin ID (for admin-initiated attempts)

### 2. Admin Endpoints

#### Get Withdrawal Service Status
```
GET /api/admin/withdrawals/service-status
```

Response includes:
- FeexPay withdrawal status (enabled/disabled)
- CinetPay status (always enabled)
- Blocked attempts statistics
- Last checked timestamp

#### Get Recent Blocked Attempts
```
GET /api/admin/withdrawals/blocked-attempts?limit=50
```

Response includes:
- List of recent blocked attempts
- Attempt details (user, amount, country, reason, timestamp)
- Total count

### 3. Logging

All blocked attempts are logged with the following format:
```
🚫 BLOCKED WITHDRAWAL ATTEMPT - userId: xxx, amount: xxx, countryCode: xxx, reason: xxx
```

## How to Enable/Disable FeexPay Withdrawals

### To Disable (Recommended for Security)

1. Set environment variable:
   ```bash
   FEEXPAY_WITHDRAWALS_ENABLED=false
   ```

2. Restart the payment service

3. Verify status via admin endpoint:
   ```bash
   curl -X GET /api/admin/withdrawals/service-status
   ```

### To Enable (Only When Safe)

1. Ensure all security measures are in place
2. Set environment variable:
   ```bash
  