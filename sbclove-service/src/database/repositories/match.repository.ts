import { Types } from 'mongoose';
import MatchModel, { IMatch } from '../models/match.model';
import { ContactChoice } from '../../types/sbclove.enums';
import logger from '../../utils/logger';

const log = logger.getLogger('MatchRepository');

/** Returns the two user ids in a canonical (sorted) order. */
export const canonicalPair = (
    a: Types.ObjectId | string,
    b: Types.ObjectId | string
): [Types.ObjectId, Types.ObjectId] => {
    const idA = new Types.ObjectId(a);
    const idB = new Types.ObjectId(b);
    return idA.toString() <= idB.toString() ? [idA, idB] : [idB, idA];
};

export class MatchRepository {

    /**
     * Atomically gets-or-creates the match for a pair and reports whether THIS
     * call created it. The atomic upsert makes concurrent reciprocal interests
     * (A→B and B→A at the same time) converge to a single match with exactly one
     * `created: true` result, so match notifications are sent exactly once.
     */
    async createOrGet(
        userX: Types.ObjectId | string,
        userY: Types.ObjectId | string
    ): Promise<{ match: IMatch; created: boolean }> {
        const [userA, userB] = canonicalPair(userX, userY);
        const res = await MatchModel.findOneAndUpdate(
            { userA, userB },
            {
                $setOnInsert: {
                    userA,
                    userB,
                    participants: [
                        { userId: userA, choice: ContactChoice.PENDING },
                        { userId: userB, choice: ContactChoice.PENDING },
                    ],
                    contactUnlocked: false,
                },
            },
            { upsert: true, new: true, includeResultMetadata: true }
        );
        const created = res.lastErrorObject?.updatedExisting === false;
        if (created) {
            log.info(`Created match ${res.value?._id} between ${userA} and ${userB}`);
        }
        return { match: res.value as IMatch, created };
    }

    async findById(id: Types.ObjectId | string): Promise<IMatch | null> {
        return MatchModel.findById(id).lean<IMatch>().exec();
    }

    async findByPair(a: Types.ObjectId | string, b: Types.ObjectId | string): Promise<IMatch | null> {
        const [userA, userB] = canonicalPair(a, b);
        return MatchModel.findOne({ userA, userB }).lean<IMatch>().exec();
    }

    async findForUser(userId: Types.ObjectId | string, limit = 50, skip = 0): Promise<IMatch[]> {
        return MatchModel.find({ $or: [{ userA: userId }, { userB: userId }] })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean<IMatch[]>()
            .exec();
    }

    /** Sets a single participant's contact choice. Returns the updated match doc. */
    async setParticipantChoice(
        matchId: Types.ObjectId | string,
        userId: Types.ObjectId | string,
        choice: ContactChoice
    ): Promise<IMatch | null> {
        return MatchModel.findOneAndUpdate(
            { _id: matchId, 'participants.userId': userId },
            {
                $set: {
                    'participants.$.choice': choice,
                    'participants.$.choiceUpdatedAt': new Date(),
                },
            },
            { new: true }
        ).lean<IMatch>().exec();
    }

    async markContactUnlocked(matchId: Types.ObjectId | string): Promise<IMatch | null> {
        return MatchModel.findByIdAndUpdate(
            matchId,
            { contactUnlocked: true, contactUnlockedAt: new Date() },
            { new: true }
        ).lean<IMatch>().exec();
    }
}

export const matchRepository = new MatchRepository();
