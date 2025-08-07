import ReferralModel, { IReferral } from '../models/referral.model';
import UserModel, { IUser } from '../models/user.model';
import mongoose, { Types, Document, UpdateWriteOpResult, PipelineStage } from 'mongoose';
import SubscriptionModel, { SubscriptionStatus } from '../models/subscription.model';

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
     * @param data - Data for the new referral (referrer, referredUser, referralLevel).
     * @returns The newly created referral document.
     */
    async create(data: { referrer: Types.ObjectId; referredUser: Types.ObjectId; referralLevel: number }): Promise<IReferral> {
        const referral = new ReferralModel(data);
        return referral.save();
    }

    /**
     * Creates multiple referral records.
     * @param data - An array of referral data objects.
     * @returns An array of the newly created referral documents.
     */
    async createMany(data: { referrer: Types.ObjectId; referredUser: Types.ObjectId; referralLevel: number }[]): Promise<IReferral[]> {
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

        const aggregationPipeline: mongoose.PipelineStage[] = [
            {
                $match: {
                    referrer: referrerObjectId,
                    referralLevel: { $in: [2, 3] },
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
            },
            {
                $addFields: {
                    'nameLower': { $toLower: '$referredUserData.name' }
                }
            },
            {
                $sort: {
                    'referralLevel': 1,
                    'nameLower': 1
                }
            },
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
            { $match: { referrer: referrerObjectId, referralLevel: { $in: [2, 3] }, archived: { $ne: true } } },
            { $lookup: { from: 'users', localField: 'referredUser', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $match: { 'user.deleted': { $ne: true }, 'user.blocked': { $ne: true } } },
            { $count: 'totalCount' }
        ];
        const countResult = await ReferralModel.aggregate<{ totalCount: number }>(countPipeline);
        const totalCount = countResult[0]?.totalCount ?? 0;

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
            pipeline.push({
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$referredUserData._id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$user', '$$userId'] },
                                status: SubscriptionStatus.ACTIVE,
                                endDate: { $gt: new Date() }
                            }
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
        subType?: string
    ): Promise<ReferralPaginationResponse> {
        const skip = (page - 1) * limit;
        const referrerObjectId = new Types.ObjectId(referrerId.toString());

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
            pipeline.push({
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$referredUserData._id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$user', '$$userId'] },
                                status: SubscriptionStatus.ACTIVE,
                                endDate: { $gt: new Date() }
                            }
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
            pipeline.push(
                {
                    $lookup: {
                        from: 'subscriptions',
                        let: { userId: '$userData._id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$user', '$$userId'] },
                                    status: SubscriptionStatus.ACTIVE,
                                    endDate: { $gt: new Date() }
                                }
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
            pipeline.push(
                {
                    $lookup: {
                        from: 'subscriptions',
                        let: { userId: '$userData._id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$user', '$$userId'] },
                                    status: SubscriptionStatus.ACTIVE,
                                    endDate: { $gt: new Date() }
                                }
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
}

// Export an instance
export const referralRepository = new ReferralRepository(); 