import { Types } from 'mongoose';
import { UserRepository } from '../database/repositories/user.repository';
import { ReferralRepository } from '../database/repositories/referral.repository';
import { SubscriptionRepository } from '../database/repositories/subscription.repository';
import { SponsoredActivationModel, ISponsoredActivation } from '../database/models/sponsored-activation.model';
import { SubscriptionType, SubscriptionStatus } from '../database/models/subscription.model';
import { IUser } from '../database/models/user.model';
import {
    ACTIVATION_PRICES,
    MIN_ACTIVATION_TRANSFER,
    MIN_P2P_ACTIVATION_TRANSFER,
    SponsorableSubscriptionType,
    getActivationPrice,
    canAffordActivation
} from '../config/activation-pricing';
import { paymentService } from './clients/payment.service.client';
import { subscriptionService } from './subscription.service';
import { userService } from './user.service';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';

const log = logger.getLogger('ActivationBalanceService');

// Interface for referral user with subscription status for activation
export interface ActivatableReferral {
    _id: string;
    name: string;
    email: string;
    phoneNumber?: string;
    avatar?: string;
    referralLevel: number;
    hasActiveSubscription: boolean;
    currentSubscriptionType?: SubscriptionType;
    canUpgrade: boolean; // Has CLASSIQUE but not CIBLE
    createdAt: Date;
}

// Interface for sponsored activation history
export interface SponsoredActivationRecord {
    _id: string;
    beneficiary: {
        _id: string;
        name: string;
        email: string;
    };
    subscriptionType: SubscriptionType;
    amount: number;
    transactionId: string;
    createdAt: Date;
}

// Interface for activation balance summary
export interface ActivationBalanceSummary {
    activationBalance: number;
    totalSponsored: number;
    sponsoredCount: number;
}

export class ActivationBalanceService {
    private userRepository: UserRepository;
    private referralRepository: ReferralRepository;
    private subscriptionRepository: SubscriptionRepository;

    constructor() {
        this.userRepository = new UserRepository();
        this.referralRepository = new ReferralRepository();
        this.subscriptionRepository = new SubscriptionRepository();
    }

