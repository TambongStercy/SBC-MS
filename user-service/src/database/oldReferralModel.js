const mongoose = require('mongoose')
const { Schema } = require('mongoose')

// Helper function to filter out null populated fields
function filterNullPopulated(docs, field) {
    if (!docs) return [];

    // Handle single document
    if (!Array.isArray(docs)) {
        return docs[field] ? [docs] : [];
    }

    // Handle array of documents
    return docs.filter(doc => doc[field]);
}

const referralSchema = new Schema({
    referrer: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
    },
    referredUser: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
    },
    referralLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 3, // Level 1 for direct, Level 2 for indirect, etc.
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    archived: {
        type: Boolean,
        default: false
    },
    archivedAt: {
        type: Date,
        default: null
    }
});

// Add at the top of your schema definition
referralSchema.index({ referrer: 1, referralLevel: 1 });
referralSchema.index({ referredUser: 1 });
referralSchema.index({ referrer: 1 });
referralSchema.index({ referralLevel: 1 });
referralSchema.index({ archived: 1 });

// Add post hooks for all queries that populate referrer or referredUser
referralSchema.post('find', function (docs) {
    if (!docs) return docs;

    // Check if referrer or referredUser was populated
    if (docs.length > 0) {
        if (docs[0].referrer && typeof docs[0].referrer === 'object') {
            return filterNullPopulated(docs, 'referrer');
        }
        if (docs[0].referredUser && typeof docs[0].referredUser === 'object') {
            return filterNullPopulated(docs, 'referredUser');
        }
    }

    return docs;
});

referralSchema.post('findOne', function (doc) {
    if (!doc) return doc;

    // Check if referrer was populated and is null
    if (doc.referrer === null && doc.populated('referrer')) {
        return null;
    }

    // Check if referredUser was populated and is null
    if (doc.referredUser === null && doc.populated('referredUser')) {
        return null;
    }

    return doc;
});

// Find direct referrer (level 1) info for a user
referralSchema.statics.findAffiliatorInfo = async function (userId) {
    try {
        const referral = await this.findOne({
            referredUser: userId,
            referralLevel: 1
        }).populate('referrer', 'name email phoneNumber region avatar _id debt');

        // Return null if referral is null or referrer is null
        return (referral && referral.referrer) ? referral.referrer : null;
    } catch (error) {
        console.error('Error finding affiliator info:', error);
        return null;
    }
};

// Find all referrers at a specific level with pagination
referralSchema.statics.findReferrersByLevel = async function (userId, level, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        const referrals = await this.find({
            referredUser: userId,
            referralLevel: level
        })
            .populate('referrer', 'name email phoneNumber region avatar _id')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Filter out referrals with null referrer
        const validReferrals = referrals.filter(ref => ref.referrer);

        const total = await this.countDocuments({
            referredUser: userId,
            referralLevel: level
        });

        return {
            referrers: validReferrals.map(ref => ref.referrer),
            total,
            pages: Math.ceil(total / limit),
            currentPage: page
        };
    } catch (error) {
        console.error(`Error finding level ${level} referrers:`, error);
        throw error;
    }
};

