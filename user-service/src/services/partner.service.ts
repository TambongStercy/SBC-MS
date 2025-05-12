import { Types } from 'mongoose';
import { PartnerRepository } from '../database/repositories/partner.repository';
import { PartnerTransactionRepository, PaginatedResponse } from '../database/repositories/partnerTransaction.repository';
import { IPartner } from '../database/models/partner.model';
import PartnerModel from '../database/models/partner.model'; // Import PartnerModel
import { IPartnerTransaction, PartnerTransactionType } from '../database/models/partnerTransaction.model';
import { UserRepository } from '../database/repositories/user.repository'; // To check if user exists
import { paymentService } from './clients/payment.service.client'; // To record actual deposits
import { SubscriptionType } from '../database/models/subscription.model';
import { UserRole, IUser } from '../database/models/user.model'; // Import UserRole and IUser
import logger from '../utils/logger';

const log = logger.getLogger('PartnerService');

export interface PartnerSummaryStats {
    totalActivePartners: number;
    activeSilverPartners: number;
    activeGoldPartners: number;
}

// Define an interface for the response that includes totalPartnerWithdrawals
export interface IPartnerDetailsWithWithdrawals extends IPartner {
    totalPartnerWithdrawals?: number;
}

export class PartnerService {
    private partnerRepository: PartnerRepository;
    private partnerTransactionRepository: PartnerTransactionRepository;
    private userRepository: UserRepository;

    constructor() {
        this.partnerRepository = new PartnerRepository();
        this.partnerTransactionRepository = new PartnerTransactionRepository();
        this.userRepository = new UserRepository();
    }

    /**
     * Allows an admin to make a user a partner or update their partner status.
     * @param actingUserRole The role of the user performing the action.
     * @param targetUserIdString The ID of the user to make a partner.
     * @param pack The partner pack ('silver' | 'gold').
     * @returns The created or updated partner document.
     * @throws Error if acting user is not an admin, user not found, or max partners reached.
     */
    async adminSetUserAsPartner(
        actingUserRole: UserRole,
        targetUserIdString: string,
        pack: 'silver' | 'gold'
    ): Promise<IPartner> {
        log.info(`Admin action: Attempting to set user ${targetUserIdString} as partner with pack ${pack}.`);

        if (actingUserRole !== UserRole.ADMIN) {
            log.warn('Non-admin user attempted to set a user as partner. Denied.');
            throw new Error('Unauthorized: Only admins can set users as partners.');
        }

        const targetUserId = new Types.ObjectId(targetUserIdString);

        const targetUser = await this.userRepository.findById(targetUserId);
        if (!targetUser) {
            log.warn(`Target user ${targetUserIdString} not found. Cannot make partner.`);
            throw new Error('Target user not found.');
        }

        const existingPartner = await this.partnerRepository.findByUserId(targetUserId);
        if (existingPartner) {
            // If partner record exists, update it (e.g., change pack, reactivate)
            log.info(`Target user ${targetUserIdString} is already a partner (ID: ${existingPartner._id}). Updating pack to ${pack} and ensuring active.`);
            const updatedPartner = await this.partnerRepository.update(existingPartner._id as Types.ObjectId, { pack, isActive: true });
            if (!updatedPartner) {
                throw new Error('Failed to update existing partner record.');
            }
            return updatedPartner;
        }

        // If no existing partner record, create a new one
        // The create method in repository already checks for MAX_PARTNERS
        const newPartner = await this.partnerRepository.create({
            user: targetUserId,
            pack,
            isActive: true,
            amount: 0
        });
        log.info(`User ${targetUserIdString} successfully set as partner with ID ${newPartner._id}.`);
        return newPartner;
    }

