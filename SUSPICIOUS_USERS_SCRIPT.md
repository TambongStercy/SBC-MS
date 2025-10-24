# Suspicious Users Detection Script

## Overview

This script identifies potentially suspicious user accounts that have high balances but minimal referral activity. This pattern may indicate fraudulent accounts or accounts that have acquired funds through illegitimate means.

## Detection Criteria

The script searches for users matching **ALL** of the following conditions:

1. **Balance > 5,000 XAF**
2. **Total Referrals < 10** (direct + indirect)

## Why This Matters

In a referral-based platform, legitimate users typically:
- Build their balance through referrals and network growth
- Have multiple direct and indirect referrals
- Show organic growth patterns

Suspicious accounts may:
- Have high balances with no/minimal referral activity
- Be test accounts that were improperly funded
- Be fraudulent accounts exploiting payment system vulnerabilities
- Have been funded through payment manipulation

## Usage

### Run the Script

```bash
cd user-service
npm run find:suspicious
```

### Output

The script generates two outputs:

#### 1. Console Report

A detailed console report showing:
- Total number of suspicious users found
- Statistics (total balance, average, min, max)
- Detailed table with user information
- Breakdown by referral count
- High-risk users (zero referrals)

Example output:
```
===========================================
SUSPICIOUS USERS REPORT
===========================================
Search Criteria:
  - Balance > 5000 XAF
  - Total Referrals < 10

Total Suspicious Users Found: 15
===========================================

STATISTICS:
  Total Balance: 125,430 XAF
  Average Balance: 8,362 XAF
  Max Balance: 25,000 XAF
  Min Balance: 5,120 XAF

DETAILED LIST:
────────────────────────────────────────────────────────────────────────────────
Name                     Email                          Phone          Balance        Direct  Indirect  Total   Created
────────────────────────────────────────────────────────────────────────────────
John Doe                 john@example.com               237650000000   25,000 XAF     2       3         5       24 janv. 2025, 10:00
Jane Smith               jane@example.com               237651000000   15,500 XAF     0       0         0       23 janv. 2025, 14:30
...
────────────────────────────────────────────────────────────────────────────────

BREAKDOWN BY REFERRAL COUNT:
  0 referrals: 5 users (65,000 XAF)
  1 referrals: 3 users (22,500 XAF)
  2 referrals: 4 users (25,430 XAF)
  5 referrals: 2 users (9,500 XAF)
  9 referrals: 1 users (3,000 XAF)

⚠️  HIGH RISK: Users with ZERO referrals and high balance:
────────────────────────────────────────────────────────────────────────────────
  Jane Smith (jane@example.com) - 15,500 XAF
  Test User (test@example.com) - 25,000 XAF
  Bob Jones (bob@example.com) - 10,500 XAF
────────────────────────────────────────────────────────────────────────────────
```

#### 2. CSV Export

A CSV file is automatically saved in `user-service/reports/` directory with filename format:
```
suspicious-users-YYYY-MM-DDTHH-MM-SS.csv
```

The CSV contains:
- User ID
- Name
- Email
- Phone
- Balance (XAF)
- Direct Referrals
- Indirect Referrals
- Total Referrals
- Account Created
- Last Activity

This can be opened in Excel/Google Sheets for further analysis.

## Understanding the Results

### Risk Levels

**🔴 HIGH RISK - Zero Referrals**
- Users with balance > 5000 XAF and **0 referrals**
- Highest priority for investigation
- Likely fraudulent or improperly funded accounts

**🟡 MEDIUM RISK - Low Referrals (1-5)**
- Users with balance > 5000 XAF and **1-5 referrals**
- May be new users still building network
- Worth monitoring

**🟢 LOW RISK - Some Referrals (6-9)**
- Users with balance > 5000 XAF and **6-9 referrals**
- Just below threshold
- Probably legitimate but worth checking

### Referral Count Calculation

- **Direct Referrals**: Users who used this user's referral code
- **Indirect Referrals**: Users referred by the direct referrals (2nd level)
- **Total Referrals**: Direct + Indirect

Example:
```
User A (you) refers User B (direct)
User B refers User C (indirect to User A)
User B refers User D (indirect to User A)

User A's stats:
- Direct: 1 (User B)
- Indirect: 2 (Users C and D)
- Total: 3
```

## Actions to Take

### 1. Review the Report

- Focus on **HIGH RISK** users first (zero referrals)
- Check users with highest balances
- Look for suspicious patterns (multiple users with same characteristics)

### 2. Investigate Individual Accounts

For each suspicious user, check:
- **Transaction History**: Where did the balance come from?
- **Account Age**: Is this a new account with immediate high balance?
- **Activity Patterns**: Has the user made legitimate purchases/activities?
- **KYC Status**: Is the account verified?
- **IP Address**: Are there multiple accounts from same IP?

### 3. Take Action

Based on investigation, you can:

#### Option A: Flag for Review
- Add internal notes to the account
- Monitor for suspicious activity
- Require additional verification for withdrawals

#### Option B: Contact User
- Request verification documents
- Ask about source of funds
- Explain referral program

#### Option C: Freeze Account (if fraud confirmed)
- Temporarily block withdrawals
- Block new transactions
- Investigate transactions thoroughly

#### Option D: Clear Account (if legitimate)
- If user provides valid explanation
- Document the review
- Remove from watchlist

## Common Legitimate Cases

Not all users in the report are fraudulent. Legitimate reasons include:

1. **Early Adopters/VIP Users**
   - May have been given promotional credits
   - Check if they're known early supporters

