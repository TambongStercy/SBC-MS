import { Types } from 'mongoose';
import InterestModel, { IInterest } from '../models/interest.model';
import logger from '../../utils/logger';

const log = logger.getLogger('InterestRepository');

export class InterestRepository {

    async create(data: { fromUserId: Types.ObjectId | string; toUserId: Types.ObjectId | string; sessionDate: string }): Promise<IInterest> {
        try {
            const interest = await InterestModel.create(data);
            log.info(`User ${data.fromUserId} expressed interest in ${data.toUserId} (session ${data.sessionDate})`);
            return interest;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new Error('Interest already expressed for this profile.');
            }
            throw error;
        }
    }

    async exists(fromUserId: Types.ObjectId | string, toUserId: Types.ObjectId | string): Promise<boolean> {
        const found = await InterestModel.exists({ fromUserId, toUserId });
        return !!found;
    }

    /** Counts how many interests a user has sent within a given weekly session. */
    async countForSession(fromUserId: Types.ObjectId | string, sessionDate: string): Promise<number> {
        return InterestModel.countDocuments({ fromUserId, sessionDate }).exec();
    }

    async findSentByUser(fromUserId: Types.ObjectId | string, limit = 50, skip = 0): Promise<IInterest[]> {
        return InterestModel.find({ fromUserId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean<IInterest[]>()
            .exec();
    }
}

export const interestRepository = new InterestRepository();
