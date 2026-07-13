import { Types } from 'mongoose';
import BlockModel, { IBlock } from '../models/block.model';
import logger from '../../utils/logger';

const log = logger.getLogger('BlockRepository');

export class BlockRepository {

    async create(blockerId: Types.ObjectId | string, blockedUserId: Types.ObjectId | string): Promise<IBlock> {
        try {
            const block = await BlockModel.create({ blockerId, blockedUserId });
            log.info(`User ${blockerId} blocked ${blockedUserId}`);
            return block;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new Error('User already blocked.');
            }
            throw error;
        }
    }

    /** Returns the set of user ids that are blocked-by OR have-blocked the given user. */
    async findRelatedUserIds(userId: Types.ObjectId | string): Promise<string[]> {
        const blocks = await BlockModel.find({
            $or: [{ blockerId: userId }, { blockedUserId: userId }],
        }).lean<IBlock[]>().exec();

        const ids = new Set<string>();
        for (const b of blocks) {
            ids.add(b.blockerId.toString());
            ids.add(b.blockedUserId.toString());
        }
        ids.delete(userId.toString());
        return Array.from(ids);
    }

    async exists(blockerId: Types.ObjectId | string, blockedUserId: Types.ObjectId | string): Promise<boolean> {
        const found = await BlockModel.exists({ blockerId, blockedUserId });
        return !!found;
    }
}

export const blockRepository = new BlockRepository();