// Find all referrers across all levels with pagination
referralSchema.statics.findAllReferrers = async function (userId, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        const referrals = await this.find({
            referredUser: userId
        })
            .populate('referrer', 'name email phoneNumber region avatar _id')
            .sort({ referralLevel: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Filter out referrals with null referrer
        const validReferrals = referrals.filter(ref => ref.referrer);

        const total = await this.countDocuments({
            referredUser: userId
        });

        // Group referrers by level
        const referrersByLevel = validReferrals.reduce((acc, ref) => {
            if (!acc[ref.referralLevel]) {
                acc[ref.referralLevel] = [];
            }
            acc[ref.referralLevel].push(ref.referrer);
            return acc;
        }, {});

        return {
            referrersByLevel,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page
        };
    } catch (error) {
        console.error('Error finding all referrers:', error);
        throw error;
    }
};

// Find all referred users (people referred by this user) with pagination
referralSchema.statics.findReferredUsers = async function (referrerId, level, emails = null, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        const query = { referrer: referrerId };
        if (level) {
            query.referralLevel = level;
        }

        // Create base query for referrals
        let referralsQuery = this.find(query);

        // If emails array is provided and not empty, add it to the populate conditions
        if (emails && Array.isArray(emails) && emails.length > 0) {
            referralsQuery = referralsQuery.populate({
                path: 'referredUser',
                match: { email: { $in: emails } },
                select: 'name email phoneNumber region avatar _id'
            });
        } else {
            referralsQuery = referralsQuery.populate('referredUser', 'name email phoneNumber region avatar _id');
        }

        const referrals = await referralsQuery
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Filter out any null referredUser (in case of email filtering)
        const validReferrals = referrals.filter(ref => ref.referredUser);

        // Get total count considering email filter if provided
        let total;
        if (emails && Array.isArray(emails) && emails.length > 0) {
            const allReferrals = await this.find(query).populate({
                path: 'referredUser',
                match: { email: { $in: emails } },
                select: '_id'
            });
            total = allReferrals.filter(ref => ref.referredUser).length;
        } else {
            total = await this.countDocuments(query);
        }

        return {
            referrals: validReferrals,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
        };
    } catch (error) {
        console.error('Error finding referred users:', error);
        return {
            referrals: [],
            total: 0,
            page,
            limit,
            pages: 0
        };
    }
};

