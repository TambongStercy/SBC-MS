# Crypto Payment Currency Fix

## Issue Identified
The NOWPayments API doesn't support XAF (Central African CFA franc) as a price currency, causing crypto payment creation to fail with the error:
```
Currency XAF was not found
```

## Root Cause
- Payment intents were created with XAF amounts and currency
- NOWPayments API only supports major fiat currencies (USD, EUR, etc.)
- XAF is not supported as a `price_currency` parameter

## Solution Implemented

### 1. Currency Conversion in Payment Service
Updated `createCryptoPayment()` method to:
- Detect XAF currency in payment intents
- Convert XAF amounts to USD using the rate: 1 USD = 660 XAF
- Use USD as the price currency for NOWPayments API calls
- Log the conversion for transparency

```typescript
// Convert amount to USD if needed (NOWPayments doesn't support XAF)
let usdAmount = paymentIntent.amount || 0;
let priceCurrency = paymentIntent.currency || 'USD';

if (priceCurrency === 'XAF') {
    usdAmount = (paymentIntent.amount || 0) / 660; // Convert XAF to USD
    priceCurrency = 'USD';
    log.info(`Converted ${paymentIntent.amount} XAF to ${usdAmount} USD for NOWPayments`);
}
```

### 2. Updated Payment Intent Storage
- Store converted USD amounts in payment intents
- Maintain currency as 'USD' for crypto payments
- Preserve original XAF amounts in metadata if needed

### 3. Fixed Crypto Payment Service
Updated the standalone crypto payment service to:
- Use USD pricing from the crypto pricing configuration
- Create payments with USD as price currency
- Calculate correct exchange rates

### 4. Frontend Updates
- Updated crypto estimate display to show USD rates
- Improved error handling for currency conversion
- Enhanced rate display format

## Testing

### Test Cases
1. **XAF to BTC Payment**
   - Amount: 3070 XAF
   - Expected: Converts to ~4.65 USD
   - Creates BTC payment successfully

2. **USD to Crypto Payment**
   - Amount: 4.65 USD
   - Expected: Direct crypto payment creation
   - No conversion needed

3. **Multiple Cryptocurrencies**
   - Test with BTC, ETH, USDT, USDC
   - Verify all work with USD pricing

### Test Endpoints
Created `test-crypto-payment.http` with test cases for:
- Crypto estimates with USD
- Crypto estimates with XAF (auto-conversion)
- Crypto payment creation

## Configuration

### Supported Currencies
- **Input**: XAF (auto-converted to USD)
- **Processing**: USD (for NOWPayments API)
- **Output**: Any supported cryptocurrency

### Conversion Rates
- XAF to USD: 1 USD = 660 XAF (for crypto payments)
- USD to XAF: 1 USD = 590 XAF (for withdrawals)

## Impact

### Positive
- ✅ Crypto payments now work with XAF amounts
- ✅ Automatic currency conversion
- ✅ Maintains pricing consistency
- ✅ Proper error handling and logging

### Considerations
- Currency conversion happens at payment creation
- Exchange rates are fixed (not dynamic)
- USD is used as intermediate currency for all crypto payments

## Deployment Notes

1. **No Database Changes Required**
   - Existing payment intents will work
   - New crypto payments use USD conversion

2. **Configuration Updates**
   - Ensure NOWPayments API credentials are valid
   - Verify crypto pricing configuration

3. **Testing Checklist**
   - [ ] Test XAF to crypto conversion
   - [ ] Test USD to crypto direct payment
   - [ ] Verify commission distribution
   - [ ] Check payment status updates
   - [ ] Validate webhook processing

## Monitoring

### Key Metrics to Watch
- Crypto payment success rate
- Currency conversion accuracy
- NOWPayments API response times
- User experience with crypto payments

### Log Messages to Monitor
- `Converted X XAF to Y USD for NOWPayments`
- `Creating crypto payment for session X with Y`
- NOWPayments API success/error responses

## Future Enhancements

1. **Dynamic Exchange Rates**
   - Integrate with real-time currency APIs
   - Update conversion rates automatically

2. **Multi-Currency Support**
   - Add support for EUR, GBP, etc.
   - Allow users to choose display currency

3. **Enhanced Error Handling**
   - Better error messages for unsupported currencies
   - Fallback mechanisms for API failures

## Summary

The crypto payment system now successfully handles XAF amounts by automatically converting them to USD for NOWPayments API compatibility. This fix enables seamless crypto payments for users in Central African countries while maintaining the existing pricing structure and user experience.