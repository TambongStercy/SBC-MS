import ReferralModel, { IReferral } from '../models/referral.model';
import UserModel, { IUser } from '../models/user.model';
import mongoose, { Types, Document, UpdateWriteOpResult, PipelineStage } from 'mongoose';
import SubscriptionModel, { SubscriptionStatus, SubscriptionCategory, SubscriptionType } from '../models/subscription.model';

// Define document type
type ReferralDocument = Document<unknown, {}, IReferral> & IReferral & { _id: Types.ObjectId };

// Define interface specifically for populated referrer info (guarantees _id)
interface PopulatedReferrerInfo {
    _id: Types.ObjectId;
    name?: string;
    email?: string;
    phoneNumber?: number;
    region?: string;
    avatar?: string;
    // Add other fields from userPopulationFields if needed, mark as optional
}

// Define interface for populated referred user data
export interface PopulatedReferredUserInfo {
    _id: Types.ObjectId;
    name: string;
    email: string;
    phoneNumber?: string; // Optional based on user model/selection
    region?: string;      // Optional based on user model/selection
    avatar?: string;      // Optional based on user model/selection
    referralLevel: number;
    createdAt: Date;
}

// Define interface for grouped referred users
interface GroupedReferredUsers {
    level1: PopulatedReferredUserInfo[];
    level2: PopulatedReferredUserInfo[];
    level3: PopulatedReferredUserInfo[];
}

// Define interface for grouped counts
interface ReferralLevelCounts {
    level1Count: number;
    level2Count: number;
    level3Count: number;
}

// Define pagination response interface for potentially unpopulated results
export interface ReferralPaginationResponse {
    // Can contain IReferral or populated IReferral
    referrals: (IReferral | any)[];
    totalCount: number;
    totalPages: number;
    page: number;
}

// Define interface for populated referred user pagination response (for aggregation methods)
export interface PopulatedReferralPaginationResponse {
    referredUsers: PopulatedReferredUserInfo[];
    totalCount: number;
    totalPages: number;
    page: number;
    hasMore?: boolean; // Useful for infinite scroll type pagination
}

// Define interface for grouped populated referred user pagination response
export interface GroupedPopulatedReferralPaginationResponse {
    referredUsers: GroupedReferredUsers;
    counts: ReferralLevelCounts;
    total: number;
    pages: number;
    currentPage: number;
}

// Define interface for monthly referral data
export interface MonthlyReferralData {
    month: string; // Format: "YYYY-MM"
    monthName: string; // Format: "January", "February", etc.
    level1: number;
    level2: number;
    level3: number;
    total: number;
    level1ActiveSubscribers: number;
    level2ActiveSubscribers: number;
    level3ActiveSubscribers: number;
    totalActiveSubscribers: number;
}

// Define interface for the result of getReferralStats
export interface ReferralStatsResponse {
    totalReferrals: number;
    level1Count: number;
    level2Count: number;
    level3Count: number;
    level1ActiveSubscribers: number;
    level2ActiveSubscribers: number;
    level3ActiveSubscribers: number;
    monthlyData: MonthlyReferralData[];
}

export class ReferralRepository {

    // Fields to select when populating user data
    private userPopulationFields = 'name email phoneNumber region country avatar avatarId _id';

    /**
     * Creates a single new referral record.
     * @param data - Data for the new referral (referrer, referredUser, referralLevel, and optional denormalized fields).
     * @returns The newly created referral document.
     */
    async create(data: {
        referrer: Types.ObjectId;
        referredUser: Types.ObjectId;
        referralLevel: number;
        referredUserName?: string;
        referredUserEmail?: string;
        referredUserPhone?: string;
    }): Promise<IReferral> {
        const referral = new ReferralModel(data);
        return referral.save();
    }

    /**
     * Creates multiple referral records.
     * @param data - An array of referral data objects with optional denormalized fields.
     * @returns An array of the newly created referral documents.
     */
    async createMany(data: {
        referrer: Types.ObjectId;
        referredUser: Types.ObjectId;
        referralLevel: number;
        referredUserName?: string;
        referredUserEmail?: string;
        referredUserPhone?: string;
    }[]): Promise<IReferral[]> {
        return ReferralModel.insertMany(data);
    }

    /**
     * Finds referral records where the specified user was the one being referred.
     * @param referredUserId - The ID of the user who was referred.
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 10)
     * @param populateReferrer - Whether to populate the referrer field.
     * @returns Paginated referral results
     */
    async findByReferredUser(
        referredUserId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10,
        populateReferrer: boolean = false // Added flag
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const queryFilter = { referredUser: referredUserId, archived: { $ne: true } };
        const query = ReferralModel.find(queryFilter)
            .skip(skip)
            .limit(limit);

        if (populateReferrer) {
            query.populate('referrer', this.userPopulationFields);
        }

        const referrals = await query.exec();
        const validReferrals = referrals.filter(ref => !populateReferrer || ref.referrer); // Filter null if populated

        const totalCount = await ReferralModel.countDocuments(queryFilter);

        return {
            referrals: validReferrals, // Return potentially filtered list
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page
        };
    }

    /**
     * Finds the direct (level 1) referrer for a given user and populates their info.
     * @param referredUserId - The ID of the user whose direct referrer is needed.
     * @returns The populated referrer user document (with required _id) or null.
     */
    async findDirectReferrerPopulated(referredUserId: string | Types.ObjectId): Promise<PopulatedReferrerInfo | null> {
        const referral = await ReferralModel.findOne({
            referredUser: referredUserId,
            referralLevel: 1,
            archived: { $ne: true }
        })
            // Use the specific interface for population type
            .populate<{ referrer: PopulatedReferrerInfo }>('referrer', this.userPopulationFields)
            .exec();

        // Return the populated referrer, ensuring it matches the specific interface
        return referral?.referrer ?? null;
    }

    /**
     * Finds users referred by a specific referrer at a given level.
     * @param referrerId - The ID of the referrer.
     * @param level - The referral level (1, 2, or 3).
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 10)
     * @param populateReferredUser - Whether to populate the referredUser field.
     * @returns Paginated referral results
     */
    async findReferralsByReferrerAndLevel(
        referrerId: string | Types.ObjectId,
        level: number,
        page: number = 1,
        limit: number = 10,
        populateReferredUser: boolean = false // Added flag
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const queryFilter = { referrer: referrerId, referralLevel: level, archived: { $ne: true } };

        if (populateReferredUser) {
            // Use aggregation to ensure count matches data when populating users
            const pipeline = [
                { $match: queryFilter },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'referredUser',
                        foreignField: '_id',
                        as: 'referredUserData'
                    }
                },
                {
                    $unwind: {
                        path: '$referredUserData',
                        preserveNullAndEmptyArrays: false // This filters out referrals with no user
                    }
                },
                {
                    $match: {
                        'referredUserData.deleted': { $ne: true },
                        'referredUserData.blocked': { $ne: true }
                    }
                }
            ];

