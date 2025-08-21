# Frontend Developer Guide: Currency Conversion & Crypto Withdrawals

This document provides complete information for frontend developers on how to use the currency conversion and crypto withdrawal endpoints in the SBC platform.

## 🏦 **Currency System Overview**

The SBC platform operates with a **dual-currency system**:
- **FCFA (XAF)**: Primary currency for traditional payments and operations
- **USD**: Secondary currency for crypto payments and international transactions

Users have **two separate balances**:
- `balance`: FCFA balance 
- `usdBalance`: USD balance

## 💱 **Currency Conversion Rates**

### **Fixed Exchange Rates**

#### **XAF to USD Conversion**
- **1 USD = 660 XAF**
- **1 XAF = 0.001515 USD** (1/660)

#### **USD to XAF Conversion (Better rate for users)**
- **1 USD = 590 XAF** 
- **1 XAF = 0.001695 USD** (1/590)

> **Note**: When users convert USD to XAF, they get a better exchange rate (590 vs 660) to encourage USD-to-XAF conversions and provide better value.

## 🔄 **Currency Conversion Endpoints**

### **👤 Public User Endpoints (User can convert their own balance)**

### **1. Convert USD to FCFA**

**Endpoint**: `POST /api/users/convert-usd-to-xaf`

**Authorization**: User Authentication Required (Bearer token)

**Request Body**:
```json
{
  "usdAmount": 10.5
}
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully converted 10.5 USD to 6195 XAF",
  "convertedAmount": 6195
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Insufficient USD balance"
}
```

### **2. Convert FCFA to USD**

**Endpoint**: `POST /api/users/convert-xaf-to-usd`

**Authorization**: User Authentication Required (Bearer token)

**Request Body**:
```json
{
  "xafAmount": 6600
}
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully converted 6600 XAF to 10 USD",
  "convertedAmount": 10
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Insufficient XAF balance"
}
```

### **🔧 Internal Service Endpoints (Service-to-Service)**

### **3. Convert USD to FCFA (Internal)**

**Endpoint**: `POST /api/users/internal/:userId/convert-usd-to-xaf`

**Authorization**: Service-to-Service (requires `SERVICE_SECRET` header)

**Request Body**:
```json
{
  "usdAmount": 10.5
}
```

### **4. Convert FCFA to USD (Internal)**

**Endpoint**: `POST /api/users/internal/:userId/convert-xaf-to-usd`

**Authorization**: Service-to-Service (requires `SERVICE_SECRET` header)

**Request Body**:
```json
{
  "xafAmount": 6600
}
```

## 💰 **Balance Management Endpoints**

### **Get User FCFA Balance**
```http
GET /api/users/internal/:userId/balance
```

### **Update User FCFA Balance**
```http
POST /api/users/internal/:userId/balance
Content-Type: application/json

{
  "amount": 1000
}
```

### **Get User USD Balance**
```http
GET /api/users/internal/:userId/usd-balance
```

### **Update User USD Balance**
```http
POST /api/users/internal/:userId/usd-balance
Content-Type: application/json

{
  "amount": 15.50
}
```

## 🔐 **Authentication Requirements**

### **Public User Endpoints**
User conversion endpoints require **User Authentication** (JWT token):

```javascript
headers: {
  'Authorization': `Bearer ${userJwtToken}`,
  'Content-Type': 'application/json'
}
```

### **Internal Service Endpoints**
Internal endpoints require **Service-to-Service authentication**:

```javascript
headers: {
  'Authorization': `Bearer ${SERVICE_SECRET}`,
  'Content-Type': 'application/json'
}
```

## 💸 **Crypto Withdrawal Implementation**

### **Crypto Withdrawal Requirements**
- **Minimum Amount**: $15 USD
- **Source Balance**: User's USD balance only
- **Daily Limit**: Maximum 3 successful withdrawals per 24 hours (includes all withdrawal types: crypto + mobile money)
- **Authentication**: User JWT token required

### **1. Check Withdrawal Limits**

**Endpoint**: `POST /api/users/crypto/check-limits`

**Authorization**: User Authentication Required

**Request Body**:
```json
{
  "usdAmount": 25.00
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "remainingTransactions": 2,
    "usdBalance": 150.75
  }
}
```

