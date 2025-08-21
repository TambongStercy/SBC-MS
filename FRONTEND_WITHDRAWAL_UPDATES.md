# Frontend Updates for Unified Withdrawal System

## Overview
The backend now supports a unified withdrawal system that automatically routes withdrawals based on currency:
- **USD** → Crypto withdrawals (using saved wallet info)
- **XAF/FCFA** → Mobile money withdrawals (using saved momo info)

## API Endpoints Changes

### 1. New Unified Withdrawal Endpoint
**Replace existing withdrawal calls with:**
```
POST /api/transactions/withdraw
```

**Request Body:**
```json
{
  "amount": 25,
  "currency": "USD"  // or "XAF"/"FCFA"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "TXN_123456789",
    "amount": 25,
    "fee": 1.5,
    "total": 26.5,
    "status": "pending",
    "expiresAt": "2025-01-20T10:30:00Z",
    "message": "Withdrawal initiated successfully"
  },
  "message": "USD withdrawal initiated successfully"
}
```

### 2. Crypto Wallet Management Endpoints

#### Get User's Crypto Wallet Info
```
GET /api/users/crypto/wallet
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "cryptoWalletAddress": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "cryptoWalletCurrency": "BTC"
  }
}
```

#### Update User's Crypto Wallet Info
```
PUT /api/users/crypto/wallet
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "cryptoWalletAddress": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "cryptoWalletCurrency": "BTC"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Crypto wallet information updated successfully"
}
```

#### Check Crypto Withdrawal Limits
```
POST /api/users/crypto/check-limits
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "amount": 25,
  "currency": "USD"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "dailyLimit": 3,
    "dailyRemaining": 2,
    "minimumAmount": 15
  }
}
```

## Frontend Implementation Guide

### 1. User Profile/Settings Page Updates

#### Add Crypto Wallet Settings Section
```typescript
interface CryptoWallet {
  cryptoWalletAddress?: string;
  cryptoWalletCurrency?: string;
}

// Supported crypto currencies
const SUPPORTED_CRYPTO_CURRENCIES = [
  { code: 'BTC', name: 'Bitcoin' },
  { code: 'ETH', name: 'Ethereum' },
  { code: 'USDT', name: 'Tether' },
  { code: 'LTC', name: 'Litecoin' },
  // Add more as supported by NOWPayments
];

// Component for crypto wallet settings
const CryptoWalletSettings = () => {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletCurrency, setWalletCurrency] = useState('');
  
  const updateCryptoWallet = async () => {
    try {
      const response = await api.put('/api/users/crypto/wallet', {
        cryptoWalletAddress: walletAddress,
        cryptoWalletCurrency: walletCurrency
      });
      
      if (response.data.success) {
        // Show success message
        showToast('Crypto wallet updated successfully');
      }
    } catch (error) {
      // Handle error
      showToast('Failed to update crypto wallet');
    }
  };
  
  // Form UI here...
};
```

### 2. Withdrawal Page Updates

#### Unified Withdrawal Component
```typescript
interface WithdrawalData {
  amount: number;
  currency: 'USD' | 'XAF';
}

const WithdrawalPage = () => {
  const [selectedCurrency, setSelectedCurrency] = useState<'USD' | 'XAF'>('XAF');
  const [amount, setAmount] = useState(0);
  const [userWallet, setUserWallet] = useState<CryptoWallet | null>(null);
  
  // Fetch user's crypto wallet info on component mount
  useEffect(() => {
    fetchCryptoWallet();
  }, []);
  
  const fetchCryptoWallet = async () => {
    try {
      const response = await api.get('/api/users/crypto/wallet');
      if (response.data.success) {
        setUserWallet(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch crypto wallet');
    }
  };
  
  const checkWithdrawalLimits = async () => {
    if (selectedCurrency === 'USD') {
      try {
        const response = await api.post('/api/users/crypto/check-limits', {
          amount,
          currency: selectedCurrency
        });
        
        return response.data.data;
      } catch (error) {
        throw new Error('Failed to check withdrawal limits');
      }
    }
    // For XAF, use existing momo limits check
  };
  
  const initiateWithdrawal = async () => {
    try {
      // Check if crypto wallet is set up for USD withdrawals
      if (selectedCurrency === 'USD' && (!userWallet?.cryptoWalletAddress || !userWallet?.cryptoWalletCurrency)) {
        showToast('Please set up your crypto wallet first');
        // Redirect to wallet settings
        return;
      }
      
      // Check withdrawal limits
      const limits = await checkWithdrawalLimits();
      if (!limits.allowed) {
        showToast(`Withdrawal not allowed: ${limits.reason}`);
        return;
      }
      
      // Initiate unified withdrawal
      const response = await api.post('/api/transactions/withdraw', {
        amount,
        currency: selectedCurrency
      });
      
      if (response.data.success) {
        // Handle successful initiation
        const { data } = response.data;
        
        if (selectedCurrency === 'USD') {
          // Crypto withdrawal - usually auto-processed
          showToast('Crypto withdrawal initiated successfully');
          // Show transaction details
        } else {
          // Momo withdrawal - requires OTP verification
          showToast('Please check your phone for OTP');
          // Navigate to OTP verification
        }
      }
    } catch (error) {
      showToast('Failed to initiate withdrawal');
    }
  };
  
  return (
    <div>
      {/* Currency Selection */}
      <div>
        <label>
          <input 
            type="radio" 
            value="XAF" 
            checked={selectedCurrency === 'XAF'}
            onChange={(e) => setSelectedCurrency(e.target.value as 'XAF')}
          />
          XAF (Mobile Money)
        </label>
        <label>
          <input 
            type="radio" 
            value="USD" 
            checked={selectedCurrency === 'USD'}
            onChange={(e) => setSelectedCurrency(e.target.value as 'USD')}
          />
          USD (Crypto)
        </label>
      </div>
      
      {/* Amount Input */}
      <input 
        type="number" 
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        placeholder={selectedCurrency === 'USD' ? 'Minimum $15' : 'Enter amount'}
      />
      
      {/* Wallet Info Display for USD */}
      {selectedCurrency === 'USD' && (
        <div>
          {userWallet?.cryptoWalletAddress ? (
            <div>
              <p>Withdrawal will be sent to:</p>
              <p><strong>Address:</strong> {userWallet.cryptoWalletAddress}</p>
              <p><strong>Currency:</strong> {userWallet.cryptoWalletCurrency}</p>
              <button onClick={() => {/* Navigate to wallet settings */}}>
                Change Wallet
              </button>
            </div>
          ) : (
            <div>
              <p>Please set up your crypto wallet first</p>
              <button onClick={() => {/* Navigate to wallet settings */}}>
                Set Up Wallet
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Withdrawal Button */}
      <button 
        onClick={initiateWithdrawal}
        disabled={selectedCurrency === 'USD' && !userWallet?.cryptoWalletAddress}
      >
        Withdraw {selectedCurrency}
      </button>
    </div>
  );
};
```

