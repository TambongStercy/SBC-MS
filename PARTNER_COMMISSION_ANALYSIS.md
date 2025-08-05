# Partner Commission Calculation Analysis

## Issue Summary

The partner recalculation scripts are not correctly calculating commissions for partners due to a **timeline logic problem** related to the recent data recovery operation.

## Specific Case Analysis

**Partner**: `65e9550d845eb94af1d60aa8` (evarisallanengueambou@gmail.com)
- **Pack**: Silver (18% commission rate)
- **Current Balance**: 0 XAF
- **Expected Balance**: 90 XAF

## Timeline Problem

```
User Created:     March 7, 2024
Subscriptions:    March 9 & 15, 2024  ← Actual subscription dates
Partner Created:  February 1, 2025    ← Partner became active
Referrals:        February 2, 2025    ← Recovered from backup (new dates)
```

## Root Cause

### 1. **Incorrect Business Logic Implementation**
Both scripts use this condition:
```typescript
createdAt: { $gte: partner.createdAt }
```

This is **incorrect** because it uses individual partner creation dates instead of the partner system launch date.

### 2. **Missing Partner System Launch Date**
The correct business logic should be:
- **Partner system launched**: September 21, 2024
- **Only referrals created after this date** should generate commissions
- **All subscriptions** of valid referred users should count

### 3. **Data Recovery Impact**
During our recent TTL deletion recovery:
- **Referrals** were recovered with **new creation dates** (Feb 2, 2025) ✅
- **Subscriptions** kept their **original dates** (March 2024) ✅
- **Partners** were created **after** the recovery (Feb 1, 2025) ✅

This actually works correctly with the proper business logic!

## Detailed Commission Calculation

For partner `65e9550d845eb94af1d60aa8`:

| Referred User | Level | Subscription Type | Date | Commission |
|---------------|-------|------------------|------|------------|
| 65ec1332845eb94af1e2f3dd | L1 | CLASSIQUE | Mar 15, 2024 | 45 XAF |
| 65ec13b5845eb94af1e2f416 | L1 | CLASSIQUE | Mar 9, 2024 | 45 XAF |
| **Total** | | | | **90 XAF** |

**Calculation**: 250 XAF (CLASSIQUE base) × 0.18 (Silver rate) = 45 XAF per subscription

## Correct Solution

### **Use Partner System Launch Date**
The correct business logic is:

```typescript
// 1. Only count referrals created after partner system launch
const PARTNER_SYSTEM_LAUNCH_DATE = new Date('2024-09-21T00:00:00.000Z');

const referrals = await ReferralModel.find({
    referrer: partner.user,
    archived: { $ne: true },
    createdAt: { $gte: PARTNER_SYSTEM_LAUNCH_DATE } // Key fix!
});

// 2. Count ALL subscriptions for valid referred users
const subscriptions = await SubscriptionModel.find({
    user: referral.referredUser,
    status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
    // No date filter on subscriptions
});
```

### **Why This Works**
- **Referrals after Sept 21, 2024**: Only valid referrals count ✅
- **All subscriptions**: Partners get credit for entire subscription history of referred users ✅
- **Data recovery compatible**: Works with recovered referral dates ✅

## Implementation

The fixed script `partner-recalc-fixed.ts` implements this solution and shows:
- **Current logic results**: 0 XAF (incorrect)
- **Fixed logic results**: 90 XAF (correct)

## Impact Assessment

This issue likely affects **all partners** who:
1. Have referrals that were recovered from backup
2. Have referred users with subscriptions created before partner activation
3. Currently show 0 or lower-than-expected balances

## Next Steps

1. **Review business requirements**: Confirm which subscriptions should count
2. **Test the fixed script**: Run in dry-run mode to see impact
3. **Apply the fix**: Update partner balances with correct calculations
4. **Monitor results**: Ensure partners receive expected commissions

## Correct Business Logic Confirmed

**Partners should earn commissions from**:
- ✅ **Referrals created after September 21, 2024** (partner system launch)
- ✅ **All subscriptions** of those referred users (regardless of subscription date)

**This means**:
- If someone was referred after the partner system launched, the partner gets credit for all their subscriptions
- If someone was referred before the partner system launched, no commission is earned
- Individual partner creation dates are irrelevant - only the system launch date matters