**Error Response**:
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "Maximum 3 successful withdrawals per 24 hours exceeded"
  }
}
```

### **2. Create Crypto Withdrawal**

**Endpoint**: `POST /api/payments/crypto/payout`

**Authorization**: User Authentication Required

**Request Body**:
```json
{
  "amount": 25.00,
  "cryptoCurrency": "BTC",
  "cryptoAddress": "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  "description": "Bitcoin withdrawal"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_abc123",
    "payoutId": "payout_xyz789",
    "status": "pending",
    "estimatedConfirmation": "30 minutes"
  }
}
```

**Error Responses**:
```json
{
  "success": false,
  "message": "Minimum withdrawal amount is $15 USD"
}
```
```json
{
  "success": false,
  "message": "Maximum 3 successful withdrawals per 24 hours exceeded"
}
```
```json
{
  "success": false,
  "message": "Insufficient USD balance"
}
```

### **Supported Cryptocurrencies**

**Endpoint**: `GET /api/payments/crypto/currencies`

**Response**:
```json
{
  "success": true,
  "currencies": [
    "BTC", "ETH", "USDT", "USDC", "LTC", "XRP", 
    "ADA", "DOT", "SOL", "MATIC", "TRX", "BCH"
  ]
}
```

### **Crypto Payout Estimate**

**Endpoint**: `GET /api/payments/crypto/estimate`

**Query Parameters**:
- `amount`: USD amount to withdraw
- `currency`: Target cryptocurrency (e.g., "BTC")

**Example**: `GET /api/payments/crypto/estimate?amount=100&currency=BTC`

**Response**:
```json
{
  "success": true,
  "estimate": {
    "cryptoAmount": 0.00234,
    "currency": "BTC",
    "networkFee": 0.0001,
    "exchangeRate": 42735.50,
    "minimumAmount": 0.0001
  }
}
```

## 🚨 **Important Implementation Notes**

### **1. Currency Conversion Logic**
- **Always check user balance** before attempting conversions
- **Use withdrawal rates** for better user experience 
- **Round XAF amounts** to whole numbers (no decimals)
- **Round USD amounts** to 2 decimal places

### **2. Error Handling**
```javascript
try {
  const response = await convertCurrency(userId, amount);
  if (!response.success) {
    // Handle specific error cases
    switch(response.message) {
      case 'Insufficient USD balance':
        showInsufficientBalanceModal();
        break;
      case 'User not found':
        redirectToLogin();
        break;
      default:
        showGenericError(response.message);
    }
  }
} catch (error) {
  showNetworkError();
}
```

### **3. Real-time Balance Updates**
After successful conversions, update both balances in your UI:

```javascript
// After successful USD to XAF conversion
userBalance.fcfa += convertedAmount;
userBalance.usd -= originalAmount;
updateBalanceDisplay();
```

### **4. Validation Rules**

#### **Conversion Minimums**:
- USD to XAF: Minimum 1 USD
- XAF to USD: Minimum 590 XAF

#### **Crypto Withdrawal Requirements**:
- **Minimum**: $15 USD
- **Maximum Transactions**: 3 successful withdrawals per 24 hours (total across all withdrawal types)
- **Balance Check**: Must have sufficient USD balance
- **Authentication**: User must be logged in

### **5. Rate Display**
Always show current exchange rates to users:

```javascript
const getCurrentRates = () => ({
  xafToUsd: {
    rate: 660, // 1 USD = 660 XAF
    formula: 1/660 // XAF amount / 660 = USD amount
  },
  usdToXaf: {
    rate: 590, // 1 USD = 590 XAF (better rate for users)
    formula: 590 // USD amount * 590 = XAF amount
  }
});
```

## 🔄 **Complete Crypto Withdrawal Workflow**

### **Step-by-Step Implementation**

```javascript
// 1. Check if crypto withdrawal is possible
async function checkCryptoWithdrawal(amount, userToken) {
  try {
    const response = await fetch('/api/users/crypto/check-limits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ usdAmount: amount })
    });
    
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error checking withdrawal limits:', error);
    return { allowed: false, reason: 'Network error' };
  }
}

