# Suspicious Users Detection Script

## Overview

This script identifies potentially fraudulent user accounts by analyzing their withdrawal patterns, referral activity, and subscription status. It uses a simplified calculation method to detect accounts with unexplained funds.

**Last Updated**: 2025-10-28

---

## Detection Logic (NEW)

### Scope
- **Only analyzes users with at least ONE withdrawal transaction**
- Users without any withdrawals are not checked

### Calculation Formula

**Expected Earnings** = (Active Direct Referrals × 1,000 XAF) + (Active Indirect Referrals × 375 XAF)

**Actual Money** = Total Withdrawals + Current Balance

**Discrepancy** = Actual Money - Expected Earnings

### Key Terms

**Active Referral**: A referral who has an active CLASSIQUE or CIBLE subscription
- Status = ACTIVE
- Subscription Type = CLASSIQUE or CIBLE (not RELANCE)
- End Date > Current Date

**Direct Referrals**: Level 1 referrals (directly referred by the user)

**Indirect Referrals**: Level 2 + Level 3 referrals combined
- Level 2: Referrals made by direct referrals
- Level 3: Referrals made by level 2 referrals

**Why 375 XAF for indirect?**
- Average of Level 2 (500 XAF) and Level 3 (250 XAF)
- Simplified calculation: (500 + 250) / 2 = 375

---

## Suspicion Levels

### 🔴 CRITICAL
Users flagged as CRITICAL have **withdrawals but NO active subscription**.

**Criteria**:
- Has made at least 1 withdrawal
- Does NOT have an active CLASSIQUE or CIBLE subscription

**Why Critical**: Users should not be able to withdraw without an active subscription. This indicates either:
- Account manipulation
- Expired subscription that wasn't properly enforced
- Fraudulent activity

### 🟠 HIGH
Users with significant unexplained funds or suspicious patterns.

**Criteria (any of the following)**:
1. **Excess Funds**: Discrepancy > 20,000 XAF
2. **Money but Zero Referrals**: Has > 10,000 XAF actual money but ZERO active referrals

### 🟡 MEDIUM
Users with moderate discrepancies or unusual patterns.

**Criteria (any of the following)**:
1. **Large Percentage Discrepancy**: Discrepancy > 100% of expected earnings
2. **Multiple Withdrawals**: ≥3 withdrawals but expected earnings < 5,000 XAF

---

## Running the Script

### Command

```bash
cd user-service
npm run find:suspicious
```

### Output

- Console report with statistics and detailed list
- CSV file in `user-service/reports/suspicious-users-YYYY-MM-DDTHH-MM-SS.csv`

---

## Changelog

### Version 2.0 (2025-10-28)
- **Changed scope**: Only analyze users with withdrawals (not all users with balance)
- **Simplified calculation**: Direct × 1000 + Indirect × 375 (no CLASSIQUE/CIBLE distinction)
- **Added CRITICAL level**: Users with withdrawals but no active subscription
- **Added actual money tracking**: Total withdrawals + current balance
- **Improved performance**: Query only withdrawal users instead of all users

### Version 1.0 (Previous)
- Analyzed all users with balance > 5,000 XAF
- Used detailed CLASSIQUE/CIBLE commission breakdown
