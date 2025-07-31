# Partner Transaction Recalculation Scripts

This document explains how to use the partner transaction recalculation scripts to fix partner balances and transaction history.

## Overview

The scripts recalculate partner transactions and balances by:
1. Finding all active partners
2. Getting their referrals (users they referred)
3. Finding subscriptions made by referred users after the partner became active
4. Calculating correct commissions based on current rates
5. Clearing old transactions and creating new ones
6. Updating partner balances

## Commission Calculation

**Current Rates:**
- Silver partners: 18% of base amount
- Gold partners: 30% of base amount

**Base Amounts:**
- CLASSIQUE subscription: 250 XAF
- CIBLE subscription: 625 XAF

**Example:** A gold partner gets 30% of 625 XAF = 187.5 XAF (rounded to 188 XAF) for each CIBLE subscription from their referrals.

## Available Scripts

### 1. Simple Recalculation (Recommended)
```bash
# Dry run (preview changes only)
npm run recalc:partners

# Apply changes to database
npm run recalc:partners:apply
```

### 2. Full Recalculation (Detailed logging)
```bash
# Dry run with detailed logging
npm run recalc:partners:full

# Apply changes with detailed logging
npm run recalc:partners:full:apply
```

## Usage Instructions

### Step 1: Preview Changes (Dry Run)
Always start with a dry run to see what changes will be made:

```bash
npm run recalc:partners
```

This will show:
- Current vs recalculated balances for each partner
- Number of transactions that will be created
- Summary of total changes

### Step 2: Backup Database (Recommended)
Before applying changes, backup your database:

```bash
mongodump --db your-database-name --out backup-$(date +%Y%m%d)
```

### Step 3: Apply Changes
If the dry run results look correct, apply the changes:

```bash
npm run recalc:partners:apply
```

## What the Script Does

1. **Finds Active Partners**: Gets all partners with `isActive: true`

2. **Processes Each Partner**:
   - Gets all their referrals (level 1, 2, and 3)
   - Finds subscriptions made by referred users after partner creation date
   - Calculates commissions based on subscription type and partner pack

3. **Clears Old Data**: Removes existing partner transactions

4. **Creates New Data**: 
   - Inserts recalculated transactions
   - Updates partner balance

5. **Provides Summary**: Shows before/after balances and transaction counts

## Example Output

```
👤 Processing partner 507f1f77bcf86cd799439011 (gold)
  Current: 1250 XAF
  Recalculated: 1875 XAF
  Difference: 625 XAF
  Transactions: 8

📈 SUMMARY:
Partners processed: 15
Total current balance: 18750 XAF
Total new balance: 23125 XAF
Net difference: 4375 XAF
Total transactions: 127
```

## Safety Features

- **Dry Run by Default**: Scripts run in preview mode unless `--apply` is used
- **Transaction Safety**: Uses MongoDB transactions for data consistency
- **Detailed Logging**: Shows exactly what changes will be made
- **Validation**: Checks data integrity before applying changes

## Troubleshooting

### Script Fails to Connect
Make sure your MongoDB connection string is set in environment variables:
```bash
export MONGODB_URI="mongodb://localhost:27017/your-database"
```

### No Changes Detected
This could mean:
- Partners already have correct balances
- No subscriptions found after partner creation dates
- All referred users have no active/expired subscriptions

### Large Differences
If you see unexpectedly large differences:
- Check if partner creation dates are correct
- Verify subscription data integrity
- Review commission rate constants in the script

## Files Modified

The scripts will modify these collections:
- `partners` - Updates the `amount` field
- `partnertransactions` - Clears and recreates all records

## Recovery

If you need to restore from backup:
```bash
mongorestore --db your-database-name backup-folder/your-database-name
```

## Support

If you encounter issues:
1. Check the console output for error messages
2. Verify database connectivity
3. Ensure all required models are properly imported
4. Check that partner and referral data is consistent