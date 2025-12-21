# Database Analysis Scripts

This directory contains utility scripts for analyzing and managing the SBC database.

## Find Suspicious Users Script

**File:** `find-suspicious-users.js`

### Purpose

Identifies users whose financial activity (balances and transactions) appears disproportionate to their referral activity. This can help detect:
- Potential fraud or abuse
- Account anomalies
- Users who may need investigation
- Testing accounts that weren't properly flagged

### How It Works

The script:
1. Connects to both User Service and Payment Service databases
2. Finds users with significant balances (≥50,000 XAF by default)
3. Calculates transaction volumes from completed transactions
4. Compares financial metrics against referral counts
5. Flags users who exceed suspicious thresholds
6. Generates a detailed report with rankings and flags

### Suspicious Activity Indicators

Users are flagged if they meet any of these criteria:

1. **High Balance, Few Referrals**: Balance ≥50,000 XAF with ≤10 referrals
2. **High Balance Per Referral Ratio**: ≥10,000 XAF per referral
3. **High Transaction Volume Per Referral**: ≥20,000 XAF per referral
4. **Many Transactions, Few Referrals**: ≥50 transactions with ≤5 referrals

### Configuration

You can adjust thresholds by modifying the `THRESHOLDS` object in the script:

```javascript
const THRESHOLDS = {
    MIN_BALANCE: 50000,                          // Minimum balance to consider (XAF)
    MIN_TRANSACTION_VOLUME: 100000,              // Minimum transaction volume (XAF)
    MAX_REFERRALS_FOR_HIGH_BALANCE: 10,          // Max referrals for high balance
    SUSPICIOUS_BALANCE_PER_REFERRAL: 10000,      // XAF per referral threshold
    SUSPICIOUS_TRANSACTION_PER_REFERRAL: 20000   // Transaction volume per referral
};
```

### Usage

#### Prerequisites

```bash
# Ensure you're in the root directory
cd /path/to/SBC_MS_backend

# Install dependencies (mongoose should already be installed)
npm install
```

#### Environment Variables

Create or update your `.env` file with database connection strings:

```env
USER_DB_URI=mongodb://localhost:27017/sbc_user_dev
PAYMENT_DB_URI=mongodb://localhost:27017/sbc_payment_dev
```

Or use production databases:

```env
USER_DB_URI=mongodb://user:pass@host:27017/sbc_user_prod
PAYMENT_DB_URI=mongodb://user:pass@host:27017/sbc_payment_prod
```

#### Run the Script

```bash
# From project root
node scripts/find-suspicious-users.js
```

### Output

The script provides two types of output:

#### 1. Console Output

Displays a formatted report with:
- Total number of suspicious users
- Detailed information for each user (sorted by suspicion level)
- Financial data (balances, transactions)
- Referral data
- Calculated ratios
- Warning flags
- Summary statistics

Example:
```
═══════════════════════════════════════════════════════════════
🚨 SUSPICIOUS USERS REPORT
═══════════════════════════════════════════════════════════════

Total Suspicious Users: 5

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#1 - John Doe
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User ID:           507f1f77bcf86cd799439011
Email:             john@example.com
Phone:             +237670000000
Role:              user

💰 FINANCIAL DATA:
   Balance (XAF):           125000.00 XAF
   Balance (USD):           $50.00
   Total Balance (XAF):     155000.00 XAF
   Transaction Count:       45
   Transaction Volume:      380000.00 XAF

👥 REFERRAL DATA:
   Total Referrals:         2

📊 RATIOS (SUSPICIOUS IF HIGH):
   Balance/Referral:        77500.00 XAF/referral
   Transactions/Referral:   190000.00 XAF/referral

🚩 FLAGS:
   ⚠️ HIGH BALANCE - FEW REFERRALS
   🚨 VERY HIGH BALANCE PER REFERRAL
   🚨 VERY HIGH TRANSACTIONS PER REFERRAL
   ⚠️ MANY TRANSACTIONS - FEW REFERRALS
```

#### 2. JSON Export

A detailed JSON report is saved to `suspicious-users-report.json` containing:
- Timestamp of analysis
- Thresholds used
- Complete user data
- Summary statistics

This file can be:
- Imported into Excel/Google Sheets for further analysis
- Used by other scripts for automated processing
- Archived for historical tracking

### Understanding the Flags

- **⚠️ HIGH BALANCE - NO REFERRALS**: User has significant balance but zero referrals (most suspicious)
- **⚠️ HIGH BALANCE - FEW REFERRALS**: User has high balance with very few referrals
- **🚨 VERY HIGH BALANCE PER REFERRAL**: Balance per referral ratio is extremely high (2x threshold)
- **🚨 VERY HIGH TRANSACTIONS PER REFERRAL**: Transaction volume per referral is extremely high (2x threshold)
- **⚠️ MANY TRANSACTIONS - FEW REFERRALS**: High transaction activity with minimal referral activity