            // Get total count with same filtering
            const countPipeline = [...pipeline, { $count: 'total' }];
            const countResult = await ReferralModel.aggregate(countPipeline);
            const totalCount = countResult[0]?.total || 0;

            // Get paginated data
            const dataPipeline = [
                ...pipeline,
                { $skip: skip },
                { $limit: limit },
                {
                    $addFields: {
                        referredUser: '$referredUserData'
                    }
                },
                {
                    $project: {
                        referredUserData: 0 // Remove the lookup field
                    }
                }
            ];

            const referrals = await ReferralModel.aggregate(dataPipeline);

            return {
                referrals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } else {
            // Original logic for non-populated queries
            const query = ReferralModel.find(queryFilter)
                .skip(skip)
                .limit(limit);

            const referrals = await query.exec();
            const totalCount = await ReferralModel.countDocuments(queryFilter);

            return {
                referrals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        }
    }

    /**
     * Check if a specific referral relationship exists between referrer and referred user
     * Simply finds the document that shows the relationship exists
     */
    async isReferralOf(
        referrerId: string | Types.ObjectId,
        referredUserId: string | Types.ObjectId
    ): Promise<boolean> {
        const referral = await ReferralModel.findOne({
            referrer: referrerId,
            referredUser: referredUserId,
            archived: { $ne: true }
        }).select('_id').lean();
        return !!referral;
    }

    /**
     * Finds all users referred by a specific referrer across all levels (1, 2, 3).
     * @param referrerId - The ID of the referrer.
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 10)
     * @param populateReferredUser - Whether to populate the referredUser field.
     * @returns Paginated referral results
     */
    async findAllReferralsByReferrer(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10,
        populateReferredUser: boolean = false // Added flag
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const queryFilter = { referrer: referrerId, archived: { $ne: true } };

        if (populateReferredUser) {
            // Use aggregation to ensure count matches data when populating users
            const pipeline = [
                { $match: queryFilter },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'referredUser',
                        foreignField: '_id',
                        as: 'referredUserData'
                    }
                },
                {
                    $unwind: {
                        path: '$referredUserData',
                        preserveNullAndEmptyArrays: false // This filters out referrals with no user
                    }
                },
                {
                    $match: {
                        'referredUserData.deleted': { $ne: true },
                        'referredUserData.blocked': { $ne: true }
                    }
                }
            ];

            // Get total count with same filtering
            const countPipeline = [...pipeline, { $count: 'total' }];
            const countResult = await ReferralModel.aggregate(countPipeline);
            const totalCount = countResult[0]?.total || 0;

            // Get paginated data
            const dataPipeline = [
                ...pipeline,
                { $sort: { referralLevel: 1 as const, createdAt: -1 as const } }, // Keep sort order from old model
                { $skip: skip },
                { $limit: limit },
                {
                    $addFields: {
                        referredUser: '$referredUserData'
                    }
                },
                {
                    $project: {
                        referredUserData: 0 // Remove the lookup field
                    }
                }
            ];

            const referrals = await ReferralModel.aggregate(dataPipeline);

            return {
                referrals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } else {
            // Original logic for non-populated queries
            const query = ReferralModel.find(queryFilter)
                .sort({ referralLevel: 1, createdAt: -1 }) // Keep sort order from old model
                .skip(skip)
                .limit(limit);

            const referrals = await query.exec();
            const totalCount = await ReferralModel.countDocuments(queryFilter);

            return {
                referrals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        }
    }

    /**
     * Finds all users referred by a specific referrer across all levels (1, 2, 3),
     * populates referredUser details, and groups them by level.
     * @param referrerId - The ID of the referrer.
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 20) - Increased limit as per old model
     * @returns Paginated and grouped referral results with counts.
     */
    async findAllReferredUsersGroupedPopulated(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20 // Match old model limit
    ): Promise<GroupedPopulatedReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const queryFilter = { referrer: referrerId, archived: { $ne: true } };

        // Find referrals with populated user data
        const referrals = await ReferralModel.find(queryFilter)
            .populate<{ referredUser: IUser }>('referredUser', this.userPopulationFields)
            .sort({ referralLevel: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

        // Filter out referrals with null referredUser (e.g., if user was deleted after referral)
        const validReferrals = referrals.filter(ref => ref.referredUser);

        const total = await ReferralModel.countDocuments(queryFilter);

        // Group by level in code
        const referredByLevel: GroupedReferredUsers = { level1: [], level2: [], level3: [] };
        validReferrals.forEach(ref => {
            const levelKey = `level${ref.referralLevel}` as keyof GroupedReferredUsers;
            if (referredByLevel[levelKey]) {
                // Ensure referredUser exists before accessing its properties
                const user = ref.referredUser;
                referredByLevel[levelKey].push({
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    region: user.region,
                    avatar: user.avatar,
                    referralLevel: ref.referralLevel,
                    createdAt: ref.createdAt
                });
            }
        });

        // Get counts for each level (can reuse getReferralStats logic)
        const stats = await this.getReferralStats(referrerId);

        return {
            referredUsers: referredByLevel,
            counts: {
                level1Count: stats.level1Count,
                level2Count: stats.level2Count,
                level3Count: stats.level3Count
            },
            total,
            pages: Math.ceil(total / limit),
            currentPage: page
        };
    }

    /**
     * Finds users directly referred (level 1) by a specific referrer using aggregation.
     * Populates referredUser details and sorts by name.
     * @param referrerId - The ID of the referrer.
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 20)
     * @returns Paginated referral results including populated user data.
     */
    async findDirectlyReferredUsersPopulated(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<PopulatedReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new mongoose.Types.ObjectId(referrerId.toString());

        const aggregationPipeline: mongoose.PipelineStage[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    referralLevel: 1,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUserData'
                }
            },
            {
                $unwind: {
                    path: '$referredUserData',
                    preserveNullAndEmptyArrays: false // Exclude referrals where user lookup failed
                }
            },
            {
                $match: {
                    'referredUserData.deleted': { $ne: true },
                    'referredUserData.blocked': { $ne: true }
                }
            },
            {
                $addFields: {
                    'nameLower': { $toLower: '$referredUserData.name' }
                }
            },
            { $sort: { 'nameLower': 1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$referredUserData._id',
                    name: '$referredUserData.name',
                    email: '$referredUserData.email',
                    phoneNumber: '$referredUserData.phoneNumber',
                    region: '$referredUserData.region',
                    avatar: '$referredUserData.avatar',
                    referralLevel: '$referralLevel',
                    createdAt: '$createdAt'
                }
            }
        ];

