# Sniper Business Center Platform

[... Maintain existing sections ...]

## Core Service Components

### User Management
```mermaid
graph TD
    USER[User Service] --> USERMODEL[UserModel]
    USER --> WITHDRAWAL[WithdrawalLimitModel]
    USER --> REFERRAL[ReferralModel]
    
    classDef user fill:#e3f2fd,stroke:#42a5f5;
    class USERMODEL,REFERRAL,WITHDRAWAL user;

| Model                | Key Features                                  |
|----------------------|----------------------------------------------|
| UserModel            | OTP management, referral codes, balance tracking |
| WithdrawalLimitModel | Daily transaction limits, custom restrictions |
| ReferralModel        | Multi-level tracking, commission calculations |

### Transaction Handling
```mermaid
graph TD
    TXN[Transaction Service] --> TXNMODEL[TransactionModel]
    TXN --> PENDING[PendingModel]
    
    classDef txn fill:#f0f4c3,stroke:#cddc39;
    class TXNMODEL,PENDING txn;

**TransactionModel Features**:
- Multi-currency support
- Status tracking (pending/completed/failed)
- Audit logging
- Dispute resolution workflows

### Administrative Services
```mermaid
graph TD
    ADMIN[Admin Service] --> ADMINMODEL[AdminModel]
    ADMIN --> ADMINTXN[AdminTransactionModel]
    
    classDef admin fill:#ffebee,stroke:#ef5350;
    class ADMINMODEL,ADMINTXN admin;

**AdminModel Capabilities**:
```javascript
adminSchema.methods.deposit = async function(amount) {
  // Admin balance management
  this.balance += amount;
  await AdminTransactionModel.createTransaction(...);
};
```

### Partner Integration
```mermaid
graph TD
    PARTNER[Partner Service] --> PARTNERMODEL[PartnerModel]
    PARTNER --> PARTNERTXN[PartnerTransactionModel]
    
    classDef partner fill:#f3e5f5,stroke:#ab47bc;
    class PARTNERMODEL,PARTNERTXN partner;

**Revenue Sharing Example**:
```javascript
partnerSchema.methods.addAmount = async function(share) {
  this.amount += share;
  await PartnerTransaction.createTransaction(...);
};
```

[Maintain existing architecture diagrams and deployment info...]