### Interpreting Results

#### Low Risk
- Users with high ratios but recent signup dates (legitimate new users)
- Users with tester/admin roles
- Users with consistent activity patterns

#### Medium Risk
- Users with moderately high ratios
- Single flag violations
- Older accounts with gradual balance growth

#### High Risk
- Multiple 🚨 (red alert) flags
- Zero referrals with high balances
- Large transaction volumes with minimal referrals
- Very high ratios (10x+ threshold)

### Next Steps After Analysis

1. **Review flagged users manually**
   - Check their transaction history in detail
   - Look for patterns (same amounts, timing, etc.)
   - Verify referral links were shared properly

2. **Cross-reference with other data**
   - Compare with partner transaction records
   - Check for related accounts (same IP, phone, etc.)
   - Review withdrawal history

3. **Take appropriate action**
   - Contact users for verification
   - Apply temporary holds if needed
   - Update user roles (add tester flag if legitimate)
   - Report serious cases for further investigation

### Troubleshooting

#### Connection Errors
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
**Solution**: Ensure MongoDB is running and connection strings are correct

#### Permission Errors
```
Error: not authorized on database to execute command
```
**Solution**: Check that database user has read permissions on both databases

#### Memory Issues (Large Databases)
If processing times out or runs out of memory:
1. Increase `MIN_BALANCE` threshold to reduce dataset
2. Add pagination to user queries
3. Process in batches

### Safety Notes

- ✅ This script is **READ-ONLY** - it does not modify any data
- ✅ Safe to run on production databases
- ✅ Can be run multiple times without side effects
- ⚠️ May take several minutes on large databases
- ⚠️ Generated JSON files may contain sensitive user data - handle securely

### Scheduling (Optional)

To run this analysis automatically:

```bash
# Add to crontab (run weekly on Mondays at 2 AM)
0 2 * * 1 cd /path/to/SBC_MS_backend && node scripts/find-suspicious-users.js >> logs/suspicious-users.log 2>&1
```

### Example Use Cases

1. **Weekly Security Audit**
   - Run every Monday to identify new suspicious accounts
   - Review flagged accounts before withdrawal approvals

2. **Pre-Withdrawal Verification**
   - Run before processing large withdrawal batches
   - Flag users for manual review

3. **Partner Program Integrity**
   - Identify potential referral fraud
   - Ensure partner commissions are legitimate

4. **Account Cleanup**
   - Find test accounts that weren't flagged properly
   - Identify accounts for role updates

---

## Balance Inconsistency Analysis Script

**File:** `analyze-balance-inconsistencies.js`

### Purpose

Identifies users whose actual lifetime earnings don't match their expected earnings based on referral commissions. This helps detect:
- Unauthorized balance credits
- Missing referral commissions
- Untracked withdrawals
- System calculation errors
- Manual adjustments that need documentation

### How It Works

The script follows this logic:

1. **Find Target Users:**
   - Gets all users with active CLASSIQUE or CIBLE subscriptions
   - Filters to only those with at least 1 completed XAF transaction
   - Analyzes the intersection of these two groups

2. **Calculate Expected Earnings:**
   - Gets all referrals for each user
   - Checks if each referred user is subscribed
   - Calculates commission based on referral level:
     - Level 1: 1,000 XAF
     - Level 2: 500 XAF
     - Level 3: 250 XAF
   - Sums up all commissions from subscribed referrals

3. **Calculate Actual Earnings:**
   - Current XAF balance
   - Plus: Sum of all completed withdrawal amounts
   - Equals: Total lifetime earnings

4. **Compare & Flag:**
   - Calculates discrepancy (Actual - Expected)
   - Flags users with discrepancy >= 5,000 XAF
   - Classifies as OVER_EARNED or UNDER_EARNED
   - Assigns severity: LOW, MEDIUM, or HIGH

### Discrepancy Types

#### OVER_EARNED (Actual > Expected)
User has more money than referral commissions alone would provide.

**Possible legitimate reasons:**
- Manual bonus credits from admin
- Promotional rewards
- Competition winnings
- Partner program earnings not tracked in referrals

**Suspicious scenarios:**
- Unauthorized balance manipulation
- Exploited system vulnerabilities
- Admin account abuse

#### UNDER_EARNED (Actual < Expected)
User has less money than they should have earned from referrals.

**Possible legitimate reasons:**
- Transfer to other users
- Fees or penalties
- Activation balance transfers (BEAC compliance)

