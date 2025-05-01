// Shared enums based on backend models

// From payment-service/src/database/models/transaction.model.ts
export enum TransactionStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
}

export enum TransactionType {
    DEPOSIT = 'deposit',
    WITHDRAWAL = 'withdrawal',
    TRANSFER = 'transfer',
    PAYMENT = 'payment',
    REFUND = 'refund',
    FEE = 'fee',
}

export enum Currency {
    XAF = 'XAF',
    XOF = 'XOF',
    USD = 'USD',
    EUR = 'EUR',
    GBP = 'GBP',
}

// Add other shared enums here as needed 