import { Types } from 'mongoose';
import PartnerModel, { IPartner } from '../models/partner.model';
import { PaginatedResponse } from './partnerTransaction.repository';

const MAX_PARTNERS = 28;

export class PartnerRepository {
    async create(data: Partial<IPartner>): Promise<IPartner> {
        const currentPartnerCount = await this.countActivePartners();
        if (currentPartnerCount >= MAX_PARTNERS) {
            throw new Error('Maximum number of partners reached.');
        }
        // Ensure user is set, as it's required and unique
        if (!data.user) {
            throw new Error('User ID is required to create a partner.');
        }
        return PartnerModel.create(data);
    }

    async findByUserId(userId: Types.ObjectId): Promise<IPartner | null> {
        return PartnerModel.findOne({ user: userId }).exec();
    }

    async findActiveByUserId(userId: Types.ObjectId): Promise<IPartner | null> {
        return PartnerModel.findOne({ user: userId, isActive: true }).exec();
    }

    async update(partnerId: Types.ObjectId, updates: Partial<IPartner>): Promise<IPartner | null> {
        return PartnerModel.findByIdAndUpdate(partnerId, updates, { new: true }).exec();
    }

    async countActivePartners(): Promise<number> {
        return PartnerModel.countDocuments({ isActive: true }).exec();
    }

    async addAmount(partnerId: Types.ObjectId, amountToAdd: number): Promise<IPartner | null> {
        return PartnerModel.findByIdAndUpdate(
            partnerId,
            { $inc: { amount: amountToAdd } },
            { new: true }
        ).exec();
    }

    // Consider adding methods for deactivating/reactivating partners if needed
    async deactivate(partnerId: Types.ObjectId): Promise<IPartner | null> {
        return PartnerModel.findByIdAndUpdate(partnerId, { isActive: false }, { new: true }).exec();
    }

    async reactivate(partnerId: Types.ObjectId): Promise<IPartner | null> {
        // Add check if MAX_PARTNERS will be exceeded if reactivating
        const currentPartnerCount = await this.countActivePartners();
        const partnerToReactivate = await PartnerModel.findById(partnerId);
        // Only check limit if the partner is currently inactive and we are trying to activate them
        if (partnerToReactivate && !partnerToReactivate.isActive && currentPartnerCount >= MAX_PARTNERS) {
            throw new Error('Maximum number of partners reached. Cannot reactivate.');
        }
        return PartnerModel.findByIdAndUpdate(partnerId, { isActive: true }, { new: true }).exec();
    }

    /**
     * Finds all active partner records for a given list of user IDs.
     * @param userIds - An array of user IDs.
     * @returns A promise that resolves to an array of IPartner documents.
     */
    async findActiveByUserIds(userIds: Types.ObjectId[]): Promise<IPartner[]> {
        if (!userIds || userIds.length === 0) {
            return [];
        }
        return PartnerModel.find({
            user: { $in: userIds },
            isActive: true
        }).exec();
    }

    async findAllWithPagination(
        page: number = 1,
        limit: number = 10
    ): Promise<PaginatedResponse<IPartner>> {
        const skip = (page - 1) * limit;
        // Find all partners, including inactive ones. Add filter if only active are needed.
        const totalDocs = await PartnerModel.countDocuments({}).exec();
        const docs = await PartnerModel.find({})
            .sort({ createdAt: -1 }) // Default sort, can be changed
            .skip(skip)
            .limit(limit)
            .populate('user', 'name email phoneNumber avatar') // Populate user details
            .exec();

        const totalPages = Math.ceil(totalDocs / limit);

        return {
            docs,
            totalDocs,
            limit,
            page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
        };
    }
} 