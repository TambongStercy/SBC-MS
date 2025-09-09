// Crypto pricing configuration for SBC subscriptions
// All prices are in USD as per the new crypto payment structure

export interface CryptoPricing {
    inscription: number; // Registration fee
    level1Commission: number;
    level2Commission: number;
    level3Commission: number;
}

export interface SubscriptionCryptoPricing {
    classique: CryptoPricing;
    cible: CryptoPricing;
    upgrade: CryptoPricing;
}

// Crypto pricing structure in USD
export const CRYPTO_SUBSCRIPTION_PRICING: SubscriptionCryptoPricing = {
    classique: {
        inscription: 4.8, // $4.8 USD but commissions are calculated as 4$
        level1Commission: 2, // $2 USD
        level2Commission: 1, // $1 USD
        level3Commission: 0.5, // $0.5 USD
    },
    cible: {
        inscription: 11.6, // $11.6 USD but commissions are calculated as 10$
        level1Commission: 5, // $5 USD
        level2Commission: 2.5, // $2.5 USD
        level3Commission: 1.25, // $1.25 USD
    },
    upgrade: {
        inscription: 7, // $7 USD (upgrade payment) but commissions are calculated as 6$
        level1Commission: 3, // $3 USD
        level2Commission: 1.5, // $1.5 USD
        level3Commission: 0.75, // $0.75 USD
    }
};

// Currency conversion rates
export const CURRENCY_CONVERSION_RATES = {
    // XAF to USD: 1 USD = 660 XAF (when converting XAF to USD)
    XAF_TO_USD: 1 / 660,
    USD_TO_XAF_DEPOSIT: 660,
    
    // USD to XAF: 1 USD = 500 XAF (when converting USD to XAF - better rate for users)
    USD_TO_XAF_WITHDRAWAL: 500,
    XAF_TO_USD_DEPOSIT: 1 / 500,
};

// Helper functions for currency conversion
export class CurrencyConverter {
    /**
     * Convert XAF to USD (rate: 1 USD = 660 XAF)
     * When users convert XAF to USD
     */
    static xafToUsd(xafAmount: number): number {
        return Math.round((xafAmount * CURRENCY_CONVERSION_RATES.XAF_TO_USD) * 100) / 100;
    }

    /**
     * Convert USD to XAF for deposits/payments (rate: 1 USD = 660 XAF)
     * When system needs to convert USD to XAF for payment processing
     */
    static usdToXafDeposit(usdAmount: number): number {
        return Math.round(usdAmount * CURRENCY_CONVERSION_RATES.USD_TO_XAF_DEPOSIT);
    }

    /**
     * Convert USD to XAF for user conversions (rate: 1 USD = 500 XAF - better rate for users)
     * When users convert USD to XAF
     */
    static usdToXafWithdrawal(usdAmount: number): number {
        return Math.round(usdAmount * CURRENCY_CONVERSION_RATES.USD_TO_XAF_WITHDRAWAL);
    }

    /**
     * Convert XAF to USD for deposits (rate: 1 USD = 500 XAF)
     * When system needs to convert XAF to USD for payment processing
     */
    static xafToUsdDeposit(xafAmount: number): number {
        return Math.round((xafAmount * CURRENCY_CONVERSION_RATES.XAF_TO_USD_DEPOSIT) * 100) / 100;
    }
}