### 3. User Balance Display Updates

```typescript
// Update user balance interface
interface UserBalance {
  balance: number;      // XAF balance
  usdBalance: number;   // USD balance
}

const BalanceDisplay = ({ balance }: { balance: UserBalance }) => {
  return (
    <div>
      <div>
        <h3>XAF Balance</h3>
        <p>{balance.balance.toLocaleString()} FCFA</p>
        <small>Available for mobile money withdrawals</small>
      </div>
      
      <div>
        <h3>USD Balance</h3>
        <p>${balance.usdBalance.toFixed(2)}</p>
        <small>Available for crypto withdrawals</small>
      </div>
    </div>
  );
};
```

### 4. Transaction History Updates

```typescript
// Update transaction interface to handle crypto transactions
interface Transaction {
  transactionId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'PAYMENT';
  amount: number;
  currency: 'XAF' | 'USD';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  method?: 'MOMO' | 'CRYPTO';
  cryptoDetails?: {
    walletAddress: string;
    cryptoCurrency: string;
    transactionHash?: string;
  };
  createdAt: string;
}

const TransactionItem = ({ transaction }: { transaction: Transaction }) => {
  const getMethodDisplay = () => {
    if (transaction.currency === 'USD') {
      return '💰 Crypto';
    } else {
      return '📱 Mobile Money';
    }
  };
  
  return (
    <div>
      <div>
        <span>{getMethodDisplay()}</span>
        <span>{transaction.type}</span>
      </div>
      <div>
        <span>{transaction.amount} {transaction.currency}</span>
        <span>{transaction.status}</span>
      </div>
      {transaction.cryptoDetails && (
        <div>
          <small>To: {transaction.cryptoDetails.walletAddress}</small>
          {transaction.cryptoDetails.transactionHash && (
            <small>Hash: {transaction.cryptoDetails.transactionHash}</small>
          )}
        </div>
      )}
    </div>
  );
};
```

## Key Changes Summary

### ✅ What's New:
1. **Single withdrawal endpoint** for both crypto and momo
2. **Crypto wallet management** in user settings
3. **Automatic routing** based on currency selection
4. **USD balance** separate from XAF balance
5. **Pre-saved wallet info** - no manual entry during withdrawal

### ⚠️ Important Notes:
1. **USD withdrawals** require saved crypto wallet info
2. **Minimum withdrawal** for USD is $15
3. **Daily limit** of 3 successful withdrawals combined (crypto + momo)
4. **Crypto withdrawals** may not require OTP (depending on implementation)
5. **XAF withdrawals** still require OTP verification

### 🔄 Migration Steps:
1. Update withdrawal forms to use new unified endpoint
2. Add crypto wallet settings to user profile
3. Update balance displays to show both currencies
4. Modify transaction history to handle crypto transactions
5. Add currency selection in withdrawal flow
6. Test both withdrawal flows thoroughly

### 🎨 UI/UX Recommendations:
1. Clear currency selection with explanations
2. Wallet setup wizard for first-time crypto users
3. Balance indicators showing which currency is available for which withdrawal type
4. Transaction status indicators that differentiate crypto vs momo processing times
5. Help/FAQ section explaining the dual withdrawal system