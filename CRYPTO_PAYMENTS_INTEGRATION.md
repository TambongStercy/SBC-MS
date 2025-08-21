# Crypto Payments Integration for SBC

## Overview
This document outlines the implementation of cryptocurrency payments and USD balance functionality for the SBC (Sniper Business Center) platform.

## Key Features Implemented

### 1. USD Balance System
- Added `usdBalance` field to User model
- Created USD balance management methods in user service
- Added currency conversion functionality (XAF ↔ USD)
- Conversion rates:
  - XAF to USD: 1 USD = 660 XAF (for deposits/payments)
  - USD to XAF: 1 USD = 590 XAF (for withdrawals - better rate for users)

### 2. Crypto Pricing Structure
All crypto payments are processed in USD with the following pricing:

#### CLASSIQUE Subscription
- Inscription: $4 USD
- Level 1 Commission: $2 USD
- Level 2 Commission: $1 USD
- Level 3 Commission: $0.5 USD

#### CIBLE Subscription
- Inscription: $10 USD
- Level 1 Commission: $5 USD
- Level 2 Commission: $2.5 USD
- Level 3 Commission: $1.25 USD

#### UPGRADE Payment
- Inscription: $6 USD
- Level 1 Commission: $3 USD
- Level 2 Commission: $1.5 USD
- Level 3 Commission: $0.75 USD

### 3. Technical Implementation

#### User Service Changes
- **Model**: Added `usdBalance` field to User schema
- **Repository**: Added `updateUsdBalance()` method
- **Service**: Added USD balance management and conversion methods
- **Controller**: Added USD balance endpoints
- **Routes**: Added USD balance and conversion routes

#### Payment Service Changes
- **Crypto Payment Service**: New service for handling crypto payments
- **Crypto Pricing Config**: Centralized pricing configuration
- **User Service Client**: Added USD balance methods
- **Payment Controller**: Added crypto payment endpoints
- **Payment Routes**: Added crypto payment routes
- **Frontend**: Updated payment page to support crypto payments

### 4. API Endpoints

#### User Service
```
GET    /users/:userId/usd-balance           - Get user USD balance
POST   /users/:userId/usd-balance           - Update user USD balance
POST   /users/:userId/convert-usd-to-xaf    - Convert USD to XAF
POST   /users/:userId/convert-xaf-to-usd    - Convert XAF to USD
```

#### Payment Service
```
POST   /api/payments/crypto-estimate        - Get crypto payment estimate
POST   /api/payments/crypto-payment         - Create crypto payment intent
GET    /api/payments/status/:sessionId      - Get payment status
```

### 5. Frontend Changes
- **Payment Page**: Enabled crypto payment option (removed beta flag)
- **JavaScript**: Added crypto payment handling
- **UI**: Enhanced crypto payment interface with real-time estimates

### 6. Commission Distribution
- Crypto payments distribute commissions in USD to referrers' USD balances
- Users can convert between USD and XAF balances as needed
- Commission rates remain the same as traditional payments but in USD

### 7. Database Migration
- Created migration script to add `usdBalance: 0` to all existing users
- Run: `node user-service/src/scripts/add-usd-balance-migration.js`

## Usage Flow

### For Users
1. **Making Crypto Payments**:
   - Select cryptocurrency payment method
   - Choose desired cryptocurrency (BTC, ETH, USDT, etc.)
   - Get real-time conversion rate and amount
   - Send exact amount to provided crypto address
   - Payment automatically confirmed via webhooks

2. **Managing USD Balance**:
   - View USD balance in account
   - Convert USD to XAF for local use (590 XAF per USD)
   - Convert XAF to USD for crypto transactions (660 XAF per USD)

3. **Receiving Commissions**:
   - Crypto payment commissions credited to USD balance
   - Traditional payment commissions credited to XAF balance
   - Users can convert between currencies as needed

### For Administrators
- Monitor both XAF and USD balances
- Track crypto payment transactions
- View conversion activities
- Manage crypto payment settings

## Security Considerations
- All crypto payments processed through NOWPayments API
- USD balance updates are atomic operations
- Conversion rates are configurable
- Payment webhooks are properly validated
- User balances are protected with proper authentication

## Future Enhancements
- Support for more cryptocurrencies
- Dynamic conversion rates from external APIs
- Crypto withdrawal functionality
- Advanced crypto payment analytics
- Multi-currency wallet support

## Configuration
Key configuration options in `payment-service/src/config/crypto-pricing.ts`:
- Subscription pricing in USD
- Commission rates for each level
- Currency conversion rates
- Supported cryptocurrencies

## Testing
- Test crypto payments with small amounts first
- Verify commission distribution in USD
- Test currency conversion functionality
- Validate webhook processing
- Check balance updates are atomic

## Deployment Notes
1. Run USD balance migration before deploying
2. Ensure NOWPayments API credentials are configured
3. Update frontend assets (CSS, JS)
4. Test crypto payment flow in staging environment
5. Monitor crypto payment webhooks after deployment

## Support
For issues related to crypto payments:
- Check NOWPayments API status
- Verify webhook endpoints are accessible
- Monitor payment service logs
- Validate user USD balances
- Check currency conversion rates