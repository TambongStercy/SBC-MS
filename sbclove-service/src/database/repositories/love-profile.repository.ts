import { FilterQuery, Types, SortOrder } from 'mongoose';
import LoveProfileModel, { ILoveProfile } from '../models/love-profile.model';
import { ProfileStatus } from '../../types/sbclove.enums';
import logger from '../../utils/logger';

const log = logger.getLogger('LoveProfileRepository');

export class LoveProfileRepository {

    async create(data: Partial<ILoveProfile>): Promise<ILoveProfile> {
        try {
            const profile = await LoveProfileModel.create(data);
            log.info(`Created LoveProfile ${profile._id} for user ${profile.userId}`);
            return profile;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new Error(`A SBCLOVE profile already exists for user ${data.userId}.`);
            }
            log.error(`Error creating LoveProfile: ${error.message}`, { data });
            throw error;
        }
    }

    async findById(id: string | Types.ObjectId): Promise<ILoveProfile | null> {
        return LoveProfileModel.findById(id).lean<ILoveProfile>().exec();
    }

    async findByUserId(userId: string | Types.ObjectId): Promise<ILoveProfile | null> {
        return LoveProfileModel.findOne({ userId }).lean<ILoveProfile>().exec();
    }

    async findOne(query: FilterQuery<ILoveProfile>): Promise<ILoveProfile | null> {
        return LoveProfileModel.findOne(query).lean<ILoveProfile>().exec();
    }

    async find(
        query: FilterQuery<ILoveProfile>,
        limit: number = 20,
        skip: number = 0,
        sort: { [key: string]: SortOrder } = { createdAt: -1 }
    ): Promise<ILoveProfile[]> {
        return LoveProfileModel.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean<ILoveProfile[]>()
            .exec();
    }

    async count(query: FilterQuery<ILoveProfile>): Promise<number> {
        return LoveProfileModel.countDocuments(query).exec();
    }

    async updateByUserId(userId: string | Types.ObjectId, data: Partial<ILoveProfile>): Promise<ILoveProfile | null> {
        return LoveProfileModel.findOneAndUpdate({ userId }, data, { new: true }).lean<ILoveProfile>().exec();
    }

    async updateById(id: string | Types.ObjectId, data: Partial<ILoveProfile>): Promise<ILoveProfile | null> {
        return LoveProfileModel.findByIdAndUpdate(id, data, { new: true }).lean<ILoveProfile>().exec();
    }

    /**
     * Atomically increments the report counter and returns the updated document.
     * Used by the auto-suspension flow (spec §14).
     */
    async incrementReportCount(profileId: string | Types.ObjectId): Promise<ILoveProfile | null> {
        return LoveProfileModel.findByIdAndUpdate(
            profileId,
            { $inc: { 'moderation.reportCount': 1 } },
            { new: true }
        ).lean<ILoveProfile>().exec();
    }

    async setStatus(
        id: string | Types.ObjectId,
        status: ProfileStatus,
        moderation: Partial<ILoveProfile['moderation']> = {}
    ): Promise<ILoveProfile | null> {
        const update: any = { status };
        for (const [k, v] of Object.entries(moderation)) {
            update[`moderation.${k}`] = v;
        }
        return LoveProfileModel.findByIdAndUpdate(id, update, { new: true }).lean<ILoveProfile>().exec();
    }
}

export const loveProfileRepository = new LoveProfileRepository();