// 2. Execute crypto withdrawal
async function createCryptoWithdrawal(withdrawalData, userToken) {
  try {
    const response = await fetch('/api/payments/crypto/payout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(withdrawalData)
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error creating crypto withdrawal:', error);
    return { success: false, message: 'Network error' };
  }
}

// 3. Complete workflow example
async function handleCryptoWithdrawal(amount, currency, address, userToken) {
  // Step 1: Validate minimum amount
  if (amount < 15) {
    return { success: false, message: 'Minimum withdrawal is $15 USD' };
  }

  // Step 2: Check withdrawal limits
  const limitsCheck = await checkCryptoWithdrawal(amount, userToken);
  if (!limitsCheck.allowed) {
    return { success: false, message: limitsCheck.reason };
  }

  // Step 3: Show user remaining transactions
  console.log(`Remaining transactions today: ${limitsCheck.remainingTransactions}`);
  console.log(`Current USD balance: $${limitsCheck.usdBalance}`);

  // Step 4: Create withdrawal
  const withdrawal = await createCryptoWithdrawal({
    amount,
    cryptoCurrency: currency,
    cryptoAddress: address,
    description: `${currency} withdrawal`
  }, userToken);

  return withdrawal;
}

// Usage example
handleCryptoWithdrawal(25, 'BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', userToken)
  .then(result => {
    if (result.success) {
      console.log('Withdrawal initiated:', result.data.transactionId);
      // Update UI to show pending withdrawal
    } else {
      console.error('Withdrawal failed:', result.message);
      // Show error to user
    }
  });
```

## 📱 **Frontend Integration Examples**

### **React/Vue Component Example**

```javascript
// Currency conversion service for authenticated users
class CurrencyService {
  static async convertUsdToXaf(usdAmount, userToken) {
    const response = await fetch('/api/users/convert-usd-to-xaf', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ usdAmount })
    });
    return response.json();
  }

  static async convertXafToUsd(xafAmount, userToken) {
    const response = await fetch('/api/users/convert-xaf-to-usd', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ xafAmount })
    });
    return response.json();
  }

  static async requestCryptoPayout(payoutData) {
    const response = await fetch('/api/payments/crypto/payout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payoutData)
    });
    return response.json();
  }
}
```

### **Balance Display Component**

```javascript
const BalanceDisplay = ({ user }) => {
  return (
    <div className="balance-cards">
      <div className="balance-card">
        <h3>FCFA Balance</h3>
        <p>{user.balance?.toLocaleString('fr-FR')} FCFA</p>
      </div>
      <div className="balance-card">
        <h3>USD Balance</h3>
        <p>${user.usdBalance?.toFixed(2)} USD</p>
      </div>
    </div>
  );
};
```

## 🔍 **Testing & Debugging**

### **Test NOWPayments Connection**
```http
GET /api/payments/crypto/debug
```

### **Check Withdrawal Limits**
```http
POST /api/users/internal/:userId/withdrawal-limits/check
Content-Type: application/json

{
  "amount": 100
}
```

## 📋 **Quick Reference**

### **Public User Endpoints**
| Operation | Rate/Limit | Endpoint | Auth |
|-----------|------------|----------|------|
| USD → XAF (User) | 1 USD = 590 XAF | `POST /users/convert-usd-to-xaf` | User JWT |
| XAF → USD (User) | 1 USD = 660 XAF | `POST /users/convert-xaf-to-usd` | User JWT |
| Check Crypto Limits | Min $15, Max 3/day | `POST /users/crypto/check-limits` | User JWT |
| Crypto Withdrawal | Min $15, Max 3/day | `POST /payments/crypto/payout` | User JWT |

### **Internal Service Endpoints**
| Operation | Rate | Endpoint | Auth |
|-----------|------|----------|------|
| USD → XAF (Internal) | 1 USD = 590 XAF | `POST /users/internal/:id/convert-usd-to-xaf` | Service |
| XAF → USD (Internal) | 1 USD = 660 XAF | `POST /users/internal/:id/convert-xaf-to-usd` | Service |
| Get Balances | - | `GET /users/internal/:id/{balance,usd-balance}` | Service |

## ⚠️ **Security Considerations**

1. **Never expose** `SERVICE_SECRET` in frontend code
2. **Always validate** amounts on the backend
3. **Implement rate limiting** for conversion requests
4. **Log all conversions** for audit purposes
5. **Use HTTPS** for all API calls
6. **Validate crypto addresses** before sending payouts

---

For additional support or questions, refer to the API documentation or contact the backend development team.