    /**
     * Allows an admin to remove a user's partner status (deactivate).
     * @param actingUserRole The role of the user performing the action.
     * @param targetUserIdString The ID of the partner to deactivate.
     * @returns The deactivated partner document.
     * @throws Error if acting user is not an admin or partner not found.
     */
    async adminRemovePartnerStatus(
        actingUserRole: UserRole,
        targetUserIdString: string
    ): Promise<IPartner | null> {
        log.info(`Admin action: Attempting to remove partner status for user ${targetUserIdString}.`);

        if (actingUserRole !== UserRole.ADMIN) {
            log.warn('Non-admin user attempted to remove partner status. Denied.');
            throw new Error('Unauthorized: Only admins can remove partner status.');
        }

        const targetUserId = new Types.ObjectId(targetUserIdString);
        const partner = await this.partnerRepository.findByUserId(targetUserId);

        if (!partner) {
            log.warn(`Partner record not found for user ${targetUserIdString}. Cannot remove status.`);
            throw new Error('Partner record not found for the specified user.');
        }

        if (!partner.isActive) {
            log.info(`Partner ${partner._id} for user ${targetUserIdString} is already inactive.`);
            return partner;
        }

        return this.partnerRepository.deactivate(partner._id as Types.ObjectId);
    }

    /**
     * Finds all active partner records for a given list of user IDs.
     * @param userIds - An array of user IDs.
     * @returns A promise that resolves to an array of IPartner documents.
     */
    async getActivePartnersByUserIds(userIds: Types.ObjectId[]): Promise<IPartner[]> {
        log.info(`Fetching active partner details for ${userIds.length} user IDs.`);
        return this.partnerRepository.findActiveByUserIds(userIds);
    }

    async getPartnerByUserId(userIdString: string): Promise<IPartner | null> {
        const userId = new Types.ObjectId(userIdString);
        return this.partnerRepository.findByUserId(userId);
    }

    async getActivePartnerByUserId(userIdString: string): Promise<IPartnerDetailsWithWithdrawals | null> {
        const userId = new Types.ObjectId(userIdString);
        log.info(`Fetching active partner details for user ${userIdString}`);
        const partner = await this.partnerRepository.findActiveByUserId(userId);

        if (!partner) {
            log.warn(`No active partner found for user ${userIdString}`);
            return null;
        }

        try {
            // Assume partner._id is a Types.ObjectId
            const totalWithdrawals = await this.partnerTransactionRepository.sumWithdrawalsByPartnerId(partner._id as Types.ObjectId);

            // Augment the partner object with the total withdrawals
            const partnerDetailsWithWithdrawals: IPartnerDetailsWithWithdrawals = {
                ...(typeof partner.toObject === 'function' ? partner.toObject() : { ...partner }), // Handle Mongoose doc
                totalPartnerWithdrawals: totalWithdrawals
            };

            log.info(`Successfully fetched partner details and total withdrawals (£${totalWithdrawals}) for user ${userIdString}`);
            return partnerDetailsWithWithdrawals;

        } catch (error) {
            log.error(`Error fetching total withdrawals for partner (user: ${userIdString}, partnerId: ${partner._id}):`, error);
            // Decide if you want to return partner details even if withdrawal sum fails, or null
            // Returning details without the sum for now:
            const partnerDetails: IPartnerDetailsWithWithdrawals =
                typeof partner.toObject === 'function' ? partner.toObject() : { ...partner };
            return partnerDetails; // Or throw error / return null based on desired behavior
        }
    }

    async getPartnerTransactions(
        userIdString: string,
        page: number = 1,
        limit: number = 10
    ): Promise<PaginatedResponse<IPartnerTransaction>> {
        const userId = new Types.ObjectId(userIdString);
        return this.partnerTransactionRepository.findByUserId(userId, page, limit);
    }

    /**
     * [Admin] Retrieves a paginated list of all partners.
     * @param page - Page number for pagination.
     * @param limit - Number of items per page.
     * @returns A paginated response of partner documents.
     */
    async adminListPartners(
        page: number = 1,
        limit: number = 10
    ): Promise<PaginatedResponse<IPartner>> {
        log.info(`Admin request: Listing partners. Page: ${page}, Limit: ${limit}`);
        return this.partnerRepository.findAllWithPagination(page, limit);
    }