// Get referral statistics for a user
referralSchema.statics.getReferralStats = async function (userId) {
    try {
        const stats = await this.aggregate([
            {
                $match: {
                    referrer: mongoose.Types.ObjectId(userId)
                }
            },
            {
                $group: {
                    _id: '$referralLevel',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        return stats.reduce((acc, stat) => {
            acc[`level${stat._id}`] = stat.count;
            return acc;
        }, {
            level1: 0,
            level2: 0,
            level3: 0,
            total: stats.reduce((sum, stat) => sum + stat.count, 0)
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        throw error;
    }
};
// Find all referred users at all levels with detailed grouping
referralSchema.statics.findAllReferredUsersGrouped = async function (referrerId, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        // Find referrals at all levels
        const referrals = await this.find({
            referrer: referrerId
        })
            .populate('referredUser', 'name email phoneNumber region avatar _id')
            .sort({ referralLevel: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Filter out referrals with null referredUser
        const validReferrals = referrals.filter(ref => ref.referredUser);

        const total = await this.countDocuments({
            referrer: referrerId
        });

        // Group by level
        const referredByLevel = validReferrals.reduce((acc, ref) => {
            const level = `level${ref.referralLevel}`;
            if (!acc[level]) {
                acc[level] = [];
            }
            acc[level].push({
                ...ref.referredUser.toObject(),
                referralLevel: ref.referralLevel,
                createdAt: ref.createdAt
            });
            return acc;
        }, { level1: [], level2: [], level3: [] });

        // Get counts for each level
        const levelCounts = await this.aggregate([
            {
                $match: { referrer: mongoose.Types.ObjectId(referrerId) }
            },
            {
                $group: {
                    _id: '$referralLevel',
                    count: { $sum: 1 }
                }
            }
        ]);

        const counts = levelCounts.reduce((acc, curr) => {
            acc[`level${curr._id}Count`] = curr.count;
            return acc;
        }, { level1Count: 0, level2Count: 0, level3Count: 0 });

        return {
            referredUsers: {
                level1: referredByLevel.level1,
                level2: referredByLevel.level2,
                level3: referredByLevel.level3
            },
            counts,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page
        };
    } catch (error) {
        console.error('Error finding all referred users grouped:', error);
        throw error;
    }
};

// Find direct (level 1) referred users
referralSchema.statics.findDirectReferredUsers = async function (referrerId, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        const directReferrals = await this.aggregate([
            // Match the referrals
            {
                $match: {
                    referrer: new mongoose.Types.ObjectId(referrerId),
                    referralLevel: 1
                }
            },
            // Lookup to get user data
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUser'
                }
            },
            // Unwind the array created by lookup
            {
                $unwind: '$referredUser'
            },
            // Add a field with lowercase name for sorting
            {
                $addFields: {
                    'nameLower': { $toLower: '$referredUser.name' }
                }
            },
            // Sort by lowercase name
            {
                $sort: {
                    'nameLower': 1
                }
            },
            // Project only the fields we need
            {
                $project: {
                    'referredUser.name': 1,
                    'referredUser.email': 1,
                    'referredUser.phoneNumber': 1,
                    'referredUser.region': 1,
                    'referredUser.avatar': 1,
                    'referredUser._id': 1,
                    'createdAt': 1
                }
            },
            // Apply pagination
            {
                $skip: skip
            },
            {
                $limit: limit
            }
        ]);

        const total = await this.countDocuments({
            referrer: referrerId,
            referralLevel: 1
        });

        // Map the results to match the expected format
        const directUsers = directReferrals.map(ref => ({
            ...ref.referredUser,
            referralLevel: 1,
            createdAt: ref.createdAt
        }));

        return {
            directUsers,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            hasMore: total > skip + limit
        };
    } catch (error) {
        console.error('Error finding direct referred users:', error);
        throw error;
    }
};

// Find level 2 and 3 referred users
referralSchema.statics.findIndirectReferredUsers = async function (referrerId, page = 1, limit = 20) {
    try {
        const skip = (page - 1) * limit;

        const indirectReferrals = await this.aggregate([
            // Match level 2 and 3 referrals
            {
                $match: {
                    referrer: new mongoose.Types.ObjectId(referrerId),
                    referralLevel: { $in: [2, 3] }
                }
            },
            // Lookup to get user data
            {
                $lookup: {
                    from: 'users',
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUser'
                }
            },
            // Unwind the array created by lookup
            {
                $unwind: '$referredUser'
            },
            // Add a field with lowercase name for sorting
            {
                $addFields: {
                    'nameLower': { $toLower: '$referredUser.name' }
                }
            },
            // Sort by lowercase name
            {
                $sort: {
                    'nameLower': 1
                }
            },
            // Project only the fields we need
            {
                $project: {
                    'referredUser.name': 1,
                    'referredUser.email': 1,
                    'referredUser.phoneNumber': 1,
                    'referredUser.region': 1,
                    'referredUser.avatar': 1,
                    'referredUser._id': 1,
                    'referralLevel': 1,
                    'createdAt': 1
                }
            },
            // Apply pagination
            {
                $skip: skip
            },
            {
                $limit: limit
            }
        ]);

        const total = await this.countDocuments({
            referrer: referrerId,
            referralLevel: { $in: [2, 3] }
        });

        // Group by level
        const referredByLevel = indirectReferrals.reduce((acc, ref) => {
            const level = `level${ref.referralLevel}`;
            if (!acc[level]) {
                acc[level] = [];
            }
            acc[level].push({
                ...ref.referredUser,
                referralLevel: ref.referralLevel
            });
            return acc;
        }, { level2: [], level3: [] });

        return {
            level2Users: referredByLevel.level2,
            level3Users: referredByLevel.level3,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page
        };
    } catch (error) {
        console.error('Error finding indirect referred users:', error);
        throw error;
    }
};


// Get subscription counts for direct referred users
referralSchema.statics.getDirectReferredUsersCounts = async function (referrerId) {
    try {
        // Get all direct referrals
        const directReferrals = await this.find({
            referrer: referrerId,
            referralLevel: 1
        });

        // Extract userId
        const userIds = directReferrals.map(ref => ref.referredUser);

        // Get subscription status for these userId
        const subscriptionCounts = await mongoose.model('subscribe').aggregate([
            {
                $match: {
                    user: { $in: userIds }
                }
            },
            {
                $group: {
                    _id: null,
                    subscribedCount: { $sum: 1 }
                }
            }
        ]);

        const subscribedCount = subscriptionCounts[0]?.subscribedCount || 0;
        const totalCount = userIds.length;
        const unsubscribedCount = totalCount - subscribedCount;

        return {
            total: totalCount,
            subscribed: subscribedCount,
            unsubscribed: unsubscribedCount
        };
    } catch (error) {
        console.error('Error getting direct referred users counts:', error);
        throw error;
    }
};

// Get subscription counts for direct referred users
referralSchema.statics.getInDirectLvl2ReferredUsersCounts = async function (referrerId) {
    try {
        // Get all direct referrals
        const directReferrals = await this.find({
            referrer: referrerId,
            referralLevel: 2
        });

        // Extract userId
        const userIds = directReferrals.map(ref => ref.referredUser);

        // Get subscription status for these userId
        const subscriptionCounts = await mongoose.model('subscribe').aggregate([
            {
                $match: {
                    user: { $in: userIds }
                }
            },
            {
                $group: {
                    _id: null,
                    subscribedCount: { $sum: 1 }
                }
            }
        ]);

        const subscribedCount = subscriptionCounts[0]?.subscribedCount || 0;
        const totalCount = userIds.length;
        const unsubscribedCount = totalCount - subscribedCount;

        return {
            total: totalCount,
            subscribed: subscribedCount,
            unsubscribed: unsubscribedCount
        };
    } catch (error) {
        console.error('Error getting direct referred users counts:', error);
        throw error;
    }
};

// Get subscription counts for direct referred users
referralSchema.statics.getInDirectLvl3ReferredUsersCounts = async function (referrerId) {
    try {
        // Get all direct referrals
        const directReferrals = await this.find({
            referrer: referrerId,
            referralLevel: 3
        });

        // Extract userId
        const userIds = directReferrals.map(ref => ref.referredUser);

        // Get subscription status for these userId
        const subscriptionCounts = await mongoose.model('subscribe').aggregate([
            {
                $match: {
                    user: { $in: userIds }
                }
            },
            {
                $group: {
                    _id: null,
                    subscribedCount: { $sum: 1 }
                }
            }
        ]);

        const subscribedCount = subscriptionCounts[0]?.subscribedCount || 0;
        const totalCount = userIds.length;
        const unsubscribedCount = totalCount - subscribedCount;

        return {
            total: totalCount,
            subscribed: subscribedCount,
            unsubscribed: unsubscribedCount
        };
    } catch (error) {
        console.error('Error getting direct referred users counts:', error);
        throw error;
    }
};


// Get subscription counts for indirect referred users
referralSchema.statics.getIndirectReferredUsersCounts = async function (referrerId) {
    try {
        // Get all indirect referrals (level 2 and 3)
        const indirectReferrals = await this.find({
            referrer: referrerId,
            referralLevel: { $in: [2, 3] }
        });

        // Extract userIds
        const userIds = indirectReferrals.map(ref => ref.referredUser);

        // Get subscription status for these userIds
        const subscriptionCounts = await mongoose.model('subscribe').aggregate([
            {
                $match: {
                    user: { $in: userIds }
                }
            },
            {
                $group: {
                    _id: null,
                    subscribedCount: { $sum: 1 }
                }
            }
        ]);

        const subscribedCount = subscriptionCounts[0]?.subscribedCount || 0;
        const totalCount = userIds.length;
        const unsubscribedCount = totalCount - subscribedCount;

        // Get counts by level
        const level2Referrals = indirectReferrals.filter(ref => ref.referralLevel === 2);
        const level3Referrals = indirectReferrals.filter(ref => ref.referralLevel === 3);

        return {
            total: totalCount,
            subscribed: subscribedCount,
            unsubscribed: unsubscribedCount,
            byLevel: {
                level2: level2Referrals.length,
                level3: level3Referrals.length
            }
        };
    } catch (error) {
        console.error('Error getting indirect referred users counts:', error);
        throw error;
    }
};

// Find users with unbalanced referral structure
referralSchema.statics.findUnbalancedAffiliators = async function () {
    try {
        // First get all referrers with their direct referral counts
        const directReferrals = await this.aggregate([
            {
                $match: { referralLevel: 1 }
            },
            {
                $group: {
                    _id: '$referrer',
                    directCount: { $sum: 1 }
                }
            },
            {
                $match: {
                    directCount: { $lt: 50 } // Filter users with less than 8 direct referrals
                }
            }
        ]).allowDiskUse(true);

        const potentialReferrers = directReferrals.map(r => r._id);

        // Then get indirect referral counts only for those referrers
        const unbalancedUsers = await this.aggregate([
            {
                $match: {
                    referrer: { $in: potentialReferrers },
                    referralLevel: { $in: [2, 3] }
                }
            },
            {
                $group: {
                    _id: {
                        referrer: '$referrer',
                        level: '$referralLevel'
                    },
                    usersInLevel: { $push: '$referredUser' }
                }
            },
            {
                $group: {
                    _id: '$_id.referrer',
                    levels: {
                        $push: {
                            level: '$_id.level',
                            users: '$usersInLevel'
                        }
                    },
                    allIndirectUsers: {
                        $push: '$usersInLevel'
                    },
                    totalIndirectCount: {
                        $sum: { $size: '$usersInLevel' }
                    }
                }
            },
            {
                $lookup: {
                    from: 'subscribes',
                    let: {
                        users: {
                            $reduce: {
                                input: '$allIndirectUsers',
                                initialValue: [],
                                in: { $concatArrays: ['$$value', '$$this'] }
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $in: ['$user', '$$users'] }
                            }
                        }
                    ],
                    as: 'subscriptions'
                }
            },
            {
                $match: {
                    $or: [
                        { totalIndirectCount: { $gt: 50 } },  // More than 20 indirect referrals
                        { $expr: { $gt: [{ $size: '$subscriptions' }, 50] } }  // More than 8 subscribed indirect referrals
                    ]
                }
            },
            // Look up the direct referral counts
            {
                $lookup: {
                    from: 'referrals',
                    let: { referrerId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$referrer', '$$referrerId'] },
                                        { $eq: ['$referralLevel', 1] }
                                    ]
                                }
                            }
                        },
                        {
                            $count: 'count'
                        }
                    ],
                    as: 'directReferrals'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'referrer'
                }
            },
            { $unwind: '$referrer' },
            {
                $project: {
                    _id: 0,
                    name: '$referrer.name',
                    email: '$referrer.email',
                    directSubscribed: {
                        $ifNull: [{ $arrayElemAt: ['$directReferrals.count', 0] }, 0]
                    },
                    indirectSubscribed: { $size: '$subscriptions' },
                    totalIndirectCount: 1,
                    level2Count: {
                        $size: {
                            $reduce: {
                                input: {
                                    $filter: {
                                        input: '$levels',
                                        as: 'level',
                                        cond: { $eq: ['$$level.level', 2] }
                                    }
                                },
                                initialValue: [],
                                in: { $concatArrays: ['$$value', '$$this.users'] }
                            }
                        }
                    },
                    level3Count: {
                        $size: {
                            $reduce: {
                                input: {
                                    $filter: {
                                        input: '$levels',
                                        as: 'level',
                                        cond: { $eq: ['$$level.level', 3] }
                                    }
                                },
                                initialValue: [],
                                in: { $concatArrays: ['$$value', '$$this.users'] }
                            }
                        }
                    }
                }
            }
        ]).allowDiskUse(true);

        return unbalancedUsers;
    } catch (error) {
        console.error('Error finding unbalanced affiliators:', error);
        throw error;
    }
};

const ReferralModel = mongoose.model('Referral', referralSchema);

module.exports = ReferralModel;