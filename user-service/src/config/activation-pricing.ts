/**
 * Activation Balance Pricing Configuration
 *
 * These prices are used when a sponsor activates a referral's account
 * using their activation balance. All prices are in XAF.
 *
 * BEAC Compliance: Activation balance is separate from main balance
 * and can only be used for account activations, not withdrawals.
 */

// Prices for sponsoring account activations (in XAF)
export const ACTIVATION_PRICES = {
    CLASSIQUE: 2150,      // Basic pack inscription
    CIBLE: 5300,          // Pack ciblé (advanced features)
    UPGRADE: 3150,        // Upgrade from CLASSIQUE to CIBLE
    // Pack Winner, same prices as by Mobile Money (config/subscription-products.ts WINNER.price).
    // The one charged depends on the filleul's current pack.
    WINNER: 15900,                  // no pack yet
    WINNER_FROM_CLASSIQUE: 13650,   // Classique -> Winner
    WINNER_FROM_CIBLE: 10600,       // Ciblé -> Winner
} as const;

// Minimum transfer amounts
export const MIN_ACTIVATION_TRANSFER = 100; // Minimum XAF to transfer to activation balance
export const MIN_P2P_ACTIVATION_TRANSFER = 100; // Minimum XAF to transfer to another user's activation balance

// Type for subscription types that can be sponsored
export type SponsorableSubscriptionType = 'CLASSIQUE' | 'CIBLE' | 'UPGRADE' | 'WINNER';

/**
 * Get the activation price for a given subscription type
 * @param type - The subscription type (CLASSIQUE, CIBLE, or UPGRADE)
 * @returns The price in XAF
 */
export function getActivationPrice(type: SponsorableSubscriptionType): number {
    return ACTIVATION_PRICES[type];
}

/**
 * Check if an amount is sufficient for a given subscription type
 * @param amount - The available activation balance
 * @param type - The subscription type to check
 * @returns True if the amount is sufficient
 */
export function canAffordActivation(amount: number, type: SponsorableSubscriptionType): boolean {
    return amount >= ACTIVATION_PRICES[type];
}