2. **Test Accounts**
   - Internal testing accounts that weren't properly flagged
   - Should be marked as test accounts in database

3. **Business Accounts**
   - Bulk purchasers who don't focus on referrals
   - Check if they're registered business partners

4. **Gift/Promotion Recipients**
   - Users who received promotional credits
   - Cross-reference with marketing campaigns

5. **Support Compensations**
   - Users compensated for issues
   - Check support ticket history

## Integration with Admin Dashboard

You can integrate this detection into the admin dashboard:

### Manual Approach
1. Run script weekly/monthly
2. Export CSV
3. Review in admin panel by user ID

### Automated Approach (Future Enhancement)
- Add "Suspicious Activity" flag to user model
- Run script as cron job
- Display flagged users in admin panel
- Add review workflow in admin UI

## Scheduling the Script

To run automatically, you can set up a cron job:

### Linux/Mac
```bash
# Add to crontab (run every Monday at 9 AM)
0 9 * * 1 cd /path/to/user-service && npm run find:suspicious >> /var/log/suspicious-users.log 2>&1
```

### Windows Task Scheduler
Create a scheduled task that runs:
```cmd
cd "C:\path\to\user-service" && npm run find:suspicious
```

## Customization

You can modify the detection criteria by editing the script:

### Change Balance Threshold
```typescript
// File: user-service/src/scripts/find-suspicious-users.ts

// Change from 5000 to 10000
const usersWithHighBalance = await User.find({
    'balance.XAF': { $gt: 10000 }  // Changed threshold
}).select('_id name email phoneNumber balance createdAt updatedAt').lean();
```

### Change Referral Threshold
```typescript
// Change from 10 to 5
if (totalReferrals < 5) {  // Changed threshold
    suspiciousUsers.push({
        // ...
    });
}
```

### Add Additional Criteria
```typescript
// Example: Only check users created in last 30 days
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const usersWithHighBalance = await User.find({
    'balance.XAF': { $gt: 5000 },
    createdAt: { $gte: thirtyDaysAgo }  // NEW: Only recent accounts
}).select('_id name email phoneNumber balance createdAt updatedAt').lean();
```

## Performance Considerations

- **Database Load**: The script queries the database extensively
- **Execution Time**: May take several minutes for large user bases
- **Recommendations**:
  - Run during off-peak hours
  - Consider adding database indexes on `balance.XAF` and `referredBy`
  - Run weekly rather than daily for large databases

### Add Database Indexes (Optional)

```javascript
// In MongoDB shell or via Mongoose
db.users.createIndex({ "balance.XAF": -1 });
db.users.createIndex({ "referredBy": 1 });
```

## Troubleshooting

### Script Fails to Connect to Database

**Error**: `Database connection error`

**Solution**:
- Check MongoDB is running
- Verify `DATABASE_URL` in `.env` file
- Ensure user-service can connect to database

### No Users Found

**Possible Reasons**:
1. All users have > 10 referrals (healthy network!)
2. No users with balance > 5000 XAF
3. Currency field is different (check if using USD/EUR instead of XAF)

### Script Takes Too Long

**Solutions**:
- Add database indexes (see above)
- Increase balance threshold to reduce search space
- Run on a database replica if available

## Report Interpretation Examples

### Example 1: Obvious Fraud
```
Name: John Doe
Balance: 50,000 XAF
Direct Referrals: 0
Indirect Referrals: 0
Account Created: Yesterday

Action: HIGH PRIORITY - Freeze account, investigate transactions
```

### Example 2: Possible Test Account
```
Name: Test User
Balance: 10,000 XAF
Direct Referrals: 0
Indirect Referrals: 0
Account Created: 6 months ago

Action: Check if internal test account, should be flagged in system
```

### Example 3: Slow Starter (Legitimate)
```
Name: Jane Smith
Balance: 6,000 XAF
Direct Referrals: 3
Indirect Referrals: 5
Account Created: 2 months ago

Action: Probably legitimate, growing network slowly
```

### Example 4: Business User (Legitimate)
```
Name: ABC Company Ltd
Balance: 25,000 XAF
Direct Referrals: 1
Indirect Referrals: 0
Account Created: 1 year ago

Action: Check if registered business partner, may not focus on referrals
```

## Related Scripts

- `partner-recalc-simple.ts`: Recalculate partner transactions
- `migrate-subscription-fields.ts`: Migrate subscription data
- `check-all-countries.js`: Validate country data

## Security Notes

⚠️ **Important**:
- This script has read-only access (no modifications)
- CSV files contain sensitive user data - store securely
- Delete CSV files after review
- Don't share reports via unsecured channels
- Follow GDPR/data protection regulations

## Future Enhancements

Possible improvements to the script:

1. **Multi-currency Support**: Check balances in USD, EUR, etc.
2. **Time-based Analysis**: Flag users who gained high balance quickly
3. **Transaction Pattern Analysis**: Detect suspicious deposit patterns
4. **IP/Device Analysis**: Flag multiple accounts from same device
5. **Machine Learning**: Use ML to detect anomalous behavior
6. **Real-time Alerts**: Send notifications when suspicious account is created
7. **Automated Actions**: Automatically flag or limit suspicious accounts

## Support

For questions or issues with this script:
1. Check logs in console output
2. Review MongoDB connection settings
3. Verify user model schema matches script expectations
4. Contact development team for assistance

---

**Created**: January 2025
**Version**: 1.0.0
**Location**: `user-service/src/scripts/find-suspicious-users.ts`
**Command**: `npm run find:suspicious`