    /**
     * Get user's activation balance
     */
    async getActivationBalance(userId: string): Promise<number> {
        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) {
            throw new AppError('User not found', 404);
        }
        return user.activationBalance || 0;
    }

    /**
     * Get activation balance summary with stats
     */
    async getActivationBalanceSummary(userId: string): Promise<ActivationBalanceSummary> {
        const userObjectId = new Types.ObjectId(userId);

        const [user, sponsoredActivations] = await Promise.all([
            this.userRepository.findById(userObjectId),
            SponsoredActivationModel.find({ sponsor: userObjectId })
        ]);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        const totalSponsored = sponsoredActivations.reduce((sum, s) => sum + s.amount, 0);

        return {
            activationBalance: user.activationBalance || 0,
            totalSponsored,
            sponsoredCount: sponsoredActivations.length
        };
    }

    /**
     * Transfer funds from main balance to activation balance
     * Records transaction in payment-service for history
     */
    async transferToActivationBalance(
        userId: string,
        amount: number,
        ipAddress?: string
    ): Promise<{ newActivationBalance: number; transactionId: string }> {
        log.info(`Transferring ${amount} XAF from main balance to activation balance for user ${userId}`);

        // Validate amount
        if (amount < MIN_ACTIVATION_TRANSFER) {
            throw new AppError(`Minimum transfer amount is ${MIN_ACTIVATION_TRANSFER} XAF`, 400);
        }

        // Get user and verify balance
        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (user.balance < amount) {
            throw new AppError(`Insufficient balance. Available: ${user.balance} XAF, Required: ${amount} XAF`, 400);
        }

        // Perform the transfer (atomic operation)
        const updatedUser = await this.userRepository.transferToActivationBalance(userId, amount);
        if (!updatedUser) {
            throw new AppError('Failed to transfer funds. Please try again.', 500);
        }

        // Record transaction in payment service for history
        let transactionId = '';
        try {
            const txResult = await paymentService.recordActivationTransaction({
                userId,
                type: 'activation_transfer_in',
                amount,
                description: `Transfert de ${amount} XAF vers le solde d'activation`,
                metadata: {
                    previousBalance: user.balance,
                    newBalance: updatedUser.balance,
                    previousActivationBalance: user.activationBalance || 0,
                    newActivationBalance: updatedUser.activationBalance
                },
                ipAddress
            });
            transactionId = txResult.transactionId;
            log.info(`Activation transfer transaction recorded: ${transactionId}`);
        } catch (error: any) {
            log.error(`Failed to record activation transfer transaction: ${error.message}`);
            // Transaction still succeeded, just logging failed - continue
        }

        log.info(`Successfully transferred ${amount} XAF to activation balance for user ${userId}. New activation balance: ${updatedUser.activationBalance}`);

        return {
            newActivationBalance: updatedUser.activationBalance,
            transactionId
        };
    }

    /**
     * Transfer activation balance to another user's activation balance (P2P)
     * Records transaction in payment-service for both users
     */
    async transferActivationToUser(
        fromUserId: string,
        toUserId: string,
        amount: number,
        ipAddress?: string
    ): Promise<{ fromNewBalance: number; transactionId: string }> {
        log.info(`P2P activation transfer: ${amount} XAF from ${fromUserId} to ${toUserId}`);

        // Validate amount
        if (amount < MIN_P2P_ACTIVATION_TRANSFER) {
            throw new AppError(`Minimum P2P transfer amount is ${MIN_P2P_ACTIVATION_TRANSFER} XAF`, 400);
        }

        // Validate users exist
        const [fromUser, toUser] = await Promise.all([
            this.userRepository.findById(new Types.ObjectId(fromUserId)),
            this.userRepository.findById(new Types.ObjectId(toUserId))
        ]);

        if (!fromUser) {
            throw new AppError('Sender not found', 404);
        }
        if (!toUser) {
            throw new AppError('Recipient not found', 404);
        }

        // Verify sender has sufficient activation balance
        if ((fromUser.activationBalance || 0) < amount) {
            throw new AppError(
                `Insufficient activation balance. Available: ${fromUser.activationBalance || 0} XAF, Required: ${amount} XAF`,
                400
            );
        }

        // Perform the transfer (atomic MongoDB transaction)
        const result = await this.userRepository.transferActivationBetweenUsers(fromUserId, toUserId, amount);
        if (!result.success) {
            throw new AppError('Failed to transfer activation balance. Please try again.', 500);
        }

        // Record transactions in payment service for both users
        let transactionId = '';
        try {
            // Record outgoing transaction for sender
            const txResult = await paymentService.recordActivationTransaction({
                userId: fromUserId,
                type: 'activation_transfer_out',
                amount,
                description: `Transfert de ${amount} XAF du solde d'activation à ${toUser.name}`,
                metadata: {
                    recipientId: toUserId,
                    recipientName: toUser.name,
                    previousBalance: fromUser.activationBalance || 0,
                    newBalance: result.fromUser?.activationBalance
                },
                recipientId: toUserId,
                ipAddress
            });
            transactionId = txResult.transactionId;
            log.info(`P2P activation transfer (outgoing) transaction recorded: ${transactionId}`);

            // Record incoming transaction for recipient
            await paymentService.recordActivationTransaction({
                userId: toUserId,
                type: 'activation_transfer_in',
                amount,
                description: `Reçu ${amount} XAF sur le solde d'activation de ${fromUser.name}`,
                metadata: {
                    senderId: fromUserId,
                    senderName: fromUser.name,
                    previousBalance: toUser.activationBalance || 0,
                    newBalance: result.toUser?.activationBalance
                },
                ipAddress
            });
            log.info(`P2P activation transfer (incoming) transaction recorded for recipient`);
        } catch (error: any) {
            log.error(`Failed to record P2P activation transfer transaction: ${error.message}`);
            // Transfer still succeeded, just logging failed - continue
        }

        log.info(`Successfully transferred ${amount} XAF activation balance from ${fromUserId} to ${toUserId}`);

        return {
            fromNewBalance: result.fromUser?.activationBalance || 0,
            transactionId
        };
    }

    /**
     * Get list of referrals (direct and indirect) that can be activated/upgraded by the sponsor
     */
    async getReferralsForActivation(
        sponsorId: string,
        page: number = 1,
        limit: number = 20,
        filter?: 'all' | 'activatable' | 'upgradable'
    ): Promise<{ referrals: ActivatableReferral[]; total: number; page: number; pages: number }> {
        log.info(`Getting referrals for activation for sponsor ${sponsorId}, filter: ${filter || 'all'}`);

        const sponsorObjectId = new Types.ObjectId(sponsorId);

        // Get all referrals (levels 1, 2, 3) with populated user data
        const referralResult = await this.referralRepository.findAllReferralsByReferrer(
            sponsorObjectId,
            1, // Get first page with high limit to process in memory
            1000, // High limit to get all referrals
            true // Populate referred user
        );

        // Get subscription status for each referred user
        const activatableReferrals: ActivatableReferral[] = [];

        for (const referral of referralResult.referrals) {
            const referredUser = referral.referredUser as IUser;
            if (!referredUser || !referredUser._id) continue;

            // Check subscription status
            const [activeClassique, activeCible] = await Promise.all([
                this.subscriptionRepository.findActiveSubscriptionByType(referredUser._id, SubscriptionType.CLASSIQUE),
                this.subscriptionRepository.findActiveSubscriptionByType(referredUser._id, SubscriptionType.CIBLE)
            ]);

            const hasActiveSubscription = !!(activeClassique || activeCible);
            const currentSubscriptionType = activeCible ? SubscriptionType.CIBLE :
                                           (activeClassique ? SubscriptionType.CLASSIQUE : undefined);
            const canUpgrade = !!(activeClassique && !activeCible);

            const activatable: ActivatableReferral = {
                _id: referredUser._id.toString(),
                name: referredUser.name,
                email: referredUser.email,
                phoneNumber: referredUser.phoneNumber,
                avatar: referredUser.avatar,
                referralLevel: referral.referralLevel,
                hasActiveSubscription,
                currentSubscriptionType,
                canUpgrade,
                createdAt: referral.createdAt
            };

            // Apply filter
            if (filter === 'activatable' && hasActiveSubscription) continue;
            if (filter === 'upgradable' && !canUpgrade) continue;

            activatableReferrals.push(activatable);
        }

        // Apply pagination
        const start = (page - 1) * limit;
        const paginatedReferrals = activatableReferrals.slice(start, start + limit);
        const total = activatableReferrals.length;

        return {
            referrals: paginatedReferrals,
            total,
            page,
            pages: Math.ceil(total / limit)
        };
    }

    /**
     * Sponsor a referral's account activation using activation balance
     * This activates CLASSIQUE, CIBLE, or upgrades from CLASSIQUE to CIBLE
     */
    async sponsorReferralActivation(
        sponsorId: string,
        beneficiaryId: string,
        subscriptionType: SponsorableSubscriptionType,
        ipAddress?: string
    ): Promise<{
        success: boolean;
        subscription: any;
        transactionId: string;
        newActivationBalance: number;
    }> {
        log.info(`Sponsor ${sponsorId} activating ${subscriptionType} for beneficiary ${beneficiaryId}`);

        const sponsorObjectId = new Types.ObjectId(sponsorId);
        const beneficiaryObjectId = new Types.ObjectId(beneficiaryId);

        // 1. Validate sponsor and beneficiary exist
        const [sponsor, beneficiary] = await Promise.all([
            this.userRepository.findById(sponsorObjectId),
            this.userRepository.findById(beneficiaryObjectId)
        ]);

        if (!sponsor) {
            throw new AppError('Sponsor not found', 404);
        }
        if (!beneficiary) {
            throw new AppError('Beneficiary not found', 404);
        }

        // 2. Verify beneficiary is in sponsor's referral chain (direct or indirect)
        const isReferral = await this.verifyIsReferral(sponsorId, beneficiaryId);
        if (!isReferral) {
            throw new AppError('User is not in your referral network. You can only sponsor accounts of users you referred.', 403);
        }

        // 3. Get the activation price
        const price = getActivationPrice(subscriptionType);

        // 4. Verify sponsor has sufficient activation balance
        if (!canAffordActivation(sponsor.activationBalance || 0, subscriptionType)) {
            throw new AppError(
                `Insufficient activation balance. Required: ${price} XAF, Available: ${sponsor.activationBalance || 0} XAF`,
                400
            );
        }

        // 5. Check beneficiary's current subscription status
        const [activeClassique, activeCible] = await Promise.all([
            this.subscriptionRepository.findActiveSubscriptionByType(beneficiaryObjectId, SubscriptionType.CLASSIQUE),
            this.subscriptionRepository.findActiveSubscriptionByType(beneficiaryObjectId, SubscriptionType.CIBLE)
        ]);

        // Validate subscription type based on current status
        if (subscriptionType === 'CLASSIQUE') {
            if (activeClassique || activeCible) {
                throw new AppError('Beneficiary already has an active subscription.', 400);
            }
        } else if (subscriptionType === 'CIBLE') {
            if (activeCible) {
                throw new AppError('Beneficiary already has Pack Ciblé subscription.', 400);
            }
            if (activeClassique) {
                // They should use UPGRADE instead
                throw new AppError('Beneficiary has Classique. Use UPGRADE option instead.', 400);
            }
        } else if (subscriptionType === 'UPGRADE') {
            if (!activeClassique) {
                throw new AppError('Beneficiary does not have Classique subscription to upgrade.', 400);
            }
            if (activeCible) {
                throw new AppError('Beneficiary already has Pack Ciblé subscription.', 400);
            }
        }

        // 6. Deduct from sponsor's activation balance
        const updatedSponsor = await this.userRepository.updateActivationBalance(sponsorId, -price);
        if (!updatedSponsor) {
            throw new AppError('Failed to deduct activation balance. Please try again.', 500);
        }

        // 7. Activate subscription for beneficiary
        // For UPGRADE, we treat it as CIBLE activation (the activateSubscription handles upgrades)
        const actualSubscriptionType = subscriptionType === 'UPGRADE' ? SubscriptionType.CIBLE :
                                       (subscriptionType as unknown as SubscriptionType);

        let subscription;
        try {
            subscription = await subscriptionService.activateSubscription(
                beneficiaryId,
                actualSubscriptionType
            );
        } catch (error: any) {
            // Rollback: restore sponsor's activation balance
            await this.userRepository.updateActivationBalance(sponsorId, price);
            log.error(`Failed to activate subscription, rolled back sponsor's balance: ${error.message}`);
            throw new AppError(`Failed to activate subscription: ${error.message}`, 500);
        }

        if (!subscription) {
            // Rollback: restore sponsor's activation balance
            await this.userRepository.updateActivationBalance(sponsorId, price);
            throw new AppError('Failed to create subscription', 500);
        }

        // 8. Record transaction in payment service
        let transactionId = '';
        try {
            const txResult = await paymentService.recordActivationTransaction({
                userId: sponsorId,
                type: 'sponsor_activation',
                amount: price,
                description: `Activation ${subscriptionType} sponsorisée pour ${beneficiary.name}`,
                metadata: {
                    beneficiaryId,
                    beneficiaryName: beneficiary.name,
                    beneficiaryEmail: beneficiary.email,
                    subscriptionType,
                    subscriptionId: subscription._id.toString(),
                    previousActivationBalance: sponsor.activationBalance || 0,
                    newActivationBalance: updatedSponsor.activationBalance
                },
                recipientId: beneficiaryId,
                ipAddress
            });
            transactionId = txResult.transactionId;
            log.info(`Sponsored activation transaction recorded: ${transactionId}`);
        } catch (error: any) {
            log.error(`Failed to record sponsored activation transaction: ${error.message}`);
            // Continue - activation succeeded
        }

        // 9. Create SponsoredActivation record
        try {
            await SponsoredActivationModel.create({
                sponsor: sponsorObjectId,
                beneficiary: beneficiaryObjectId,
                subscriptionType: actualSubscriptionType,
                amount: price,
                subscription: subscription._id,
                transactionId
            });
            log.info(`SponsoredActivation record created for sponsor ${sponsorId}, beneficiary ${beneficiaryId}`);
        } catch (error: any) {
            log.error(`Failed to create SponsoredActivation record: ${error.message}`);
            // Non-critical, continue
        }

        // 10. Distribute commissions to beneficiary's referrer chain
        // The beneficiary's referrers get commissions, not the sponsor's
        // This is handled the same way as normal subscription payments
        try {
            // Create a mock payment session ID for commission tracking
            const mockPaymentSessionId = `sponsored_${transactionId || Date.now()}`;

            // Use the subscription service's commission distribution method
            // We need to call it manually since we bypassed the normal payment flow
            await this.distributeCommissionsForSponsoredActivation(
                beneficiaryId,
                actualSubscriptionType,
                subscriptionType === 'UPGRADE',
                mockPaymentSessionId
            );
        } catch (error: any) {
            log.error(`Failed to distribute commissions for sponsored activation: ${error.message}`);
            // Non-critical, continue
        }

        log.info(`Successfully sponsored ${subscriptionType} activation for ${beneficiary.name}. New activation balance: ${updatedSponsor.activationBalance}`);

        return {
            success: true,
            subscription,
            transactionId,
            newActivationBalance: updatedSponsor.activationBalance
        };
    }

    /**
     * Verify that a user is in the sponsor's referral chain (level 1, 2, or 3)
     */
    private async verifyIsReferral(sponsorId: string, potentialReferralId: string): Promise<boolean> {
        const sponsorObjectId = new Types.ObjectId(sponsorId);
        const potentialReferralObjectId = new Types.ObjectId(potentialReferralId);

        // Check levels 1, 2, and 3
        const referralResult = await this.referralRepository.findAllReferralsByReferrer(
            sponsorObjectId,
            1,
            1000, // High limit to check all
            false
        );

        return referralResult.referrals.some(
            ref => ref.referredUser.toString() === potentialReferralObjectId.toString()
        );
    }

    /**
     * Distribute commissions to beneficiary's referrer chain
     * Uses the existing commission distribution logic from subscription service
     */
    private async distributeCommissionsForSponsoredActivation(
        beneficiaryId: string,
        subscriptionType: SubscriptionType,
        isUpgrade: boolean,
        sourcePaymentSessionId: string
    ): Promise<void> {
        log.info(`Distributing commissions for sponsored activation of ${subscriptionType} for beneficiary ${beneficiaryId}`);

        const commissionRates = { level1: 0.50, level2: 0.25, level3: 0.125 };

        // Determine commission base amount (XAF only for sponsored activations)
        let commissionBaseAmount = 0;
        if (isUpgrade) {
            commissionBaseAmount = 3000;
        } else if (subscriptionType === SubscriptionType.CIBLE) {
            commissionBaseAmount = 5000;
        } else if (subscriptionType === SubscriptionType.CLASSIQUE) {
            commissionBaseAmount = 2000;
        }

        if (commissionBaseAmount <= 0) {
            log.warn(`No commission to distribute for subscription type: ${subscriptionType}`);
            return;
        }

        // Get beneficiary's referrers (not sponsor's referrers!)
        const referrers = await userService.getReferrerIds(beneficiaryId);
        if (!referrers || Object.keys(referrers).length === 0) {
            log.info(`No referrers found for beneficiary ${beneficiaryId}. Skipping commission distribution.`);
            return;
        }

        const currency = 'XAF';
        const planDesc = isUpgrade ? 'Mise à niveau vers CIBLE (Sponsorisé)' :
                        `Abonnement ${subscriptionType} (Sponsorisé)`;

        // Distribute to each level
        const payoutPromises: Promise<any>[] = [];

        if (referrers.level1) {
            const l1Amount = commissionBaseAmount * commissionRates.level1;
            log.info(`Recording L1 commission deposit of ${l1Amount} ${currency} for referrer ${referrers.level1}`);
            payoutPromises.push(paymentService.recordInternalDeposit({
                userId: referrers.level1,
                amount: l1Amount,
                currency,
                description: `Commission niveau 1 (50%) de ${planDesc}`,
                metadata: {
                    commissionLevel: 1,
                    sourceUserId: beneficiaryId,
                    sourcePaymentSessionId,
                    sourcePlanType: subscriptionType,
                    sourceIsUpgrade: isUpgrade,
                    sponsoredActivation: true
                }
            }));
        }

        if (referrers.level2) {
            const l2Amount = commissionBaseAmount * commissionRates.level2;
            log.info(`Recording L2 commission deposit of ${l2Amount} ${currency} for referrer ${referrers.level2}`);
            payoutPromises.push(paymentService.recordInternalDeposit({
                userId: referrers.level2,
                amount: l2Amount,
                currency,
                description: `Commission niveau 2 (25%) de ${planDesc}`,
                metadata: {
                    commissionLevel: 2,
                    sourceUserId: beneficiaryId,
                    sourcePaymentSessionId,
                    sourcePlanType: subscriptionType,
                    sourceIsUpgrade: isUpgrade,
                    sponsoredActivation: true
                }
            }));
        }

        if (referrers.level3) {
            const l3Amount = commissionBaseAmount * commissionRates.level3;
            log.info(`Recording L3 commission deposit of ${l3Amount} ${currency} for referrer ${referrers.level3}`);
            payoutPromises.push(paymentService.recordInternalDeposit({
                userId: referrers.level3,
                amount: l3Amount,
                currency,
                description: `Commission niveau 3 (12.5%) de ${planDesc}`,
                metadata: {
                    commissionLevel: 3,
                    sourceUserId: beneficiaryId,
                    sourcePaymentSessionId,
                    sourcePlanType: subscriptionType,
                    sourceIsUpgrade: isUpgrade,
                    sponsoredActivation: true
                }
            }));
        }

        await Promise.allSettled(payoutPromises);
        log.info(`Commission distribution completed for sponsored activation of beneficiary ${beneficiaryId}`);
    }

    /**
     * Get sponsored activation history for a sponsor
     */
    async getSponsoredActivationHistory(
        sponsorId: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ activations: SponsoredActivationRecord[]; total: number; page: number; pages: number }> {
        const skip = (page - 1) * limit;
        const sponsorObjectId = new Types.ObjectId(sponsorId);

        const [activations, total] = await Promise.all([
            SponsoredActivationModel.find({ sponsor: sponsorObjectId })
                .populate('beneficiary', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SponsoredActivationModel.countDocuments({ sponsor: sponsorObjectId })
        ]);

        const formattedActivations: SponsoredActivationRecord[] = activations.map(a => ({
            _id: a._id.toString(),
            beneficiary: {
                _id: (a.beneficiary as any)?._id?.toString() || '',
                name: (a.beneficiary as any)?.name || 'Unknown',
                email: (a.beneficiary as any)?.email || ''
            },
            subscriptionType: a.subscriptionType,
            amount: a.amount,
            transactionId: a.transactionId,
            createdAt: a.createdAt
        }));

        return {
            activations: formattedActivations,
            total,
            page,
            pages: Math.ceil(total / limit)
        };
    }

    /**
     * Get pricing information for activation types
     */
    getPricing(): typeof ACTIVATION_PRICES {
        return ACTIVATION_PRICES;
    }

    /**
     * Get minimum transfer amounts
     */
    getMinimumTransferAmounts(): { toActivation: number; p2p: number } {
        return {
            toActivation: MIN_ACTIVATION_TRANSFER,
            p2p: MIN_P2P_ACTIVATION_TRANSFER
        };
    }
}

// Export singleton instance
export const activationBalanceService = new ActivationBalanceService();
