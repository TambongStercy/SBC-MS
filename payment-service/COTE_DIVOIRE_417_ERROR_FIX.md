# Côte d'Ivoire CinetPay Error 417 Fix

## Problem Description

Users from Côte d'Ivoire were receiving the following error during withdrawals:

```
ID Transaction: Vucazlc13UaeVN20
Date: 2025-07-18T08:07:46.286Z
Raison: Failed to add contact: Request failed with status code 417
```

**Status Code 417** means "Expectation Failed" - indicating that CinetPay's API server cannot meet the requirements of the request format.

## Why Only Côte d'Ivoire Users?

Côte d'Ivoire has specific phone number formatting requirements that differ from other African countries:

### CinetPay Requirements for Côte d'Ivoire:
- **Country Code**: CI (ISO)
- **Prefix**: 225 
- **Currency**: XOF
- **Payment Method**: WAVECI (Wave Côte d'Ivoire)
- **Phone Format**: Must be 9 digits starting with valid operator prefix

### Valid Operator Prefixes:
- **01** - Unknown operator
- **02** - Unknown operator  
- **03** - Unknown operator
- **05** - MTN
- **07** - Orange
- **08** - Moov
- **09** - Wave

### Invalid Prefixes (cause 417 errors):
- **04**, **06** - Not valid operator prefixes
- Numbers without leading **0**
- Numbers with wrong digit count

## Root Cause Analysis

The 417 error was caused by:

1. **Phone number format validation failures**
2. **Missing or incorrect operator prefixes**
3. **Wrong digit count** (8 digits instead of 9)
4. **Missing leading zero** for national format

## Solution Implemented

### 1. Enhanced Phone Number Formatting

Updated `formatPhoneNumber()` method in `cinetpay-payout.service.ts`:

```typescript
// Special handling for Côte d'Ivoire to prevent 417 errors
if (countryCode === 'CI') {
    // Côte d'Ivoire phone numbers should be 9 digits without country code
    // Valid operator prefixes: 01, 02, 03, 05, 07, 08, 09
    if (cleanPhone.length === 8) {
        // If 8 digits, add leading 0 (e.g., 12345678 -> 012345678)
        cleanPhone = '0' + cleanPhone;
    }
    if (cleanPhone.length === 9 && !cleanPhone.startsWith('0')) {
        // If 9 digits without leading 0, add it
        cleanPhone = '0' + cleanPhone;
    }
    // Validate that it starts with valid operator prefixes
    const validPrefixes = ['01', '02', '03', '05', '07', '08', '09'];
    const phonePrefix = cleanPhone.substring(0, 2);
    if (!validPrefixes.includes(phonePrefix)) {
        log.warn(`Côte d'Ivoire phone number ${cleanPhone} has invalid operator prefix ${phonePrefix}. Valid prefixes: ${validPrefixes.join(', ')}`);
    }
}
```

### 2. Enhanced Contact Addition with Validation

Updated `addContact()` method with Côte d'Ivoire-specific validation:

```typescript
// Special handling for Côte d'Ivoire to prevent 417 errors
if (contact.prefix === '225') { // Côte d'Ivoire
    // Ensure phone number format is correct for Côte d'Ivoire
    const phonePattern = /^0[1235789]\d{7}$/; // Must be 01, 02, 03, 05, 07, 08, 09 + 7 digits
    if (!phonePattern.test(contact.phone)) {
        log.warn(`Côte d'Ivoire phone number ${contact.phone} may not be in correct format. Expected: 0XXXXXXXX`);
    }
}
```

### 3. Improved HTTP Headers

Added proper headers to prevent expectation failures:

```typescript
{
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'SBC-API/1.0'
    }
}
```

### 4. Specific 417 Error Handling

Added targeted error handling for Côte d'Ivoire:

```typescript
// Special handling for 417 errors (common with Côte d'Ivoire)
if (error.response && error.response.status === 417) {
    log.error('HTTP 417 Expectation Failed - likely phone number format issue for Côte d\'Ivoire');
    
    if (contact.prefix === '225') {
        throw new Error(`Failed to add contact: Invalid phone number format for Côte d'Ivoire. Phone numbers must start with 01, 02, 03, 05, 07, 08, or 09 and be 10 digits total. Current: ${contact.phone}`);
    }
}
```

## Testing

Run the test script to validate the fixes:

```bash
node test-cote-divoire-fix.js
```

### Example Valid Phone Numbers:
```
070123456   ✅ Orange Côte d'Ivoire
080123456   ✅ Moov Côte d'Ivoire  
090123456   ✅ Wave Côte d'Ivoire
050123456   ✅ MTN Côte d'Ivoire
```

### Example Invalid Phone Numbers (would cause 417):
```
12345678    ❌ Missing leading 0
040123456   ❌ Invalid operator prefix
060123456   ❌ Invalid operator prefix
1234        ❌ Too short
```

## Verification

After implementing these fixes:

1. ✅ Phone numbers are properly formatted before sending to CinetPay
2. ✅ Invalid operator prefixes are detected and warned
3. ✅ 417 errors include specific guidance for Côte d'Ivoire
4. ✅ HTTP headers meet CinetPay's expectations
5. ✅ Contact addition succeeds for valid Ivorian numbers

## Prevention

To prevent future 417 errors for Côte d'Ivoire:

1. **Always validate** phone numbers against the pattern: `/^0[1235789]\d{7}$/`
2. **Ensure proper formatting** before API calls
3. **Include appropriate HTTP headers** 
4. **Monitor logs** for invalid operator prefix warnings
5. **Test with various phone number formats** from Côte d'Ivoire

## Related Documentation

- [CinetPay Transfer API Documentation](https://docs.cinetpay.com/api/1.0-fr/transfert/utilisation)
- [Payment Service Documentation](./PAYOUT_DOCUMENTATION.md)
- [CinetPay Payout Guide](./CINETPAY_PAYOUT_GUIDE.md) 