**Suspicious scenarios:**
- Untracked withdrawals
- System calculation errors
- Missing referral commission payments

### Configuration

Adjust thresholds in the script:

```javascript
// Referral commission rates (in XAF)
const REFERRAL_COMMISSIONS = {
    1: 1000,  // Level 1
    2: 500,   // Level 2
    3: 250    // Level 3
};

// Minimum discrepancy to flag (in XAF)
const DISCREPANCY_THRESHOLD = 5000;
```

### Usage

```bash
# From project root
node scripts/analyze-balance-inconsistencies.js
```

### Output

#### Console Report

Shows detailed breakdown for each flagged user:
- User information (ID, name, email, phone, role)
- Referral statistics (total, subscribed, by level)
- Financial data (balance, withdrawals)
- Earnings comparison (expected vs actual)
- Discrepancy amount and percentage
- Severity classification

Example:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#1 - John Doe [HIGH SEVERITY]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User ID:           507f1f77bcf86cd799439011
Email:             john@example.com

👥 REFERRAL DATA:
   Total Referrals:       15
   Subscribed Referrals:  12
   By Level:              L1=10, L2=3, L3=2

💰 FINANCIAL DATA:
   Current Balance:       25000.00 XAF
   Total Withdrawals:     50000.00 XAF (8 txns)

📊 EARNINGS ANALYSIS:
   Expected Earnings:     11500.00 XAF (from referrals)
   Actual Earnings:       75000.00 XAF (balance + withdrawals)
   Discrepancy:           63500.00 XAF (552.17%)
   Classification:        ⚠️ OVER-EARNED

🚩 This user has 63500.00 XAF MORE than expected from referrals.
   Possible reasons: Manual credits, bonuses, or other income sources.
```

#### JSON Export

File: `balance-inconsistencies-report.json`

Contains:
- Generation timestamp
- Configuration used
- Summary statistics
- Complete inconsistency data for all flagged users

### Interpreting Results

#### High Severity OVER_EARNED
- **Action:** Investigate immediately
- **Check:** Admin transaction logs, manual credit history
- **Verify:** Legitimate bonuses or promotions
- **If suspicious:** Apply temporary hold, contact user

#### Medium Severity OVER_EARNED
- **Action:** Review during routine audit
- **Check:** Recent promotional campaigns
- **Document:** Reason for extra earnings

#### UNDER_EARNED (Any Severity)
- **Action:** Verify referral commission payments
- **Check:** System logs for errors
- **Investigate:** Untracked fees or penalties
- **Fix:** Credit missing commissions if legitimate

### Limitations

1. **Currency:** Only analyzes XAF balances and transactions
2. **Timing:** Snapshot analysis - doesn't track historical changes
3. **Scope:** Doesn't include:
   - USD balance or transactions
   - Activation balance transfers
   - Non-withdrawal transaction types
   - Partner program earnings (if separate from referrals)
4. **Referral Status:** Checks current subscription status, not historical

### Troubleshooting

#### No Inconsistencies Found
This is generally good! If you expect to find issues:
- Lower `DISCREPANCY_THRESHOLD` to 1000 or 2000 XAF
- Check if users actually have subscriptions
- Verify transaction data exists

#### Many False Positives
If legitimate bonuses cause many flags:
- Increase `DISCREPANCY_THRESHOLD`
- Document legitimate bonus programs
- Track manual credits separately

#### Performance Issues
For large databases:
- Script processes ~10 users per second
- Add progress bar (already included)
- Consider batching or pagination

### Safety Notes

- ✅ Read-only - does not modify data
- ✅ Safe for production databases
- ⚠️ May take 5-10 minutes on large databases
- ⚠️ Exported JSON contains sensitive user data

### Example Use Cases

1. **Monthly Audit:**
   ```bash
   # Run on first of month
   node scripts/analyze-balance-inconsistencies.js
   # Review flagged accounts
   # Document legitimate discrepancies
   ```

2. **Pre-Withdrawal Review:**
   ```bash
   # Before processing large withdrawals
   node scripts/analyze-balance-inconsistencies.js
   # Flag suspicious users for manual review
   ```

3. **System Health Check:**
   ```bash
   # After referral system changes
   node scripts/analyze-balance-inconsistencies.js
   # Verify commissions are calculating correctly
   ```

---

## Adding New Scripts

When adding new analysis scripts to this directory:

1. Follow the naming convention: `verb-noun.js` (e.g., `analyze-transactions.js`)
2. Include detailed comments and usage instructions
3. Make scripts read-only unless explicitly needed
4. Add safety checks and confirmation prompts for destructive operations
5. Export results to both console and JSON
6. Update this README with script documentation
