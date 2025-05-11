import { UserRepository } from '../database/repositories/user.repository';
import { SubscriptionRepository, SubscriptionPaginationResponse } from '../database/repositories/subscription.repository';
import { Types } from 'mongoose';
import { SubscriptionType, SubscriptionStatus, ISubscription } from '../database/models/subscription.model';
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
    targetingLevel: 'country' | 'all'; // Describe targeting
}

const AVAILABLE_PLANS: SubscriptionPlan[] = [
    {
        id: SubscriptionType.CLASSIQUE,
        name: 'Abonnement Classique',
        type: SubscriptionType.CLASSIQUE,
        price: 2070,
        currency: 'XAF',
        description: 'Permet le ciblage des contacts par pays.',
        targetingLevel: 'country',
    },
    {
        id: SubscriptionType.CIBLE,
        name: 'Abonnement Ciblé',
        type: SubscriptionType.CIBLE,
        price: 5000,
        currency: 'XAF',
        description: 'Permet le ciblage avancé par pays, sexe, langue, âge, profession, centres d\'intérêt et ville.',
        targetingLevel: 'all',
    },
];
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
     * @returns Paginated subscriptions
     */
    async getUserSubscriptions(
        userId: string,
        page: number = 1,
        limit: number = 10
    ): Promise<SubscriptionPaginationResponse> {
        try {
            return await this.subscriptionRepository.findUserSubscriptions(
                new Types.ObjectId(userId),
                page,
                limit
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
     */
    getAvailablePlans(): SubscriptionPlan[] {
        // Return the new plan definitions
        this.log.info('Retrieving available subscription plans');
        return AVAILABLE_PLANS;
    }

    /**
     * Initiates the purchase process for a specific subscription plan.
     * If purchasing CIBLE while CLASSIQUE is active, triggers the upgrade flow.
     * @param userId The ID of the user purchasing.
     * @param planType The type of plan being purchased (CLASSIQUE or CIBLE).
     * @returns Payment initiation details (sessionId, paymentPageUrl, etc.)
     */
    async initiateSubscriptionPurchase(userId: string, planType: SubscriptionType) {
        this.log.info(`Initiating purchase for plan type '${planType}' by user ${userId}`);

        // 1. Find the requested plan details using planType as the ID
        const plan = AVAILABLE_PLANS.find(p => p.id === planType);
        if (!plan) {
            this.log.warn(`Purchase initiation failed: Plan type '${planType}' not found.`);
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
                return this.initiateSubscriptionUpgrade(userId);
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
            originatingService: 'user-service',
            callbackPath: `${config.selfBaseUrl}/api/subscriptions/webhooks/payment-confirmation`
        };

        // 3. Call Payment Service Client to create intent
        try {
            const paymentIntentData = await paymentService.createIntent({
                userId: userId,
                amount: plan.price,
                currency: plan.currency,
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
     * @returns Payment initiation details.
     */
    async initiateSubscriptionUpgrade(userId: string) {
        this.log.info(`Initiating upgrade to CIBLE for user ${userId}`);
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

        // 3. Define upgrade details
        const upgradePrice = 3000; // Difference: 5000 (CIBLE) - 2000 (CLASSIQUE) ~= 3000
        const targetPlan = AVAILABLE_PLANS.find(p => p.id === SubscriptionType.CIBLE);
        if (!targetPlan) {
            // This should not happen if AVAILABLE_PLANS is correct
            this.log.error('Configuration error: CIBLE plan details not found.');
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
                currency: targetPlan.currency, // Assuming same currency
                paymentType: 'SUBSCRIPTION_UPGRADE', // Use a distinct type
                metadata: metadata,
            });

            this.log.info(`Payment intent created for CIBLE upgrade by user ${userId}. Session ID: ${paymentIntentData.sessionId}`);

            // 6. Return payment details
            return {
                message: 'Payment required to upgrade subscription.',
                planDetails: {
                    id: targetPlan.id,
                    name: `Upgrade to ${targetPlan.name}`,
                    price: upgradePrice,
                    currency: targetPlan.currency,
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
        const { userId, planId, isUpgrade, planName } = metadata || {};
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
            this.distributeSubscriptionCommission(userId, targetSubscriptionType, isUpgrade, paymentSessionId, planName)
                .catch(commissionError => {
                    this.log.error(`Error during background commission distribution for user ${userId}, paymentSession ${paymentSessionId}:`, commissionError);
                    // Consider adding monitoring/alerting for failed commission distributions
                });
        } else {
            this.log.info(`Skipping commission distribution for non-CIBLE/non-Upgrade plan: ${targetSubscriptionType}`);
        }
        // --- End Commission Distribution --- 

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
        planName?: string
    ): Promise<void> {

        this.log.info(`Distributing commissions for user ${buyerUserId}, plan ${planType}, isUpgrade: ${isUpgrade}`);

        const commissionRates = { level1: 0.50, level2: 0.25, level3: 0.125 };
        const PARTNER_RATES = { silver: 0.10, gold: 0.18 }; // Partner commission rates
        let commissionBaseAmount = 0;

        if (isUpgrade) {
            commissionBaseAmount = 3000; // Fixed upgrade commission base
        } else if (planType === SubscriptionType.CIBLE) {
            commissionBaseAmount = 5000; // New CIBLE subscription commission base
        } else if (planType === SubscriptionType.CLASSIQUE) { // Add condition for CLASSIQUE
            commissionBaseAmount = 2000; // New CLASSIQUE subscription commission base (use plan price)
        } else {
            this.log.warn(`distributeSubscriptionCommission called for unexpected planType: ${planType}. Aborting.`);
            return; // Should not happen based on calling logic, but good practice
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

            const currency = 'XAF'; // Assuming XAF for commissions
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

            // Calculate individual referral commissions
            let l1Amount = 0, l2Amount = 0, l3Amount = 0;

            // Level 1
            if (referrers.level1) {
                l1Amount = commissionBaseAmount * commissionRates.level1;
                const description = `Level 1 (50%) commission from ${planDesc} purchase by user ${buyerUserId}`;
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
            // Level 2
            if (referrers.level2) {
                l2Amount = commissionBaseAmount * commissionRates.level2;
                const description = `Level 2 (25%) commission from ${planDesc} purchase by user ${buyerUserId}`;
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
            // Level 3
            if (referrers.level3) {
                l3Amount = commissionBaseAmount * commissionRates.level3;
                const description = `Level 3 (12.5%) commission from ${planDesc} purchase by user ${buyerUserId}`;
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
            const remainingForPartners = commissionBaseAmount - totalReferralPayout;

            this.log.info(`Total referral payout: ${totalReferralPayout} ${currency}. Remaining for partners: ${remainingForPartners} ${currency}.`);

            if (remainingForPartners > 0) {
                const processPartnerCommission = async (referrerId: string, referralLevel: 1 | 2 | 3) => {
                    if (!referrerId) return; // Should not happen if referrer exists for a level

                    const partnerDetails = await partnerService.getActivePartnerByUserId(referrerId);
                    if (partnerDetails) {
                        const partnerRate = PARTNER_RATES[partnerDetails.pack];
                        const partnerCommissionShare = remainingForPartners * partnerRate;

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
     * Activates or Upgrades a LIFETIME subscription for a user.
     * Handles overlaps: CIBLE supersedes CLASSIQUE.
     * If activating CIBLE and CLASSIQUE exists, it upgrades CLASSIQUE.
     * If the user already has an active subscription of the target type or higher, it returns the existing one.
     * Otherwise, it creates a new lifetime subscription or updates the existing CLASSIQUE one.
     * @param userId User ID
     * @param type Subscription Type (CLASSIQUE or CIBLE)
     * @returns The created or existing active subscription document.
     */
    async activateSubscription(userId: string, type: SubscriptionType): Promise<ISubscription | null> {
        this.log.info(`Activating LIFETIME subscription type ${type} for user ${userId}`);
        try {
            const userObjectId = new Types.ObjectId(userId);
            const now = new Date();

            // 1. Check for existing *active* CIBLE subscription first
            const activeCibleSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CIBLE);

            if (activeCibleSub) {
                // If CIBLE already active, no action needed for either activation type
                this.log.info(`User ${userId} already has an active CIBLE subscription. No changes needed.`);
                return activeCibleSub;
            }

            // 2. If no active CIBLE sub exists, check for active CLASSIQUE
            const activeClassiqueSub = await this.subscriptionRepository.findActiveSubscriptionByType(userObjectId, SubscriptionType.CLASSIQUE);

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
                    return await this.subscriptionRepository.updateById(activeClassiqueSub._id, updateData);
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
                    return await this.subscriptionRepository.create(newSubscriptionData as any);
                }

            } else if (type === SubscriptionType.CLASSIQUE) {
                // Activating CLASSIQUE:
                if (activeClassiqueSub) {
                    // CLASSIQUE already exists (and CIBLE doesn't), do nothing.
                    this.log.info(`User ${userId} already has an active CLASSIQUE subscription. No changes needed.`);
                    return activeClassiqueSub;
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
                    return await this.subscriptionRepository.create(newSubscriptionData as any);
                }
            }

            // Fallback - should not be reached
            this.log.error(`Unhandled subscription type in activateSubscription: ${type}`);
            return null;

        } catch (error) {
            this.log.error(`Error activating subscription type ${type} for user ${userId}:`, error);
            throw error; // Re-throw original error
        }
    }
}

// Export an instance if using singleton pattern
export const subscriptionService = new SubscriptionService(); 