        const referredUsers = await ReferralModel.aggregate<PopulatedReferredUserInfo>(aggregationPipeline);

        // Get total count considering the referred user status filters
        const countPipeline: mongoose.PipelineStage[] = [
            { $match: { referrer: referrerObjectId, referralLevel: 1, archived: { $ne: true } } },
            { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $match: { 'user.deleted': { $ne: true }, 'user.blocked': { $ne: true } } },
            { $count: 'totalCount' }
        ];
        const countResult = await ReferralModel.aggregate<{ totalCount: number }>(countPipeline);
        const totalCount = countResult[0]?.totalCount ?? 0;

        return {
            referredUsers,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page,
            hasMore: totalCount > skip + limit // Add hasMore flag
        };
    }

    /**
     * Finds indirect (level 2 & 3) referred users by a specific referrer using aggregation.
     * Populates referredUser details and sorts by name.
     * @param referrerId - The ID of the referrer.
     * @param page - Page number for pagination (default: 1)
     * @param limit - Number of items per page (default: 20)
     * @returns Paginated referral results including populated user data, grouped by level in the response.
     */
    async findIndirectReferredUsersPopulated(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<PopulatedReferralPaginationResponse & { level2Users: PopulatedReferredUserInfo[], level3Users: PopulatedReferredUserInfo[] }> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new mongoose.Types.ObjectId(referrerId.toString());

        // OPTIMIZED: Use simple indexed queries instead of expensive aggregation with $lookup

        // Phase 1: Get total count (uses compound index, very fast)
        const totalCount = await ReferralModel.countDocuments({
            referrer: referrerObjectId,
            referralLevel: { $in: [2, 3] },
            archived: { $ne: true }
        });

        if (totalCount === 0) {
            return {
                referredUsers: [],
                level2Users: [],
                level3Users: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }

        // Phase 2: Get paginated referrals (uses index, very fast)
        const referrals = await ReferralModel.find({
            referrer: referrerObjectId,
            referralLevel: { $in: [2, 3] },
            archived: { $ne: true }
        })
            .select('referredUser referralLevel createdAt')
            .sort({ referralLevel: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        if (referrals.length === 0) {
            return {
                referredUsers: [],
                level2Users: [],
                level3Users: [],
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        }

        // Phase 3: Batch fetch user data for ONLY these referrals
        const referredUserIds = referrals.map(r => r.referredUser);
        const users = await UserModel.find({
            _id: { $in: referredUserIds },
            deleted: { $ne: true },
            blocked: { $ne: true }
        })
            .select('_id name email phoneNumber region avatar')
            .lean();

        // Create user map for fast lookup
        const userMap = new Map<string, any>();
        for (const user of users) {
            userMap.set(user._id.toString(), user);
        }

        // Phase 4: Combine data
        const referredUsers: PopulatedReferredUserInfo[] = [];
        for (const referral of referrals) {
            const userId = referral.referredUser.toString();
            const user = userMap.get(userId);

            // Skip if user not found (deleted/blocked)
            if (!user) continue;

            referredUsers.push({
                _id: user._id,
                name: user.name || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber,
                region: user.region,
                avatar: user.avatar,
                referralLevel: referral.referralLevel,
                createdAt: referral.createdAt
            });
        }

        // Group by level in code for the response structure matching old model
        const level2Users = referredUsers.filter(u => u.referralLevel === 2);
        const level3Users = referredUsers.filter(u => u.referralLevel === 3);

        return {
            referredUsers: referredUsers,
            level2Users,
            level3Users,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page
        };
    }

    /**
     * Archives all referral records associated with a given user (either as referrer or referred).
     * Useful when soft-deleting a user.
     * @param userId - The ID of the user.
     * @returns MongoDB update result.
     */
    async archiveByUserId(userId: string | Types.ObjectId): Promise<UpdateWriteOpResult> {
        const now = new Date();
        return ReferralModel.updateMany(
            { $or: [{ referrer: userId }, { referredUser: userId }], archived: { $ne: true } }, // Only archive if not already archived
            { $set: { archived: true, archivedAt: now } }
        ).exec();
    }

    /**
     * Updates denormalized user fields on all referrals where the user is the referred user.
     * Call this when a user updates their name, email, or phone number.
     * @param userId - The ID of the user whose info changed.
     * @param updates - The updated user fields.
     * @returns MongoDB update result.
     */
    async updateDenormalizedUserFields(
        userId: string | Types.ObjectId,
        updates: { name?: string; email?: string; phoneNumber?: string | number }
    ): Promise<UpdateWriteOpResult> {
        const setFields: Record<string, string> = {};

        if (updates.name !== undefined) {
            setFields.referredUserName = updates.name;
        }
        if (updates.email !== undefined) {
            setFields.referredUserEmail = updates.email;
        }
        if (updates.phoneNumber !== undefined) {
            setFields.referredUserPhone = updates.phoneNumber.toString();
        }

        if (Object.keys(setFields).length === 0) {
            // Nothing to update
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
        }

        return ReferralModel.updateMany(
            { referredUser: userId },
            { $set: setFields }
        ).exec();
    }

    /**
     * Unarchives all referral records associated with a given user.
     * Useful when restoring a soft-deleted user.
     * @param userId - The ID of the user.
     * @returns MongoDB update result.
     */
    async unarchiveByUserId(userId: string | Types.ObjectId): Promise<UpdateWriteOpResult> {
        return ReferralModel.updateMany(
            { $or: [{ referrer: userId }, { referredUser: userId }], archived: true }, // Only unarchive if archived
            { $set: { archived: false }, $unset: { archivedAt: '' } } // Remove archivedAt
        ).exec();
    }

    /**
 * Generates monthly referral data for the current year with counts by level and active subscribers.
 * @param referrerId - The ID of the user whose monthly referral data is needed.
 * @returns Array of monthly referral data for each month of the current year.
 */
    private async generateMonthlyReferralData(referrerId: Types.ObjectId): Promise<MonthlyReferralData[]> {
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1); // January 1st
        const endOfYear = new Date(currentYear + 1, 0, 1); // January 1st of next year

        // Month names for formatting
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        // Get all referrals for the current year
        const yearlyReferrals = await ReferralModel.find({
            referrer: referrerId,
            archived: { $ne: true },
            createdAt: {
                $gte: startOfYear,
                $lt: endOfYear
            }
        }).lean();

        // Helper function to count active subscribers for a specific set of user IDs
        const countActiveSubscribersForUsers = async (userIds: Types.ObjectId[]): Promise<number> => {
            if (userIds.length === 0) return 0;
            return SubscriptionModel.countDocuments({
                user: { $in: userIds },
                status: SubscriptionStatus.ACTIVE,
                endDate: { $gt: new Date() } // Ensure end date is in the future
            }).exec();
        };

        // Initialize monthly data structure
        const monthlyData: MonthlyReferralData[] = [];

        // Process each month of the current year
        for (let month = 0; month < 12; month++) {
            const monthStart = new Date(currentYear, month, 1);
            const monthEnd = new Date(currentYear, month + 1, 1);

            // Filter referrals for this month
            const monthReferrals = yearlyReferrals.filter(ref =>
                ref.createdAt >= monthStart && ref.createdAt < monthEnd
            );

            // Count by level and collect user IDs
            let level1 = 0;
            let level2 = 0;
            let level3 = 0;
            const level1UserIds: Types.ObjectId[] = [];
            const level2UserIds: Types.ObjectId[] = [];
            const level3UserIds: Types.ObjectId[] = [];

            monthReferrals.forEach(ref => {
                if (ref.referralLevel === 1) {
                    level1++;
                    level1UserIds.push(ref.referredUser);
                } else if (ref.referralLevel === 2) {
                    level2++;
                    level2UserIds.push(ref.referredUser);
                } else if (ref.referralLevel === 3) {
                    level3++;
                    level3UserIds.push(ref.referredUser);
                }
            });

            // Count active subscribers for each level
            const [level1ActiveSubscribers, level2ActiveSubscribers, level3ActiveSubscribers] = await Promise.all([
                countActiveSubscribersForUsers(level1UserIds),
                countActiveSubscribersForUsers(level2UserIds),
                countActiveSubscribersForUsers(level3UserIds)
            ]);

            monthlyData.push({
                month: `${currentYear}-${String(month + 1).padStart(2, '0')}`,
                monthName: monthNames[month],
                level1,
                level2,
                level3,
                total: level1 + level2 + level3,
                level1ActiveSubscribers,
                level2ActiveSubscribers,
                level3ActiveSubscribers,
                totalActiveSubscribers: level1ActiveSubscribers + level2ActiveSubscribers + level3ActiveSubscribers
            });
        }

        return monthlyData;
    }

    /**
     * Calculates referral statistics (counts per level) for a given user.
     * Also counts how many referred users at each level have an active subscription.
     * @param referrerId - The ID of the user whose referral stats are needed.
     * @returns Referral statistics including active subscriber counts.
     */
    async getReferralStats(referrerId: string | Types.ObjectId): Promise<ReferralStatsResponse> {
        const referrerObjectId = new Types.ObjectId(referrerId.toString());

        // 1. Get all referral records for this referrer
        const allReferrals = await ReferralModel.find({ referrer: referrerObjectId, archived: { $ne: true } }).lean(); // Use lean

        // 2. Count referrals per level
        let level1Count = 0;
        let level2Count = 0;
        let level3Count = 0;
        const level1UserIds: Types.ObjectId[] = [];
        const level2UserIds: Types.ObjectId[] = [];
        const level3UserIds: Types.ObjectId[] = [];

        allReferrals.forEach(ref => {
            if (ref.referralLevel === 1) {
                level1Count++;
                level1UserIds.push(ref.referredUser);
            } else if (ref.referralLevel === 2) {
                level2Count++;
                level2UserIds.push(ref.referredUser);
            } else if (ref.referralLevel === 3) {
                level3Count++;
                level3UserIds.push(ref.referredUser);
            }
        });

        // 3. Count active subscribers within each level's user IDs
        const countActiveSubs = async (userIds: Types.ObjectId[]): Promise<number> => {
            if (userIds.length === 0) return 0;
            return SubscriptionModel.countDocuments({
                user: { $in: userIds },
                status: SubscriptionStatus.ACTIVE,
                endDate: { $gt: new Date() } // Ensure end date is in the future
            }).exec();
        };

        const [level1ActiveSubscribers, level2ActiveSubscribers, level3ActiveSubscribers] = await Promise.all([
            countActiveSubs(level1UserIds),
            countActiveSubs(level2UserIds),
            countActiveSubs(level3UserIds)
        ]);

        // 4. Generate monthly referral data for the current year
        const monthlyData = await this.generateMonthlyReferralData(referrerObjectId);

        // 5. Return combined results
        return {
            totalReferrals: level1Count + level2Count + level3Count,
            level1Count,
            level2Count,
            level3Count,
            level1ActiveSubscribers,
            level2ActiveSubscribers,
            level3ActiveSubscribers,
            monthlyData
        };
    }

    /**
     * Searches users referred by a specific referrer at a given level, filtering by name.
     * Uses aggregation pipeline for filtering on populated user data.
     * @param referrerId - The ID of the referrer.
     * @param level - The referral level (1, 2, or 3).
     * @param nameFilter - Case-insensitive name fragment to filter referred users.
     * @param page - Page number for pagination.
     * @param limit - Number of items per page.
     * @returns Paginated list of referred user info matching the name filter.
     */
    async searchReferralsByReferrerAndLevel(
        referrerId: string | Types.ObjectId,
        level: number,
        nameFilter: string,
        page: number,
        limit: number
    ): Promise<{ referrals: PopulatedReferredUserInfo[]; totalCount: number }> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new mongoose.Types.ObjectId(referrerId.toString());
        const nameRegex = new RegExp(nameFilter, 'i'); // Case-insensitive regex

        const pipeline: mongoose.PipelineStage[] = [
            // Initial match for referrer and level
            { $match: { referrer: referrerObjectId, referralLevel: level, archived: { $ne: true } } },
            // Lookup referred user data
            { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'userData' } },
            // Unwind the userData array (referrals where user was deleted will be removed)
            { $unwind: '$userData' },
            // Filter by user name and ensure user is valid
            {
                $match: {
                    'userData.name': nameRegex,
                    'userData.deleted': { $ne: true }, // Ensure user not deleted
                    'userData.blocked': { $ne: true }  // Ensure user not blocked
                }
            },
            // Sort (optional, e.g., by user name)
            { $sort: { 'userData.name': 1 } },
            // Facet for pagination and total count
            {
                $facet: {
                    paginatedResults: [
                        { $skip: skip },
                        { $limit: limit },
                        // Project the desired output structure
                        {
                            $project: {
                                _id: '$userData._id',
                                name: '$userData.name',
                                email: '$userData.email',
                                phoneNumber: '$userData.phoneNumber',
                                referralLevel: '$referralLevel',
                                createdAt: '$createdAt'
                                // Add other fields from PopulatedReferredUserInfo as needed
                            }
                        }
                    ],
                    totalCount: [
                        { $count: 'count' }
                    ]
                }
            }
        ];

        const result = await ReferralModel.aggregate<{ paginatedResults: PopulatedReferredUserInfo[], totalCount: { count: number }[] }>(pipeline);

        const referrals = result[0]?.paginatedResults || [];
        const totalCount = result[0]?.totalCount[0]?.count || 0;

        return { referrals, totalCount };
    }

    /**
     * Searches all users referred by a specific referrer across all levels, filtering by name.
     * Uses aggregation pipeline for filtering on populated user data.
     * @param referrerId - The ID of the referrer.
     * @param nameFilter - Case-insensitive name fragment to filter referred users.
     * @param page - Page number for pagination.
     * @param limit - Number of items per page.
     * @returns Paginated list of referred user info matching the name filter.
     */
    async searchAllReferralsByReferrer(
        referrerId: string | Types.ObjectId,
        nameFilter: string,
        page: number,
        limit: number
    ): Promise<{ referrals: PopulatedReferredUserInfo[]; totalCount: number }> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new mongoose.Types.ObjectId(referrerId.toString());
        const nameRegex = new RegExp(nameFilter, 'i'); // Case-insensitive regex

        const pipeline: mongoose.PipelineStage[] = [
            // Initial match for referrer
            { $match: { referrer: referrerObjectId, archived: { $ne: true } } },
            // Lookup referred user data
            { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'userData' } },
            { $unwind: '$userData' },
            // Filter by user name and validity
            {
                $match: {
                    'userData.name': nameRegex,
                    'userData.deleted': { $ne: true },
                    'userData.blocked': { $ne: true }
                }
            },
            // Sort (e.g., by level then name)
            { $sort: { referralLevel: 1, 'userData.name': 1 } },
            // Facet for pagination and count
            {
                $facet: {
                    paginatedResults: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: '$userData._id',
                                name: '$userData.name',
                                email: '$userData.email',
                                phoneNumber: '$userData.phoneNumber',
                                referralLevel: '$referralLevel',
                                createdAt: '$createdAt'
                                // Add other fields as needed
                            }
                        }
                    ],
                    totalCount: [
                        { $count: 'count' }
                    ]
                }
            }
        ];

        const result = await ReferralModel.aggregate<{ paginatedResults: PopulatedReferredUserInfo[], totalCount: { count: number }[] }>(pipeline);

        const referrals = result[0]?.paginatedResults || [];
        const totalCount = result[0]?.totalCount[0]?.count || 0;

        return { referrals, totalCount };
    }

    /**
     * Finds referrals by referrer and level with subType filtering integrated into the query
     */
    async findReferralsByReferrerAndLevelWithSubType(
        referrerId: string | Types.ObjectId,
        level: number,
        page: number = 1,
        limit: number = 10,
        subType?: string
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new Types.ObjectId(referrerId.toString());

        // Build pipeline dynamically to avoid TypeScript issues
        const pipeline: any[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    referralLevel: level,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUserData'
                }
            },
            {
                $unwind: {
                    path: '$referredUserData',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $match: {
                    'referredUserData.deleted': { $ne: true },
                    'referredUserData.blocked': { $ne: true }
                }
            }
        ];

        // Add subscription lookup and filtering if subType is specified
        if (subType) {
            // Build subscription match criteria
            // IMPORTANT: Only consider CLASSIQUE/CIBLE subscriptions (not RELANCE)
            // This aligns with campaign filtering and referral stats logic
            const subscriptionMatchCriteria: any = {
                $expr: { $eq: ['$user', '$$userId'] },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: new Date() }
            };

            // When checking for 'none' (unpaid users), only consider registration subscriptions
            // This ensures users with only a RELANCE (feature) subscription are still treated as "unpaid"
            // Old subscriptions without 'category' field are treated as registration (backward compat)
            if (subType === 'none') {
                subscriptionMatchCriteria.$or = [
                    { category: SubscriptionCategory.REGISTRATION },
                    { category: { $exists: false } } // Old subs without category = registration
                ];
            }

            pipeline.push({
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$referredUserData._id' },
                    pipeline: [
                        {
                            $match: subscriptionMatchCriteria
                        }
                    ],
                    as: 'activeSubscriptions'
                }
            });

            // Apply subType filter
            if (subType === 'none') {
                pipeline.push({
                    $match: {
                        $or: [
                            { activeSubscriptions: { $size: 0 } },
                            { activeSubscriptions: { $exists: false } }
                        ]
                    }
                });
            } else if (subType === 'all') {
                pipeline.push({
                    $match: {
                        $expr: { $gt: [{ $size: '$activeSubscriptions' }, 0] }
                    }
                });
            } else {
                // Specific subscription type
                pipeline.push({
                    $match: {
                        'activeSubscriptions.subscriptionType': subType
                    }
                });
            }
        }

        // Get total count with same filtering
        const countPipeline = [...pipeline, { $count: 'total' }];
        const countResult = await ReferralModel.aggregate(countPipeline);
        const totalCount = countResult[0]?.total || 0;

        // Get paginated data
        const dataPipeline = [
            ...pipeline,
            { $skip: skip },
            { $limit: limit },
            {
                $addFields: {
                    referredUser: '$referredUserData'
                }
            },
            {
                $project: {
                    referredUserData: 0,
                    activeSubscriptions: 0
                }
            }
        ];

        const referrals = await ReferralModel.aggregate(dataPipeline);

        return {
            referrals,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page
        };
    }

    /**
     * Finds all referrals by referrer with subType filtering integrated into the query
     */
    async findAllReferralsByReferrerWithSubType(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10,
        subType?: string,
        since?: Date, // Only return users registered after this date (user.createdAt)
        until?: Date  // Only return users registered before this date (user.createdAt)
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new Types.ObjectId(referrerId.toString());

        // Build initial match criteria for referrals
        // IMPORTANT: Only get level 1 (direct) referrals for campaigns/relance
        const matchCriteria: any = {
            referrer: referrerObjectId,
            referralLevel: 1,
            archived: { $ne: true }
        };

        // Build user match criteria (including date filter on USER's createdAt, not referral's)
        const userMatchCriteria: any = {
            'referredUserData.deleted': { $ne: true },
            'referredUserData.blocked': { $ne: true }
        };

        // Add date filters on USER's createdAt (registration date)
        // This filters by when the user registered, not when the referral was created
        if (since || until) {
            userMatchCriteria['referredUserData.createdAt'] = {};
            if (since) {
                userMatchCriteria['referredUserData.createdAt'].$gte = since;
            }
            if (until) {
                userMatchCriteria['referredUserData.createdAt'].$lte = until;
            }
        }

        const pipeline: any[] = [
            {
                $match: matchCriteria
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUserData'
                }
            },
            {
                $unwind: {
                    path: '$referredUserData',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $match: userMatchCriteria
            }
        ];

        // Add subscription lookup and filtering if subType is specified
        if (subType) {
            // Build subscription match criteria
            // IMPORTANT: Only consider CLASSIQUE/CIBLE subscriptions (not RELANCE)
            // This aligns with campaign filtering and referral stats logic
            const subscriptionMatchCriteria: any = {
                $expr: { $eq: ['$user', '$$userId'] },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: new Date() }
            };

            // When checking for 'none' (unpaid users), only consider registration subscriptions
            // This ensures users with only a RELANCE (feature) subscription are still treated as "unpaid"
            // Old subscriptions without 'category' field are treated as registration (backward compat)
            if (subType === 'none') {
                subscriptionMatchCriteria.$or = [
                    { category: SubscriptionCategory.REGISTRATION },
                    { category: { $exists: false } } // Old subs without category = registration
                ];
            }

            pipeline.push({
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$referredUserData._id' },
                    pipeline: [
                        {
                            $match: subscriptionMatchCriteria
                        }
                    ],
                    as: 'activeSubscriptions'
                }
            });

            // Apply subType filter
            if (subType === 'none') {
                pipeline.push({
                    $match: {
                        $or: [
                            { activeSubscriptions: { $size: 0 } },
                            { activeSubscriptions: { $exists: false } }
                        ]
                    }
                });
            } else if (subType === 'all') {
                pipeline.push({
                    $match: {
                        $expr: { $gt: [{ $size: '$activeSubscriptions' }, 0] }
                    }
                });
            } else {
                // Specific subscription type
                pipeline.push({
                    $match: {
                        'activeSubscriptions.subscriptionType': subType
                    }
                });
            }
        }

        // Get total count with same filtering
        const countPipeline = [...pipeline, { $count: 'total' }];
        const countResult = await ReferralModel.aggregate(countPipeline);
        const totalCount = countResult[0]?.total || 0;

        // Get paginated data
        const dataPipeline = [
            ...pipeline,
            { $sort: { referralLevel: 1 as const, createdAt: -1 as const } },
            { $skip: skip },
            { $limit: limit },
            {
                $addFields: {
                    referredUser: '$referredUserData'
                }
            },
            {
                $project: {
                    referredUserData: 0,
                    activeSubscriptions: 0
                }
            }
        ];

        const referrals = await ReferralModel.aggregate(dataPipeline);

        return {
            referrals,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page
        };
    }

    /**
     * Search referrals by referrer and level with subType filtering and name search
     */
    async searchReferralsByReferrerAndLevelWithSubType(
        referrerId: string | Types.ObjectId,
        level: number,
        nameFilter: string,
        page: number,
        limit: number,
        subType?: string
    ): Promise<{ referrals: PopulatedReferredUserInfo[]; totalCount: number }> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new Types.ObjectId(referrerId.toString());
        const nameRegex = new RegExp(nameFilter, 'i');

        const pipeline: any[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    referralLevel: level,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            { $unwind: '$userData' },
            {
                $match: {
                    'userData.name': nameRegex,
                    'userData.deleted': { $ne: true },
                    'userData.blocked': { $ne: true }
                }
            }
        ];

        // Add subscription filtering if subType is specified
        if (subType) {
            // Build subscription match criteria
            // IMPORTANT: Only consider CLASSIQUE/CIBLE subscriptions (not RELANCE)
            // This aligns with campaign filtering and referral stats logic
            const subscriptionMatchCriteria: any = {
                $expr: { $eq: ['$user', '$$userId'] },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: new Date() }
            };

            // When checking for 'none' (unpaid users), only consider registration subscriptions
            // Old subscriptions without 'category' field are treated as registration (backward compat)
            if (subType === 'none') {
                subscriptionMatchCriteria.$or = [
                    { category: SubscriptionCategory.REGISTRATION },
                    { category: { $exists: false } }
                ];
            }

            pipeline.push(
                {
                    $lookup: {
                        from: 'subscriptions',
                        let: { userId: '$userData._id' },
                        pipeline: [
                            {
                                $match: subscriptionMatchCriteria
                            }
                        ],
                        as: 'activeSubscriptions'
                    }
                }
            );

            if (subType === 'none') {
                pipeline.push({
                    $match: {
                        $or: [
                            { activeSubscriptions: { $size: 0 } },
                            { activeSubscriptions: { $exists: false } }
                        ]
                    }
                });
            } else if (subType === 'all') {
                pipeline.push({
                    $match: {
                        $expr: { $gt: [{ $size: '$activeSubscriptions' }, 0] }
                    }
                });
            } else {
                pipeline.push({
                    $match: {
                        'activeSubscriptions.subscriptionType': subType
                    }
                });
            }
        }

        pipeline.push(
            { $sort: { 'userData.name': 1 } },
            {
                $facet: {
                    paginatedResults: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: '$userData._id',
                                name: '$userData.name',
                                email: '$userData.email',
                                phoneNumber: '$userData.phoneNumber',
                                referralLevel: '$referralLevel',
                                createdAt: '$createdAt'
                            }
                        }
                    ],
                    totalCount: [{ $count: 'count' }]
                }
            }
        );

        const result = await ReferralModel.aggregate(pipeline);
        const referrals = result[0]?.paginatedResults || [];
        const totalCount = result[0]?.totalCount[0]?.count || 0;

        return { referrals, totalCount };
    }

    /**
     * Search all referrals by referrer with subType filtering and name search
     */
    async searchAllReferralsByReferrerWithSubType(
        referrerId: string | Types.ObjectId,
        nameFilter: string,
        page: number,
        limit: number,
        subType?: string
    ): Promise<{ referrals: PopulatedReferredUserInfo[]; totalCount: number }> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new Types.ObjectId(referrerId.toString());
        const nameRegex = new RegExp(nameFilter, 'i');

        const pipeline: any[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            { $unwind: '$userData' },
            {
                $match: {
                    'userData.name': nameRegex,
                    'userData.deleted': { $ne: true },
                    'userData.blocked': { $ne: true }
                }
            }
        ];

        // Add subscription filtering if subType is specified
        if (subType) {
            // Build subscription match criteria
            // IMPORTANT: Only consider CLASSIQUE/CIBLE subscriptions (not RELANCE)
            // This aligns with campaign filtering and referral stats logic
            const subscriptionMatchCriteria: any = {
                $expr: { $eq: ['$user', '$$userId'] },
                status: SubscriptionStatus.ACTIVE,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
                endDate: { $gt: new Date() }
            };

            // When checking for 'none' (unpaid users), only consider registration subscriptions
            // Old subscriptions without 'category' field are treated as registration (backward compat)
            if (subType === 'none') {
                subscriptionMatchCriteria.$or = [
                    { category: SubscriptionCategory.REGISTRATION },
                    { category: { $exists: false } }
                ];
            }

            pipeline.push(
                {
                    $lookup: {
                        from: 'subscriptions',
                        let: { userId: '$userData._id' },
                        pipeline: [
                            {
                                $match: subscriptionMatchCriteria
                            }
                        ],
                        as: 'activeSubscriptions'
                    }
                }
            );

            if (subType === 'none') {
                pipeline.push({
                    $match: {
                        $or: [
                            { activeSubscriptions: { $size: 0 } },
                            { activeSubscriptions: { $exists: false } }
                        ]
                    }
                });
            } else if (subType === 'all') {
                pipeline.push({
                    $match: {
                        $expr: { $gt: [{ $size: '$activeSubscriptions' }, 0] }
                    }
                });
            } else {
                pipeline.push({
                    $match: {
                        'activeSubscriptions.subscriptionType': subType
                    }
                });
            }
        }

        pipeline.push(
            { $sort: { referralLevel: 1, 'userData.name': 1 } },
            {
                $facet: {
                    paginatedResults: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: '$userData._id',
                                name: '$userData.name',
                                email: '$userData.email',
                                phoneNumber: '$userData.phoneNumber',
                                referralLevel: '$referralLevel',
                                createdAt: '$createdAt'
                            }
                        }
                    ],
                    totalCount: [{ $count: 'count' }]
                }
            }
        );

        const result = await ReferralModel.aggregate(pipeline);
        const referrals = result[0]?.paginatedResults || [];
        const totalCount = result[0]?.totalCount[0]?.count || 0;

        return { referrals, totalCount };
    }

    /**
     * OPTIMIZED: Search referrals using denormalized fields (no $lookup needed)
     * Searches by name, email, or phone number using compound indexes
     * Falls back to aggregation if denormalized fields are not populated
     */
    async searchReferralsFast(
        referrerId: string | Types.ObjectId,
        searchTerm: string,
        page: number = 1,
        limit: number = 20,
        level?: number | number[] // Optional: filter by specific level (1, 2, 3), array of levels, or undefined for all
    ): Promise<{
        referrals: PopulatedReferredUserInfo[];
        totalCount: number;
    }> {
        const referrerObjectId = new Types.ObjectId(referrerId.toString());
        const searchRegex = new RegExp(searchTerm, 'i');
        const skip = (page - 1) * limit;

        // Build match query using denormalized fields
        const matchQuery: any = {
            referrer: referrerObjectId,
            archived: { $ne: true },
            $or: [
                { referredUserName: searchRegex },
                { referredUserEmail: searchRegex },
                { referredUserPhone: searchRegex }
            ]
        };

        // Support single level or array of levels
        if (level !== undefined) {
            if (Array.isArray(level)) {
                matchQuery.referralLevel = { $in: level };
            } else {
                matchQuery.referralLevel = level;
            }
        }

        // Get total count (fast with index on referrer + denormalized fields)
        const totalCount = await ReferralModel.countDocuments(matchQuery);

        if (totalCount === 0) {
            return { referrals: [], totalCount: 0 };
        }

        // Get paginated referrals
        const referralDocs = await ReferralModel.find(matchQuery)
            .select('referredUser referralLevel createdAt referredUserName referredUserEmail referredUserPhone')
            .sort({ referralLevel: 1, referredUserName: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        if (referralDocs.length === 0) {
            return { referrals: [], totalCount };
        }

        // Batch fetch full user data for the results
        const referredUserIds = referralDocs.map(r => r.referredUser);
        const users = await UserModel.find({
            _id: { $in: referredUserIds },
            deleted: { $ne: true },
            blocked: { $ne: true }
        })
            .select('_id name email phoneNumber region avatar avatarId country gender profession')
            .lean();

        // Create user map for fast lookup
        const userMap = new Map<string, any>();
        for (const user of users) {
            userMap.set(user._id.toString(), user);
        }

        // Combine data
        const referrals: PopulatedReferredUserInfo[] = [];
        for (const ref of referralDocs) {
            const userId = ref.referredUser.toString();
            const user = userMap.get(userId);

            if (!user) continue; // Skip if user not found (deleted/blocked)

            referrals.push({
                _id: user._id,
                name: user.name || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber,
                region: user.region,
                avatar: user.avatar,
                referralLevel: ref.referralLevel,
                createdAt: ref.createdAt
            });
        }

        return { referrals, totalCount };
    }

    /**
     * Get referrals for activation with subscription status included
     * OPTIMIZED: Two-phase approach for users with many referrals
     * Phase 1: Paginate referrals first (fast with index)
     * Phase 2: Batch query subscriptions only for the page results
     */
    async findReferralsForActivation(
        referrerId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20,
        filter?: 'all' | 'activatable' | 'upgradable'
    ): Promise<{
        referrals: Array<{
            _id: string;
            name: string;
            email: string;
            phoneNumber?: string;
            avatar?: string;
            referralLevel: number;
            hasActiveSubscription: boolean;
            currentSubscriptionType?: string;
            canUpgrade: boolean;
            createdAt: Date;
        }>;
        total: number;
        page: number;
        pages: number;
    }> {
        const referrerObjectId = new Types.ObjectId(referrerId.toString());
        const now = new Date();

        // For 'all' filter, use fast two-phase approach
        // For 'activatable' or 'upgradable', we need to check subscriptions first
        if (!filter || filter === 'all') {
            return this.findReferralsForActivationFast(referrerObjectId, page, limit, now);
        }

        // For filtered queries, use aggregation (slower but necessary)
        return this.findReferralsForActivationFiltered(referrerObjectId, page, limit, filter, now);
    }

    /**
     * Ultra-fast approach for 'all' filter - NO aggregation
     * Phase 1: Count referrals (uses index, instant)
     * Phase 2: Get paginated referral IDs only (uses index, instant)
     * Phase 3: Batch fetch user data for just those IDs
     * Phase 4: Batch fetch subscriptions for just those users
     */
    private async findReferralsForActivationFast(
        referrerObjectId: Types.ObjectId,
        page: number,
        limit: number,
        now: Date
    ): Promise<{
        referrals: Array<{
            _id: string;
            name: string;
            email: string;
            phoneNumber?: string;
            avatar?: string;
            referralLevel: number;
            hasActiveSubscription: boolean;
            currentSubscriptionType?: string;
            canUpgrade: boolean;
            createdAt: Date;
        }>;
        total: number;
        page: number;
        pages: number;
    }> {
        // Phase 1: Get total count (uses referrer index, very fast)
        const total = await ReferralModel.countDocuments({
            referrer: referrerObjectId,
            archived: { $ne: true }
        });

        if (total === 0) {
            return { referrals: [], total: 0, page, pages: 0 };
        }

        // Phase 2: Get paginated referrals (uses index, very fast - only fetching IDs and referredUser)
        const referrals = await ReferralModel.find({
            referrer: referrerObjectId,
            archived: { $ne: true }
        })
            .select('referredUser referralLevel createdAt')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        if (referrals.length === 0) {
            return { referrals: [], total, page, pages: Math.ceil(total / limit) };
        }

        // Phase 3: Batch fetch user data for ONLY these referrals
        const referredUserIds = referrals.map(r => r.referredUser);
        const users = await UserModel.find({
            _id: { $in: referredUserIds },
            deleted: { $ne: true },
            blocked: { $ne: true }
        })
            .select('_id name email phoneNumber avatar')
            .lean();

        // Create user map for fast lookup
        const userMap = new Map<string, any>();
        for (const user of users) {
            userMap.set(user._id.toString(), user);
        }

        // Phase 4: Batch fetch subscriptions for ONLY these users
        const subscriptions = await SubscriptionModel.find({
            user: { $in: referredUserIds },
            status: SubscriptionStatus.ACTIVE,
            endDate: { $gt: now },
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        })
            .select('user subscriptionType')
            .lean();

        // Build subscription map
        const subscriptionMap = new Map<string, Set<string>>();
        for (const sub of subscriptions) {
            const key = sub.user.toString();
            if (!subscriptionMap.has(key)) {
                subscriptionMap.set(key, new Set());
            }
            subscriptionMap.get(key)!.add(sub.subscriptionType);
        }

        // Combine all data
        const formattedReferrals: Array<{
            _id: string;
            name: string;
            email: string;
            phoneNumber?: string;
            avatar?: string;
            referralLevel: number;
            hasActiveSubscription: boolean;
            currentSubscriptionType?: string;
            canUpgrade: boolean;
            createdAt: Date;
        }> = [];

        for (const referral of referrals) {
            const userId = referral.referredUser.toString();
            const user = userMap.get(userId);

            // Skip if user not found (deleted/blocked)
            if (!user) continue;

            const userSubs = subscriptionMap.get(userId) || new Set();
            const hasClassique = userSubs.has('CLASSIQUE');
            const hasCible = userSubs.has('CIBLE');
            const hasActiveSubscription = hasClassique || hasCible;
            const currentSubscriptionType = hasCible ? 'CIBLE' : (hasClassique ? 'CLASSIQUE' : undefined);
            const canUpgrade = hasClassique && !hasCible;

            formattedReferrals.push({
                _id: userId,
                name: user.name || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber,
                avatar: user.avatar,
                referralLevel: referral.referralLevel,
                hasActiveSubscription,
                currentSubscriptionType,
                canUpgrade,
                createdAt: referral.createdAt
            });
        }

        return {
            referrals: formattedReferrals,
            total,
            page,
            pages: Math.ceil(total / limit)
        };
    }

    /**
     * Filtered approach for 'activatable' or 'upgradable' filters
     * Uses aggregation with subscription lookups (slower but necessary for filtering)
     */
    private async findReferralsForActivationFiltered(
        referrerObjectId: Types.ObjectId,
        page: number,
        limit: number,
        filter: 'activatable' | 'upgradable',
        now: Date
    ): Promise<{
        referrals: Array<{
            _id: string;
            name: string;
            email: string;
            phoneNumber?: string;
            avatar?: string;
            referralLevel: number;
            hasActiveSubscription: boolean;
            currentSubscriptionType?: string;
            canUpgrade: boolean;
            createdAt: Date;
        }>;
        total: number;
        page: number;
        pages: number;
    }> {
        const pipeline: any[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    archived: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            {
                $unwind: {
                    path: '$userData',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $match: {
                    'userData.deleted': { $ne: true },
                    'userData.blocked': { $ne: true }
                }
            },
            // Lookup active subscriptions (both types in one query)
            {
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$userData._id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$user', '$$userId'] },
                                subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] },
                                status: SubscriptionStatus.ACTIVE,
                                endDate: { $gt: now }
                            }
                        },
                        { $project: { subscriptionType: 1 } }
                    ],
                    as: 'subscriptions'
                }
            },
            {
                $addFields: {
                    hasClassique: {
                        $gt: [
                            { $size: { $filter: { input: '$subscriptions', cond: { $eq: ['$$this.subscriptionType', 'CLASSIQUE'] } } } },
                            0
                        ]
                    },
                    hasCible: {
                        $gt: [
                            { $size: { $filter: { input: '$subscriptions', cond: { $eq: ['$$this.subscriptionType', 'CIBLE'] } } } },
                            0
                        ]
                    }
                }
            },
            {
                $addFields: {
                    hasActiveSubscription: { $or: ['$hasClassique', '$hasCible'] },
                    currentSubscriptionType: {
                        $cond: {
                            if: '$hasCible',
                            then: 'CIBLE',
                            else: { $cond: { if: '$hasClassique', then: 'CLASSIQUE', else: null } }
                        }
                    },
                    canUpgrade: { $and: ['$hasClassique', { $not: '$hasCible' }] }
                }
            }
        ];

        // Apply filter
        if (filter === 'activatable') {
            pipeline.push({ $match: { hasActiveSubscription: false } });
        } else if (filter === 'upgradable') {
            pipeline.push({ $match: { canUpgrade: true } });
        }

        // Paginate
        pipeline.push({
            $facet: {
                paginatedResults: [
                    { $sort: { createdAt: -1 as const } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                    {
                        $project: {
                            _id: '$userData._id',
                            name: '$userData.name',
                            email: '$userData.email',
                            phoneNumber: '$userData.phoneNumber',
                            avatar: '$userData.avatar',
                            referralLevel: 1,
                            hasActiveSubscription: 1,
                            currentSubscriptionType: 1,
                            canUpgrade: 1,
                            createdAt: 1
                        }
                    }
                ],
                totalCount: [{ $count: 'count' }]
            }
        });

        const result = await ReferralModel.aggregate(pipeline);
        const referrals = result[0]?.paginatedResults || [];
        const total = result[0]?.totalCount[0]?.count || 0;

        const formattedReferrals = referrals.map((r: any) => ({
            ...r,
            _id: r._id.toString()
        }));

        return {
            referrals: formattedReferrals,
            total,
            page,
            pages: Math.ceil(total / limit)
        };
    }
}

// Export an instance
export const referralRepository = new ReferralRepository(); 