    /**
     * [Admin] Retrieves summary statistics for active partners.
     * @returns An object containing total active, active silver, and active gold partner counts.
     */
    async getPartnerSummaryStats(): Promise<PartnerSummaryStats> {
        log.info('Admin request: Fetching partner summary stats.');
        try {
            const totalActivePartners = await PartnerModel.countDocuments({ isActive: true }).exec();
            const activeSilverPartners = await PartnerModel.countDocuments({ isActive: true, pack: 'silver' }).exec();
            const activeGoldPartners = await PartnerModel.countDocuments({ isActive: true, pack: 'gold' }).exec();

            return {
                totalActivePartners,
                activeSilverPartners,
                activeGoldPartners,
            };
        } catch (error) {
            log.error('Error fetching partner summary stats:', error);
            throw new Error('Failed to retrieve partner summary statistics.');
        }
    }

    async recordPartnerCommission(details: {
        partner: IPartner;
        commissionAmount: number;
        sourcePaymentSessionId: string;
        sourceSubscriptionType: SubscriptionType;
        referralLevelInvolved: 1 | 2 | 3;
        buyerUserId: string;
        currency?: string;
    }): Promise<void> {
        const {
            partner,
            commissionAmount,
            sourcePaymentSessionId,
            sourceSubscriptionType,
            referralLevelInvolved,
            buyerUserId
        } = details;

        const currency = details.currency || 'XAF';

        if (!partner || !partner._id) {
            log.error('Partner object or partner._id is missing in recordPartnerCommission.');
            throw new Error('Invalid partner details provided for commission recording.');
        }
        const partnerObjectId = partner._id as Types.ObjectId;

        log.info(`Recording partner commission for partner ${partner.user} (ID: ${partnerObjectId}), amount: ${commissionAmount} ${currency}.`);

        try {

            await paymentService.recordInternalDeposit({
                userId: partner.user.toString(),
                amount: commissionAmount,
                currency: currency,
                description: `Partner commission (L${referralLevelInvolved}) from user ${buyerUserId}'s ${sourceSubscriptionType} subscription.`,
                metadata: {
                    isPartnerCommission: true,
                    partnerId: partnerObjectId.toString(),
                    sourceUserId: buyerUserId,
                    sourcePaymentSessionId: sourcePaymentSessionId,
                    sourceSubscriptionType: sourceSubscriptionType,
                    referralLevelInvolved: referralLevelInvolved,
                    partnerPack: partner.pack
                }
            });
            log.info(`Successfully recorded internal deposit for partner ${partnerObjectId} via paymentService.`);

            const updatedPartner = await this.partnerRepository.addAmount(partnerObjectId, commissionAmount);
            if (!updatedPartner) {
                log.error(`Failed to update partner amount for partner ${partnerObjectId} after successful deposit. This is an inconsistency!`);
                throw new Error('Failed to update partner internal balance after deposit.');
            }
            log.info(`Successfully updated partner ${partnerObjectId} internal balance to ${updatedPartner.amount}.`);

            await this.partnerTransactionRepository.create({
                partnerId: partnerObjectId,
                user: partner.user as Types.ObjectId,
                pack: partner.pack,
                transType: PartnerTransactionType.DEPOSIT,
                message: `Received L${referralLevelInvolved} partner commission of ${commissionAmount} ${currency} from user ${buyerUserId}'s ${sourceSubscriptionType} subscription purchase/upgrade.`,
                amount: commissionAmount,
                sourcePaymentSessionId,
                sourceSubscriptionType,
                referralLevelInvolved
            });
            log.info(`Successfully created partner transaction record for partner ${partnerObjectId}.`);

        } catch (error) {
            log.error(`Error in recordPartnerCommission for partner ${partnerObjectId}, amount ${commissionAmount}:`, error);
            throw error;
        }
    }
}

export const partnerService = new PartnerService(); 