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

    /**
     * Atomically flips contactUnlocked false→true exactly once. Returns the
     * updated doc if THIS call performed the flip, or null if it was already
     * unlocked — so concurrent mutual opt-ins send the unlock emails only once.
     */
    /** Records the chat conversation on first open (idempotent). */
    async setConversation(matchId: Types.ObjectId | string, conversationId: string): Promise<void> {
        await MatchModel.updateOne(
            { _id: matchId, conversationId: { $exists: false } },
            { $set: { conversationId, chatOpenedAt: new Date() } }
        ).exec();
    }

    /**
     * Matches and started conversations per user, for a page of users.
     *
     * One aggregation for the whole page instead of two queries per row: an
     * admin list of 50 members would otherwise be 100 round trips. Scoped by
     * $in on the page's ids so it never scans the whole collection.
     */
    async countsByUserIds(userIds: (Types.ObjectId | string)[]): Promise<Map<string, { matches: number; conversations: number }>> {
        const ids = userIds.map(id => (typeof id === 'string' ? new Types.ObjectId(id) : id));
        if (ids.length === 0) return new Map();

        const rows = await MatchModel.aggregate<{ _id: Types.ObjectId; matches: number; conversations: number }>([
            { $match: { $or: [{ userA: { $in: ids } }, { userB: { $in: ids } }] } },
            // One row per participant, so a match counts for both sides.
            { $project: { participant: ['$userA', '$userB'], hasConversation: { $cond: [{ $ifNull: ['$conversationId', false] }, 1, 0] } } },
            { $unwind: '$participant' },
            { $match: { participant: { $in: ids } } },
            { $group: { _id: '$participant', matches: { $sum: 1 }, conversations: { $sum: '$hasConversation' } } },
        ]).exec();

        return new Map(rows.map(r => [r._id.toString(), { matches: r.matches, conversations: r.conversations }]));
    }

    /** Global totals for the admin dashboard: one pass over the collection. */
    async totals(): Promise<{ matches: number; contactUnlocked: number; conversations: number }> {
        const [row] = await MatchModel.aggregate<{ matches: number; contactUnlocked: number; conversations: number }>([
            {
                $group: {
                    _id: null,
                    matches: { $sum: 1 },
                    contactUnlocked: { $sum: { $cond: ['$contactUnlocked', 1, 0] } },
                    conversations: { $sum: { $cond: [{ $ifNull: ['$conversationId', false] }, 1, 0] } },
                },
            },
        ]).exec();
        return { matches: row?.matches ?? 0, contactUnlocked: row?.contactUnlocked ?? 0, conversations: row?.conversations ?? 0 };
    }

    async markContactUnlocked(matchId: Types.ObjectId | string): Promise<IMatch | null> {
        return MatchModel.findOneAndUpdate(
            { _id: matchId, contactUnlocked: false },
            { contactUnlocked: true, contactUnlockedAt: new Date() },
            { new: true }
        ).lean<IMatch>().exec();
    }
}

export const matchRepository = new MatchRepository();
