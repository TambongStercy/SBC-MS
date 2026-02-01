# Double Deduction Bug Fix Procedure

## Issue Description
A race condition in the payment webhook handlers caused withdrawals to be deducted twice from user balances. This occurred when two concurrent webhooks both passed the "already completed" check before either could mark the transaction as processed.

**Root Cause**: Non-atomic read-then-check pattern in CinetPay and FeexPay webhook handlers.

**Fix Applied**: Added atomic `claimTransactionForProcessing()` method using MongoDB's `findOneAndUpdate` in `payment-service/src/database/repositories/transaction.repository.ts`.

---

## Production Database Connection

**IMPORTANT**: Always use port 27018 for the production database (port-forwarded).

```bash
# Connection details
Host: localhost (port-forwarded)
Port: 27018
Username: stercytambong
Password: w23N0S5Qb6kMUwTi
Auth DB: admin

# Databases:
# - sbc_users: User data and balances
# - sbc_payment: Transaction records
```

---

## Step-by-Step Fix Procedure

### 1. Find the affected user

```bash
cat << 'SCRIPT' | mongosh --port 27018 -u stercytambong -p w23N0S5Qb6kMUwTi --authenticationDatabase admin sbc_users --quiet

const user = db.users.findOne({ email: 'USER_EMAIL_HERE' });
if (user) {
    print('=== USER INFO ===');
    print('ID: ' + user._id);
    print('Name: ' + user.name);
    print('Email: ' + user.email);
    print('Current Balance: ' + user.balance);
} else {
    print('User not found');
}

SCRIPT
```

### 2. Calculate expected balance from transactions

```bash
cat << 'SCRIPT' | mongosh --port 27018 -u stercytambong -p w23N0S5Qb6kMUwTi --authenticationDatabase admin sbc_payment --quiet

const userId = ObjectId('USER_ID_HERE');

const txs = db.transactions.find({
    userId: userId,
    status: 'completed'
}).sort({ createdAt: 1 }).toArray();

print('=== TRANSACTION HISTORY ===');

let calculatedBalance = 0;
txs.forEach(tx => {
    if (tx.type === 'deposit' || tx.type === 'commission' || tx.type === 'referral_bonus') {
        calculatedBalance += tx.amount;
    } else if (tx.type === 'withdrawal' || tx.type === 'purchase') {
        calculatedBalance -= tx.amount;
    }
    print(tx.createdAt.toISOString().split('T')[0] + ' | ' + tx.type.padEnd(12) + ' | ' + tx.amount.toFixed(2).padStart(10) + ' | Balance: ' + calculatedBalance.toFixed(2));
});

print('');
print('Expected Balance: ' + calculatedBalance.toFixed(2) + ' XAF');

SCRIPT
```

### 3. Apply balance correction

```bash
cat << 'SCRIPT' | mongosh --port 27018 -u stercytambong -p w23N0S5Qb6kMUwTi --authenticationDatabase admin sbc_users --quiet

const userId = 'USER_ID_HERE';
const correctionAmount = AMOUNT_HERE; // The withdrawal amount that was deducted twice

const user = db.users.findOne({_id: ObjectId(userId)});
const currentBalance = user.balance;
const newBalance = currentBalance + correctionAmount;

console.log('=== Applying Balance Correction ===');
console.log('User:', user.email);
console.log('Name:', user.name);
console.log('Current Balance:', currentBalance.toFixed(2), 'XAF');
console.log('Correction Amount: +' + correctionAmount.toFixed(2), 'XAF');
console.log('New Balance:', newBalance.toFixed(2), 'XAF');

const result = db.users.updateOne(
  { _id: ObjectId(userId) },
  {
    $inc: { balance: correctionAmount },
    $push: {
      balanceAdjustments: {
        date: new Date(),
        amount: correctionAmount,
        reason: 'Double deduction bug fix - withdrawal of ' + correctionAmount + ' XAF was deducted twice',
        previousBalance: currentBalance,
        newBalance: newBalance,
        adminNote: 'Automated fix for webhook race condition bug'
      }
    }
  }
);

if (result.modifiedCount === 1) {
  console.log('\n✓ Balance corrected successfully!');
  const updatedUser = db.users.findOne({_id: ObjectId(userId)});
  console.log('Verified new balance:', updatedUser.balance.toFixed(2), 'XAF');
} else {
  console.log('\n✗ Failed to update balance!');
}

SCRIPT
```

### 4. Send apology email

Edit `notification-service/src/scripts/send-apology-emails.ts`:

```typescript
const affectedUsers = [
    { email: 'user@email.com', name: 'UserName', newBalance: 1234.56 }
];
```

Then run:
```bash
cd notification-service && npx ts-node src/scripts/send-apology-emails.ts
```

---

## Identifying Affected Users

To find users with negative balances (potential double-deduction victims):

```bash
cat << 'SCRIPT' | mongosh --port 27018 -u stercytambong -p w23N0S5Qb6kMUwTi --authenticationDatabase admin sbc_users --quiet

db.users.find({ balance: { $lt: 0 } }).forEach(user => {
    print(user.email + ' | Balance: ' + user.balance + ' | Name: ' + user.name);
});

SCRIPT
```

---

## Code Fix Reference

The fix was applied to:
- `payment-service/src/database/repositories/transaction.repository.ts` - Added `claimTransactionForProcessing()` method
- `payment-service/src/services/payment.service.ts` - Updated `processConfirmedPayoutWebhook()` and `processFeexPayPayoutWebhook()` to use atomic claim

---

## Users Fixed (for reference)

| Date | Email | Withdrawal Amount | Previous Balance | New Balance |
|------|-------|-------------------|------------------|-------------|
| 2026-01-25 | mlaganiromain@gmail.com | 2,501 XAF | -1,500.13 | 1,000.87 |
| 2026-01-25 | misterpitch05@gmail.com | 14,298.75 XAF | 6,461.37 | 20,760.12 |
| 2026-01-24 | (10 users batch) | Various | Various | Various |
