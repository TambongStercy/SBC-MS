import { UserRepository } from '../database/repositories/user.repository';
import { SubscriptionRepository, SubscriptionPaginationResponse } from '../database/repositories/subscription.repository';
import { Types } from 'mongoose';
import { SubscriptionType, SubscriptionStatus, ISubscription, SubscriptionCategory, SubscriptionDuration } from '../database/models/subscription.model';
import { CRYPTO_SUBSCRIPTION_PRICING } from '../config/crypto-pricing';
import logger from '../utils/logger';
// Import the payment service client
import { paymentService } from './clients/payment.service.client';
import config from '../config';
import { userService } from './user.service'; // Import userService to get referrers
import { partnerService } from './partner.service'; // Import partnerService
// import { AppError } from '../utils/AppError'; // AppError not found, using Error for now

// --- Subscription Plan Definitions ---
// In a real app, load this from config, database, or a dedicated service
interface SubscriptionPlan {
    id: SubscriptionType; // Use enum values as ID
    name: string;
    type: SubscriptionType;
    price: number;
    currency: string;
    description: string; // Add description
    targetingLevel?: 'country' | 'all'; // Describe targeting (optional - not all plans have this)
    category: SubscriptionCategory; // NEW: registration or feature
    duration: SubscriptionDuration; // NEW: lifetime or monthly
}

// XAF pricing for traditional payments (Mobile Money, etc.)
const AVAILABLE_PLANS_XAF: SubscriptionPlan[] = [
    {
        id: SubscriptionType.CLASSIQUE,
        name: 'Abonnement Classique',
        type: SubscriptionType.CLASSIQUE,
        price: 2070,
        currency: 'XAF',
        description: 'Permet le ciblage des contacts par pays.',
        targetingLevel: 'country',
        category: SubscriptionCategory.REGISTRATION,
        duration: SubscriptionDuration.LIFETIME,
    },
    {
        id: SubscriptionType.CIBLE,
        name: 'Abonnement Ciblé',
        type: SubscriptionType.CIBLE,
        price: 5140,
        currency: 'XAF',
        description: 'Permet le ciblage avancé par pays, sexe, langue, âge, profession, centres d\'intérêt et ville.',
        targetingLevel: 'all',
        category: SubscriptionCategory.REGISTRATION,
        duration: SubscriptionDuration.LIFETIME,
    },
    {
        id: SubscriptionType.RELANCE,
        name: 'Abonnement Relance',
        type: SubscriptionType.RELANCE,
        price: 2000,
        currency: 'XAF',
        description: 'Suivi automatique de vos prospects via WhatsApp pendant 7 jours.',
        category: SubscriptionCategory.FEATURE,
        duration: SubscriptionDuration.MONTHLY,
    },
];

// USD pricing for crypto payments (NOWPayments)
const AVAILABLE_PLANS_CRYPTO_USD: SubscriptionPlan[] = [
    {
        id: SubscriptionType.CLASSIQUE,
        name: 'Abonnement Classique (Crypto)',
        type: SubscriptionType.CLASSIQUE,
        price: CRYPTO_SUBSCRIPTION_PRICING.classique.inscription, // $4.8 USD (excluding fees)
        currency: 'USD',
        description: 'Permet le ciblage des contacts par pays.',
        targetingLevel: 'country',
        category: SubscriptionCategory.REGISTRATION,
        duration: SubscriptionDuration.LIFETIME,
    },
    {
        id: SubscriptionType.CIBLE,
        name: 'Abonnement Ciblé (Crypto)',
        type: SubscriptionType.CIBLE,
        price: CRYPTO_SUBSCRIPTION_PRICING.cible.inscription, // $11.6 USD (excluding fees)
        currency: 'USD',
        description: 'Permet le ciblage avancé par pays, sexe, langue, âge, profession, centres d\'intérêt et ville.',
        targetingLevel: 'all',
        category: SubscriptionCategory.REGISTRATION,
        duration: SubscriptionDuration.LIFETIME,
    },
    {
        id: SubscriptionType.RELANCE,
        name: 'Abonnement Relance (Crypto)',
        type: SubscriptionType.RELANCE,
        price: 4.4, // ~2000 XAF / 500 = $4 USD
        currency: 'USD',
        description: 'Suivi automatique de vos prospects via WhatsApp pendant 7 jours.',
        category: SubscriptionCategory.FEATURE,
        duration: SubscriptionDuration.MONTHLY,
    },
];

// Legacy reference for backward compatibility
const AVAILABLE_PLANS = AVAILABLE_PLANS_XAF;
// -------------------------------------------------


// Define a far future date for lifetime subscriptions
const LIFETIME_END_DATE = new Date('9999-12-31T23:59:59.999Z');

export class SubscriptionService {
    private userRepository: UserRepository;
    private subscriptionRepository: SubscriptionRepository;
    private log = logger.getLogger('SubscriptionService');

    constructor() {
        this.userRepository = new UserRepository();
        this.subscriptionRepository = new SubscriptionRepository();
    }

    /**
     * Check if a user has any active subscription
     * @param userId The user ID to check
     * @returns Boolean indicating if the user has an active subscription
     */
    async hasActiveSubscription(userId: string): Promise<boolean> {
        try {
            const activeSubscriptions = await this.subscriptionRepository.findActiveByUser(new Types.ObjectId(userId));
            return activeSubscriptions.length > 0;
        } catch (error) {
            this.log.error(`Error checking active subscription for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Check if a user has an active contact plan subscription
     * @param userId The user ID to check
     * @returns Boolean indicating if the user has an active contact plan
     */
    async hasContactPlanSubscription(userId: string): Promise<boolean> {
        try {
            // Check specifically for CONTACT_PLAN subscription type
            const subscription = await this.subscriptionRepository.findActiveSubscriptionByType(
                new Types.ObjectId(userId),
                SubscriptionType.CIBLE
            );
            return subscription !== null;
        } catch (error) {
            this.log.error(`Error checking contact plan subscription for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Get all active subscriptions for a user with pagination
     * @param userId The user ID to check
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 10)
     * @returns Paginated active subscriptions
     */
    async getActiveSubscriptions(
        userId: string,
        page: number = 1,
        limit: number = 10
    ): Promise<SubscriptionPaginationResponse> {
        try {
            return await this.subscriptionRepository.findActiveSubscriptions(
                new Types.ObjectId(userId),
                page,
                limit
            );
        } catch (error) {
            this.log.error(`Error getting active subscriptions for user ${userId}:`, error);
            // Return empty result
            return {
                subscriptions: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Get all user subscriptions with pagination
     * @param userId The user ID
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 10)
     * @param category Optional category filter (registration or feature)
     * @returns Paginated subscriptions
     */
    async getUserSubscriptions(
        userId: string,
        page: number = 1,
        limit: number = 10,
        category?: SubscriptionCategory
    ): Promise<SubscriptionPaginationResponse> {
        try {
            return await this.subscriptionRepository.findUserSubscriptions(
                new Types.ObjectId(userId),
                page,
                limit,
                category
            );
        } catch (error) {
            this.log.error(`Error getting subscriptions for user ${userId}:`, error);
            // Return empty result
            return {
                subscriptions: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Get all expired subscriptions for a user with pagination
     * @param userId The user ID
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 10)
     * @returns Paginated expired subscriptions
     */
    async getExpiredSubscriptions(
        userId: string,
        page: number = 1,
        limit: number = 10
    ): Promise<SubscriptionPaginationResponse> {
        try {
            return await this.subscriptionRepository.findExpiredSubscriptions(
                new Types.ObjectId(userId),
                page,
                limit
            );
        } catch (error) {
            this.log.error(`Error getting expired subscriptions for user ${userId}:`, error);
            // Return empty result
            return {
                subscriptions: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Get all subscriptions expiring within a number of days with pagination
     * @param days Number of days to look ahead
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 50)
     * @returns Paginated soon-to-expire subscriptions
     */
    async getExpiringSubscriptions(
        days: number = 7,
        page: number = 1,
        limit: number = 50
    ): Promise<SubscriptionPaginationResponse> {
        try {
            return await this.subscriptionRepository.findExpiringSubscriptions(
                days,
                page,
                limit
            );
        } catch (error) {
            this.log.error(`Error getting expiring subscriptions for next ${days} days:`, error);
            // Return empty result
            return {
                subscriptions: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Check if a user has a specific subscription type
     * @param userId The user ID to check
     * @param subscriptionType The type of subscription to check for
     * @returns Boolean indicating if the user has the specified subscription
     */
    async hasSubscription(userId: string, subscriptionType: SubscriptionType): Promise<boolean> {
        try {
            const subscription = await this.subscriptionRepository.findActiveSubscriptionByType(
                new Types.ObjectId(userId),
                subscriptionType
            );
            return subscription !== null;
        } catch (error) {
            this.log.error(`Error checking subscription type ${subscriptionType} for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Get all active subscription types for a user
     * @param userId The user ID to check
     * @returns Array of active subscription types
     */
    async getActiveSubscriptionTypes(userId: string): Promise<SubscriptionType[]> {
        try {
            const activeSubscriptions = await this.subscriptionRepository.findActiveByUser(new Types.ObjectId(userId));
            // Use Set to get unique types
            const types = new Set(activeSubscriptions.map(sub => sub.subscriptionType));
            return Array.from(types);
        } catch (error) {
            this.log.error(`Error getting active subscription types for user ${userId}:`, error);
            return [];
        }
    }

    /**
     * Retrieves the list of available subscription plans.
     * @param paymentMethod Optional payment method to get specific pricing
     */
    getAvailablePlans(paymentMethod?: 'crypto' | 'traditional'): SubscriptionPlan[] {
        this.log.info(`Retrieving available subscription plans for payment method: ${paymentMethod || 'traditional'}`);
        
        if (paymentMethod === 'crypto') {
            return AVAILABLE_PLANS_CRYPTO_USD;
        }
        
        return AVAILABLE_PLANS_XAF;
    }

    /**
     * Get plan details for a specific subscription type and payment method
     */
    private getPlanDetails(planType: SubscriptionType, paymentMethod?: 'crypto' | 'traditional'): SubscriptionPlan | null {
        const plans = this.getAvailablePlans(paymentMethod);
        return plans.find(p => p.id === planType) || null;
    }

    /**
     * Initiates the purchase process for a specific subscription plan.
     * If purchasing CIBLE while CLASSIQUE is active, triggers the upgrade flow.
     * @param userId The ID of the user purchasing.
     * @param planType The type of plan being purchased (CLASSIQUE or CIBLE).
     * @param paymentMethod Optional payment method ('crypto' for NOWPayments, 'traditional' for Mobile Money)
     * @returns Payment initiation details (sessionId, paymentPageUrl, etc.)
     */
    async initiateSubscriptionPurchase(userId: string, planType: SubscriptionType, paymentMethod?: 'crypto' | 'traditional') {
        this.log.info(`Initiating purchase for plan type '${planType}' by user ${userId} with payment method: ${paymentMethod || 'traditional'}`);

        // 1. Find the requested plan details using planType as the ID
        const plan = this.getPlanDetails(planType, paymentMethod);
        if (!plan) {
            this.log.warn(`Purchase initiation failed: Plan type '${planType}' not found for payment method '${paymentMethod || 'traditional'}'.`);
            throw new Error('Invalid subscription plan selected.');
        }

        // ** Check existing subscriptions **
        const userObjectId = new Types.ObjectId(userId);
        const activeClassiqueSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CLASSIQUE);
        const activeCibleSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CIBLE);

        // ** Handle different purchase scenarios **

        if (planType === SubscriptionType.CIBLE) {
            if (activeCibleSub) {
                // Already has CIBLE - prevent purchase
                this.log.warn(`User ${userId} attempted to buy CIBLE plan while already having CIBLE plan.`);
                throw new Error('You already have an active Abonnement Ciblé subscription.');
            } else if (activeClassiqueSub) {
                // Has CLASSIQUE, no CIBLE -> Trigger upgrade flow
                this.log.info(`User ${userId} buying CIBLE with active CLASSIQUE. Redirecting to upgrade flow.`);
                return this.initiateSubscriptionUpgrade(userId, paymentMethod);
            }
            // Else: No active CIBLE or CLASSIQUE -> Proceed with new CIBLE purchase below

        } else if (planType === SubscriptionType.CLASSIQUE) {
            if (activeCibleSub) {
                // Has CIBLE - prevent CLASSIQUE purchase
                this.log.warn(`User ${userId} attempted to buy CLASSIQUE plan while having CIBLE plan.`);
                throw new Error('You already have the Abonnement Ciblé, which includes these features.');
            } else if (activeClassiqueSub) {
                // Already has CLASSIQUE - prevent purchase
                this.log.warn(`User ${userId} attempted to buy CLASSIQUE plan while already having CLASSIQUE plan.`);
                throw new Error('You already have an active Abonnement Classique subscription.');
            }
            // Else: No active CIBLE or CLASSIQUE -> Proceed with new CLASSIQUE purchase below
        }

        // ** Proceed with NEW subscription purchase (if not handled above) **
        this.log.info(`Proceeding with new ${planType} subscription purchase for user ${userId}.`);

        // 2. Prepare metadata for payment service
        const metadata = {
            userId: userId,
            planId: plan.id, // Use plan.id (which is the SubscriptionType)
            planName: plan.name,
            planType: plan.type,
            isUpgrade: false, // This is a new purchase
            paymentMethod: paymentMethod || 'traditional', // Include payment method
            originatingService: 'user-service',
            callbackPath: `${config.selfBaseUrl}/api/subscriptions/webhooks/payment-confirmation`
        };

        // 3. Get standard XAF pricing for PaymentIntent (payment service will handle crypto conversion)
        const standardPlan = this.getPlanDetails(planType, 'traditional'); // Always get XAF pricing
        if (!standardPlan) {
            throw new Error('Standard XAF plan configuration not found');
        }

        // 4. Call Payment Service Client to create intent with XAF amounts
        try {
            const paymentIntentData = await paymentService.createIntent({
                userId: userId,
                amount: standardPlan.price, // Always use XAF amount (2070 or 5140)
                currency: standardPlan.currency, // Always XAF
                paymentType: 'SUBSCRIPTION',
                metadata: metadata,
            });

            this.log.info(`Payment intent created for plan '${plan.id}' purchase by user ${userId}. Session ID: ${paymentIntentData.sessionId}`);

            // 4. Return payment details
            return {
                message: 'Payment required to activate subscription.',
                planDetails: {
                    id: plan.id,
                    name: plan.name,
                    price: plan.price,
                    currency: plan.currency,
                },
                paymentDetails: paymentIntentData, // Contains sessionId, paymentPageUrl etc.
            };

        } catch (error: any) {
            this.log.error(`Failed to create payment intent for plan '${plan.id}', user ${userId}: ${error.message}`, error);
            throw new Error(`Could not initiate payment for the subscription plan. Reason: ${error.message}`);
        }
    }

    /**
     * Initiates the upgrade process from CLASSIQUE to CIBLE.
     * Checks eligibility and calls payment service for the difference.
     * @param userId The ID of the user upgrading.
     * @param paymentMethod Optional payment method ('crypto' for NOWPayments, 'traditional' for Mobile Money)
     * @returns Payment initiation details.
     */
    async initiateSubscriptionUpgrade(userId: string, paymentMethod?: 'crypto' | 'traditional') {
        this.log.info(`Initiating upgrade to CIBLE for user ${userId} with payment method: ${paymentMethod || 'traditional'}`);
        const userObjectId = new Types.ObjectId(userId);

        // 1. Verify user has active CLASSIQUE subscription
        const classiqueSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CLASSIQUE);
        if (!classiqueSub) {
            this.log.warn(`Upgrade initiation failed: User ${userId} has no active CLASSIQUE subscription.`);
            throw new Error('No active CLASSIQUE subscription found to upgrade from.'); // Send 400 from controller
        }

        // 2. Verify user does not already have active CIBLE subscription
        const cibleSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CIBLE);
        if (cibleSub) {
            this.log.warn(`Upgrade initiation failed: User ${userId} already has an active CIBLE subscription.`);
            throw new Error('You already have the CIBLE subscription.'); // Send 400 from controller
        }

        // 3. Use standard XAF pricing for PaymentIntent creation - payment service will handle crypto conversion
        const upgradePrice = 3070; // Standard XAF amount (includes 70 XAF service fee)
        const currency = 'XAF';
        this.log.info(`Using standard upgrade pricing: ${upgradePrice} ${currency} (payment service will handle crypto conversion if needed)`);

        const targetPlan = this.getPlanDetails(SubscriptionType.CIBLE, paymentMethod);
        if (!targetPlan) {
            this.log.error(`Configuration error: CIBLE plan details not found for payment method '${paymentMethod || 'traditional'}'.`);
            throw new Error('Subscription configuration error.');
        }

        // 4. Prepare metadata for payment service
        const metadata = {
            userId: userId,
            planId: targetPlan.id, // Target plan is CIBLE
            planName: targetPlan.name,
            planType: targetPlan.type,
            isUpgrade: true, // Mark this as an upgrade
            originatingService: 'user-service',
            callbackPath: `${config.selfBaseUrl}/api/subscriptions/webhooks/payment-confirmation`
        };

        // 5. Call Payment Service Client for the upgrade price
        try {
            const paymentIntentData = await paymentService.createIntent({
                userId: userId,
                amount: upgradePrice,
                currency: currency, // Use the determined currency based on payment method
                paymentType: 'SUBSCRIPTION_UPGRADE', // Use a distinct type
                metadata: {
                    ...metadata,
                    paymentMethod: paymentMethod || 'traditional', // Include payment method in metadata
                },
            });

            this.log.info(`Payment intent created for CIBLE upgrade by user ${userId}. Session ID: ${paymentIntentData.sessionId}`);

            // 6. Return payment details
            return {
                message: 'Payment required to upgrade subscription.',
                planDetails: {
                    id: targetPlan.id,
                    name: `Upgrade to ${targetPlan.name}`,
                    price: upgradePrice,
                    currency: currency, // Use the determined currency
                },
                paymentDetails: paymentIntentData,
            };

        } catch (error: any) {
            this.log.error(`Failed to create payment intent for CIBLE upgrade, user ${userId}: ${error.message}`, error);
            throw new Error(`Could not initiate payment for the subscription upgrade. Reason: ${error.message}`);
        }
    }

    /**
     * Handles successful payment confirmation webhook from Payment Service.
     * Activates the user's subscription (handles both new and upgrade).
     * Calculates and distributes referral commissions for CIBLE/Upgrade plans.
     * @param paymentSessionId The session ID from the payment.
     * @param metadata The metadata received in the payment confirmation.
     */
    async handleSubscriptionPaymentSuccess(paymentSessionId: string, metadata: any): Promise<ISubscription | null> {
        this.log.info(`Handling successful payment webhook for subscription. Payment Session ID: ${paymentSessionId}`);

        // 1. Validate Metadata
        this.log.info(`Webhook metadata received:`, { paymentSessionId, metadata });
        const { userId, planId, isUpgrade, planName, paymentMethod } = metadata || {};
        if (!userId || !planId || !(planId in SubscriptionType)) {
            this.log.error('Subscription payment confirmation failed: Missing/invalid required metadata (userId, planId as SubscriptionType).', { paymentSessionId, metadata });
            throw new Error('Invalid payment confirmation metadata for subscription.');
        }
        const targetSubscriptionType = planId as SubscriptionType;

        // 2. Activate the target subscription
        let activatedSubscription: ISubscription | null = null;
        try {
            activatedSubscription = await this.activateSubscription(userId, targetSubscriptionType);
            if (!activatedSubscription) {
                // If activation failed or returned null, we cannot proceed with commission.
                this.log.error(`activateSubscription returned null after successful payment webhook for user ${userId}, type ${targetSubscriptionType}. Cannot distribute commission.`);
                // Depending on policy, maybe throw an error, or just log and return.
                // For now, let's throw to indicate the process couldn't fully complete.
                throw new Error('Subscription activation failed after payment confirmation.');
            }
            this.log.info(`Successfully activated/updated subscription (Type: ${targetSubscriptionType}) for user ${userId} via payment webhook.`);

        } catch (error: any) {
            this.log.error(`Failed to activate subscription for user ${userId} (Type: ${targetSubscriptionType}) after payment webhook: ${error.message}`, { paymentSessionId, metadata, error });
            // Rethrow activation error
            throw new Error(`Failed to activate subscription after successful payment. Please contact support. Details: ${error.message}`);
        }

        // --- 3. Distribute Commissions (Only for CIBLE or Upgrade) ---
        if (targetSubscriptionType === SubscriptionType.CIBLE || isUpgrade || targetSubscriptionType === SubscriptionType.CLASSIQUE) {
            // Using .catch() here so commission failure doesn't break the main webhook acknowledgment
            this.distributeSubscriptionCommission(userId, targetSubscriptionType, isUpgrade, paymentSessionId, planName, paymentMethod, metadata)
                .catch(commissionError => {
                    this.log.error(`Error during background commission distribution for user ${userId}, paymentSession ${paymentSessionId}:`, commissionError);
                    // Consider adding monitoring/alerting for failed commission distributions
                });
        } else {
            this.log.info(`Skipping commission distribution for non-CIBLE/non-Upgrade plan: ${targetSubscriptionType}`);
        }
        // --- End Commission Distribution ---

        // --- 4. Exit user from relance loop if they were in one ---
        const { notificationService } = await import('./clients/notification.service.client');
        notificationService.exitUserFromRelanceLoop(userId)
            .catch(relanceError => {
                this.log.error(`Error exiting user ${userId} from relance loop:`, relanceError);
                // Non-critical error, just log it
            });
        // --- End Relance Exit ---

        // --- 5. Send activation email to the user ---
        const user = await this.userRepository.findById(userId);
        if (user && user.email) {
            const emailSubscriptionType = isUpgrade ? 'UPGRADE' : (targetSubscriptionType as 'CLASSIQUE' | 'CIBLE');
            notificationService.sendAccountActivationEmail({
                email: user.email,
                name: user.name || user.email,
                subscriptionType: emailSubscriptionType,
                language: (user.language?.[0] as 'fr' | 'en') || 'fr'
            }).catch(emailError => {
                this.log.error(`Error sending activation email to user ${userId}:`, emailError);
                // Non-critical error, just log it
            });
        }
        // --- End Activation Email ---

        return activatedSubscription;
    }

    /**
     * Calculates and distributes commissions for a successful CIBLE subscription or upgrade.
     * Calls the payment service to record each commission payout as a deposit transaction.
     */
    private async distributeSubscriptionCommission(
        buyerUserId: string,
        planType: SubscriptionType,
        isUpgrade: boolean,
        sourcePaymentSessionId: string,
        planName?: string,
        paymentMethod?: string,
        webhookMetadata?: any
    ): Promise<void> {

        this.log.info(`Distributing commissions for user ${buyerUserId}, plan ${planType}, isUpgrade: ${isUpgrade}, paymentMethod: ${paymentMethod}`);

        const commissionRates = { level1: 0.50, level2: 0.25, level3: 0.125 };
        const PARTNER_RATES = { silver: 0.18, gold: 0.30 }; // Partner commission rates (updated)

        // New fixed base amounts for partner commissions, in FCFA
        const PARTNER_COMMISSION_BASES = {
            [SubscriptionType.CLASSIQUE]: 250,
            [SubscriptionType.CIBLE]: 625,
            'upgrade': 350 // For upgrades from Classique to Cible
        };

        // Determine if this is a crypto payment - check multiple indicators
        // NOTE: Removed the session ID length check (=== 12) as it was falsely detecting
        // regular CinetPay payment intents as crypto payments
        const isCryptoPayment = paymentMethod === 'nowpayments' ||
            paymentMethod === 'crypto' ||
            sourcePaymentSessionId?.includes('crypto') ||
            sourcePaymentSessionId?.includes('nowpayments') ||
            sourcePaymentSessionId?.toLowerCase().includes('np_') ||
            webhookMetadata?.provider === 'nowpayments';
        
        this.log.info(`Crypto payment detected: ${isCryptoPayment} (method: ${paymentMethod}, sessionId: ${sourcePaymentSessionId}, currency: ${webhookMetadata?.currency})`);

        let commissionBaseAmount = 0; // This is the base for referral levels
        let commissionCurrency = 'XAF'; // Default currency

        let cryptoCommissionAmounts: { level1: number, level2: number, level3: number } | null = null;
        
        if (isCryptoPayment) {
            // Use crypto commission amounts in USD (will deposit to USD balances)
            commissionCurrency = 'USD';
            if (isUpgrade) {
                cryptoCommissionAmounts = {
                    level1: CRYPTO_SUBSCRIPTION_PRICING.upgrade.level1Commission,
                    level2: CRYPTO_SUBSCRIPTION_PRICING.upgrade.level2Commission,
                    level3: CRYPTO_SUBSCRIPTION_PRICING.upgrade.level3Commission
                };
                commissionBaseAmount = CRYPTO_SUBSCRIPTION_PRICING.upgrade.level1Commission + CRYPTO_SUBSCRIPTION_PRICING.upgrade.level2Commission + CRYPTO_SUBSCRIPTION_PRICING.upgrade.level3Commission; // Total commission base for upgrade
            } else if (planType === SubscriptionType.CIBLE) {
                cryptoCommissionAmounts = {
                    level1: CRYPTO_SUBSCRIPTION_PRICING.cible.level1Commission,
                    level2: CRYPTO_SUBSCRIPTION_PRICING.cible.level2Commission,
                    level3: CRYPTO_SUBSCRIPTION_PRICING.cible.level3Commission
                };
                commissionBaseAmount = CRYPTO_SUBSCRIPTION_PRICING.cible.level1Commission + CRYPTO_SUBSCRIPTION_PRICING.cible.level2Commission + CRYPTO_SUBSCRIPTION_PRICING.cible.level3Commission; // Total commission base for cible
            } else if (planType === SubscriptionType.CLASSIQUE) {
                cryptoCommissionAmounts = {
                    level1: CRYPTO_SUBSCRIPTION_PRICING.classique.level1Commission,
                    level2: CRYPTO_SUBSCRIPTION_PRICING.classique.level2Commission,
                    level3: CRYPTO_SUBSCRIPTION_PRICING.classique.level3Commission
                };
                commissionBaseAmount = CRYPTO_SUBSCRIPTION_PRICING.classique.level1Commission + CRYPTO_SUBSCRIPTION_PRICING.classique.level2Commission + CRYPTO_SUBSCRIPTION_PRICING.classique.level3Commission; // Total commission base for classique
            }
            this.log.info(`Using crypto commission amounts: L1=${cryptoCommissionAmounts?.level1}, L2=${cryptoCommissionAmounts?.level2}, L3=${cryptoCommissionAmounts?.level3} ${commissionCurrency}`);
        } else {
            // Use traditional XAF commission amounts
            if (isUpgrade) {
                commissionBaseAmount = 3000; // Fixed upgrade commission base
            } else if (planType === SubscriptionType.CIBLE) {
                commissionBaseAmount = 5000; // New CIBLE subscription commission base
            } else if (planType === SubscriptionType.CLASSIQUE) {
                commissionBaseAmount = 2000; // New CLASSIQUE subscription commission base
            }
            this.log.info(`Using traditional commission base: ${commissionBaseAmount} ${commissionCurrency}`);
        }

        if (commissionBaseAmount <= 0) {
            this.log.warn(`distributeSubscriptionCommission called for unexpected planType: ${planType}. Aborting.`);
            return;
        }

        if (commissionBaseAmount <= 0) {
            this.log.warn(`Commission base amount is zero or negative (${commissionBaseAmount}). Skipping distribution.`);
            return;
        }

        try {
            // Fetch referrers (up to 3 levels) using userService
            const referrers = await userService.getReferrerIds(buyerUserId);
            if (!referrers) {
                this.log.info(`No referrers found for user ${buyerUserId}. Skipping commission distribution.`);
                return;
            }

            const currency = commissionCurrency; // Use determined currency (USD for crypto, XAF for traditional)
            const payoutPromises: Promise<any>[] = [];
            const partnerPayoutPromises: Promise<any>[] = []; // For partner commissions

            // Update planDesc logic to handle all cases
            let planDesc: string;
            if (isUpgrade) {
                planDesc = 'Upgrade to CIBLE';
            } else if (planType === SubscriptionType.CIBLE) {
                planDesc = 'CIBLE Subscription';
            } else if (planType === SubscriptionType.CLASSIQUE) {
                planDesc = 'CLASSIQUE Subscription';
            } else {
                planDesc = planName || 'Unknown Subscription'; // Fallback
            }

            // Fetch user names for better descriptions
            const buyerUser = await this.userRepository.findById(buyerUserId);
            const buyerName = buyerUser ? (buyerUser.name || buyerUser.email) : buyerUserId;

            // Fetch referrer names for Level 2 and 3 descriptions
            let level1ReferrerName = '';
            let level2ReferrerName = '';
            if (referrers.level1) {
                const l1User = await this.userRepository.findById(referrers.level1);
                level1ReferrerName = l1User ? (l1User.name || l1User.email || '') : '';
            }
            if (referrers.level2) {
                const l2User = await this.userRepository.findById(referrers.level2);
                level2ReferrerName = l2User ? (l2User.name || l2User.email || '') : '';
            }

            // Calculate individual referral commissions
            let l1Amount = 0, l2Amount = 0, l3Amount = 0;

            // Level 1 - Direct referral
            if (referrers.level1) {
                l1Amount = cryptoCommissionAmounts ? cryptoCommissionAmounts.level1 : commissionBaseAmount * commissionRates.level1;
                const description = `Level 1 (${cryptoCommissionAmounts ? '$' + cryptoCommissionAmounts.level1 : '50%'}) commission from ${planDesc} purchase by ${buyerName}`;
                this.log.info(`Recording L1 commission deposit of ${l1Amount} ${currency} for referrer ${referrers.level1}`);
                payoutPromises.push(paymentService.recordInternalDeposit({
                    userId: referrers.level1,
                    amount: l1Amount,
                    currency: currency,
                    description: description,
                    metadata: {
                        commissionLevel: 1,
                        sourceUserId: buyerUserId,
                        sourcePaymentSessionId: sourcePaymentSessionId,
                        sourcePlanType: planType,
                        sourceIsUpgrade: isUpgrade
                    }
                }));
            }
            // Level 2 - Referral of referral (via L1 referrer)
            if (referrers.level2) {
                l2Amount = cryptoCommissionAmounts ? cryptoCommissionAmounts.level2 : commissionBaseAmount * commissionRates.level2;
                const viaText = level1ReferrerName ? ` (via ${level1ReferrerName})` : '';
                const description = `Level 2 (${cryptoCommissionAmounts ? '$' + cryptoCommissionAmounts.level2 : '25%'}) commission from ${planDesc} purchase by ${buyerName}${viaText}`;
                this.log.info(`Recording L2 commission deposit of ${l2Amount} ${currency} for referrer ${referrers.level2}`);
                payoutPromises.push(paymentService.recordInternalDeposit({
                    userId: referrers.level2,
                    amount: l2Amount,
                    currency: currency,
                    description: description,
                    metadata: {
                        commissionLevel: 2,
                        sourceUserId: buyerUserId,
                        sourcePaymentSessionId: sourcePaymentSessionId,
                        sourcePlanType: planType,
                        sourceIsUpgrade: isUpgrade
                    }
                }));
            }
            // Level 3 - Referral of referral of referral (via L2 referrer)
            if (referrers.level3) {
                l3Amount = cryptoCommissionAmounts ? cryptoCommissionAmounts.level3 : commissionBaseAmount * commissionRates.level3;
                const viaText = level2ReferrerName ? ` (via ${level2ReferrerName})` : '';
                const description = `Level 3 (${cryptoCommissionAmounts ? '$' + cryptoCommissionAmounts.level3 : '12.5%'}) commission from ${planDesc} purchase by ${buyerName}${viaText}`;
                this.log.info(`Recording L3 commission deposit of ${l3Amount} ${currency} for referrer ${referrers.level3}`);
                payoutPromises.push(paymentService.recordInternalDeposit({
                    userId: referrers.level3,
                    amount: l3Amount,
                    currency: currency,
                    description: description,
                    metadata: {
                        commissionLevel: 3,
                        sourceUserId: buyerUserId,
                        sourcePaymentSessionId: sourcePaymentSessionId,
                        sourcePlanType: planType,
                        sourceIsUpgrade: isUpgrade
                    }
                }));
            }

            // Calculate remaining commission for partners
            const totalReferralPayout = l1Amount + l2Amount + l3Amount;
            const remainingForPartners = commissionBaseAmount - totalReferralPayout; // This line's value is now primarily for logging

            this.log.info(`Total referral payout: ${totalReferralPayout} ${currency}. Remaining for partners: ${remainingForPartners} ${currency}.`);

            // The remainingForPartners check below is now more of a logical guard,
            // as partner commissions are based on fixed amounts, not the remainder.
            // It prevents processing if the overall commissionBaseAmount was zero or negative.
            if (commissionBaseAmount > 0) { // Ensure there was a valid base for referral commissions to proceed with partner commissions
                const processPartnerCommission = async (referrerId: string, referralLevel: 1 | 2 | 3) => {
                    if (!referrerId) return; // Should not happen if referrer exists for a level

                    const partnerDetails = await partnerService.getActivePartnerByUserId(referrerId);
                    if (partnerDetails) {
                        const partnerRate = PARTNER_RATES[partnerDetails.pack];

                        let partnerBaseAmount = 0;
                        if (isUpgrade) {
                            partnerBaseAmount = PARTNER_COMMISSION_BASES['upgrade'];
                        } else if (planType === SubscriptionType.CLASSIQUE) {
                            partnerBaseAmount = PARTNER_COMMISSION_BASES[SubscriptionType.CLASSIQUE];
                        } else if (planType === SubscriptionType.CIBLE) {
                            partnerBaseAmount = PARTNER_COMMISSION_BASES[SubscriptionType.CIBLE];
                        } else {
                            this.log.warn(`Unknown plan type ${planType} for partner commission calculation. Using 0 base.`);
                        }

                        const partnerCommissionShare = partnerBaseAmount * partnerRate; // Calculate based on fixed partner base amount

                        if (partnerCommissionShare > 0) {
                            this.log.info(`Referrer ${referrerId} (L${referralLevel}) is a ${partnerDetails.pack} partner. Recording partner commission: ${partnerCommissionShare} ${currency}.`);
                            partnerPayoutPromises.push(
                                partnerService.recordPartnerCommission({
                                    partner: partnerDetails,
                                    commissionAmount: partnerCommissionShare,
                                    sourcePaymentSessionId: sourcePaymentSessionId,
                                    sourceSubscriptionType: planType,
                                    referralLevelInvolved: referralLevel,
                                    buyerUserId: buyerUserId,
                                    currency: currency
                                })
                            );
                        } else {
                            this.log.info(`Partner commission share for L${referralLevel} partner ${referrerId} is zero or less. Skipping.`);
                        }
                    } else {
                        this.log.info(`Referrer ${referrerId} (L${referralLevel}) is not an active partner. No partner commission.`);
                    }
                };

                // Check L1 referrer
                if (referrers.level1 && l1Amount > 0) { // Only if they received a referral commission
                    await processPartnerCommission(referrers.level1, 1);
                }
                // Check L2 referrer
                if (referrers.level2 && l2Amount > 0) {
                    await processPartnerCommission(referrers.level2, 2);
                }
                // Check L3 referrer
                if (referrers.level3 && l3Amount > 0) {
                    await processPartnerCommission(referrers.level3, 3);
                }
            }

            // Wait for all deposit recordings to complete (or fail individually)
            await Promise.allSettled([...payoutPromises, ...partnerPayoutPromises]);
            this.log.info(`Finished commission distribution requests for user ${buyerUserId}, paymentSession ${sourcePaymentSessionId}.`);

        } catch (error) {
            this.log.error(`Error fetching referrers or initiating commission payouts for user ${buyerUserId}, paymentSession ${sourcePaymentSessionId}:`, error);
            // Re-throwing the error here because it's called with .catch() in the parent method
            throw error;
        }
    }

    /**
     * Activates or Upgrades a subscription for a user.
     * Handles overlaps: CIBLE supersedes CLASSIQUE.
     * RELANCE subscriptions are independent monthly subscriptions.
     * @param userId User ID
     * @param type Subscription Type (CLASSIQUE, CIBLE, or RELANCE)
     * @returns The created or existing active subscription document.
     */
    async activateSubscription(userId: string, type: SubscriptionType): Promise<ISubscription | null> {
        this.log.info(`Activating subscription type ${type} for user ${userId}`);
        try {
            const userObjectId = new Types.ObjectId(userId);
            const now = new Date();

            // Handle RELANCE subscription (independent monthly subscription)
            if (type === SubscriptionType.RELANCE) {
                return await this.activateRelanceSubscription(userObjectId, now);
            }

            // 1. Check for existing *active* CIBLE subscription first
            const activeCibleSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CIBLE);

            if (activeCibleSub) {
                // If CIBLE already active, no action needed for either activation type
                this.log.info(`User ${userId} already has an active CIBLE subscription. No changes needed.`);
                return activeCibleSub;
            }

            // 2. If no active CIBLE sub exists, check for active CLASSIQUE
            const activeClassiqueSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CLASSIQUE);

            let result: ISubscription | null = null;
            let subscriptionChanged = false;

            if (type === SubscriptionType.CIBLE) {
                // Activating CIBLE:
                if (activeClassiqueSub) {
                    // Has active CLASSIQUE, no active CIBLE -> Upgrade CLASSIQUE
                    this.log.info(`Upgrading existing CLASSIQUE subscription ${activeClassiqueSub._id} to CIBLE for user ${userId}.`);
                    const updateData = {
                        subscriptionType: SubscriptionType.CIBLE,
                        startDate: now, // Reset start date to reflect upgrade time
                        // Keep endDate as LIFETIME_END_DATE
                        // Add metadata if needed: metadata: { upgradedFrom: 'CLASSIQUE' }
                    };
                    // Use updateById from the repository
                    result = await this.subscriptionRepository.updateById(activeClassiqueSub._id, updateData);
                    subscriptionChanged = true;
                } else {
                    // No active CIBLE or CLASSIQUE exists - Create new CIBLE
                    this.log.info(`Creating new lifetime CIBLE subscription for user ${userId}.`);
                    const newSubscriptionData: Partial<ISubscription> = {
                        user: userObjectId,
                        subscriptionType: SubscriptionType.CIBLE,
                        startDate: now,
                        endDate: LIFETIME_END_DATE, // Lifetime
                        status: SubscriptionStatus.ACTIVE,
                    };
                    result = await this.subscriptionRepository.create(newSubscriptionData as any);
                    subscriptionChanged = true;
                }

            } else if (type === SubscriptionType.CLASSIQUE) {
                // Activating CLASSIQUE:
                if (activeClassiqueSub) {
                    // CLASSIQUE already exists (and CIBLE doesn't), do nothing.
                    this.log.info(`User ${userId} already has an active CLASSIQUE subscription. No changes needed.`);
                    result = activeClassiqueSub;
                } else {
                    // No active CIBLE or CLASSIQUE exists, create new CLASSIQUE.
                    this.log.info(`Creating new lifetime CLASSIQUE subscription for user ${userId}.`);
                    const newSubscriptionData: Partial<ISubscription> = {
                        user: userObjectId,
                        subscriptionType: SubscriptionType.CLASSIQUE,
                        startDate: now,
                        endDate: LIFETIME_END_DATE, // Lifetime
                        status: SubscriptionStatus.ACTIVE,
                    };
                    result = await this.subscriptionRepository.create(newSubscriptionData as any);
                    subscriptionChanged = true;
                }
            }

            // Trigger VCF cache regeneration if subscription changed
            if (subscriptionChanged && result) {
                this.log.info(`Subscription changed for user ${userId}, triggering VCF cache regeneration`);
                this.triggerVCFCacheRegeneration();
            }

            if (!result) {
                // Fallback - should not be reached
                this.log.error(`Unhandled subscription type in activateSubscription: ${type}`);
                return null;
            }

            return result;

        } catch (error) {
            this.log.error(`Error activating subscription type ${type} for user ${userId}:`, error);
            throw error; // Re-throw original error
        }
    }

    /**
     * Activates a RELANCE subscription (monthly recurring)
     * @param userObjectId User's ObjectId
     * @param now Current timestamp
     * @returns The created or existing RELANCE subscription
     */
    private async activateRelanceSubscription(userObjectId: Types.ObjectId, now: Date): Promise<ISubscription | null> {
        this.log.info(`Activating RELANCE subscription for user ${userObjectId.toString()}`);

        // Check for existing active RELANCE subscription
        const activeRelanceSub = await this.subscriptionRepository.findActiveSubscriptionByType(
            userObjectId,
            SubscriptionType.RELANCE
        );

        if (activeRelanceSub) {
            this.log.info(`User ${userObjectId} already has active RELANCE subscription`);
            return activeRelanceSub;
        }

        // Calculate next renewal date (60 days from now / 2 months)
        const nextRenewalDate = new Date(now);
        nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 2);

        // End date is 1 day after renewal for grace period
        const endDate = new Date(nextRenewalDate);
        endDate.setDate(endDate.getDate() + 1);

        // Create new RELANCE subscription
        const newSubscriptionData: Partial<ISubscription> = {
            user: userObjectId,
            subscriptionType: SubscriptionType.RELANCE,
            category: SubscriptionCategory.FEATURE,
            duration: SubscriptionDuration.MONTHLY,
            startDate: now,
            endDate: endDate,
            nextRenewalDate: nextRenewalDate,
            autoRenew: true, // Default to auto-renew
            status: SubscriptionStatus.ACTIVE,
        };

        const result = await this.subscriptionRepository.create(newSubscriptionData as any);
        this.log.info(`Created new RELANCE subscription for user ${userObjectId}`);

        // No VCF cache regeneration needed for RELANCE (feature subscription)
        return result;
    }

    /**
     * Triggers VCF cache regeneration in the background
     * This is called when subscriptions are created, updated, or expired
     */
    private triggerVCFCacheRegeneration(): void {
        // Use setImmediate to trigger regeneration in the next tick (non-blocking)
        setImmediate(async () => {
            try {
                this.log.info('Starting background VCF cache regeneration...');
                const { vcfCacheService } = await import('./vcf-cache.service');
                await vcfCacheService.generateVCFFile();
                this.log.info('Background VCF cache regeneration completed successfully');
            } catch (error: any) {
                this.log.error('Error during background VCF cache regeneration:', error);
                // Don't throw error as this is a background operation
            }
        });
    }
}

// Export an instance if using singleton pattern
export const subscriptionService = new SubscriptionService();