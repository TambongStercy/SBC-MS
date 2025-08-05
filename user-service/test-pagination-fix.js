// Test script to verify pagination fix
// Run with: node test-pagination-fix.js

const mongoose = require('mongoose');

// Connect to database
mongoose.connect('mongodb://127.0.0.1:27017/sbc_user_dev');

// Define schemas (simplified)
const referralSchema = new mongoose.Schema({
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referralLevel: Number,
    archived: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phoneNumber: String,
    deleted: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false }
});

const Referral = mongoose.model('Referral', referralSchema);
const User = mongoose.model('User', userSchema);

async function testPaginationFix() {
    try {
        console.log('=== TESTING PAGINATION FIX ===\n');

        // Find a user with many referrals
        const testUser = await Referral.findOne({ archived: { $ne: true } });
        if (!testUser) {
            console.log('No referrals found in database');
            return;
        }

        const referrerId = testUser.referrer;
        console.log(`Testing with referrer ID: ${referrerId}`);

        // Test the old way (count vs data mismatch)
        console.log('\n--- OLD METHOD (problematic) ---');
        const oldCount = await Referral.countDocuments({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        });

        const oldData = await Referral.find({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        })
        .populate('referredUser')
        .limit(10);

        const oldValidData = oldData.filter(ref => 
            ref.referredUser && 
            !ref.referredUser.deleted && 
            !ref.referredUser.blocked
        );

        console.log(`Old count: ${oldCount}`);
        console.log(`Old data (after filtering): ${oldValidData.length}`);
        console.log(`Mismatch: ${oldCount !== oldValidData.length ? 'YES' : 'NO'}`);

        // Test the new way (using aggregation)
        console.log('\n--- NEW METHOD (fixed) ---');
        const pipeline = [
            {
                $match: {
                    referrer: referrerId,
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

        // Get count with same filtering
        const countPipeline = [...pipeline, { $count: 'total' }];
        const countResult = await Referral.aggregate(countPipeline);
        const newCount = countResult[0]?.total || 0;

        // Get data with same filtering
        const dataPipeline = [
            ...pipeline,
            { $limit: 10 },
            {
                $project: {
                    _id: 1,
                    referrer: 1,
                    referralLevel: 1,
                    createdAt: 1,
                    'referredUser._id': '$referredUserData._id',
                    'referredUser.name': '$referredUserData.name',
                    'referredUser.email': '$referredUserData.email'
                }
            }
        ];

        const newData = await Referral.aggregate(dataPipeline);

        console.log(`New count: ${newCount}`);
        console.log(`New data: ${newData.length}`);
        console.log(`Mismatch: ${newCount !== newData.length ? 'YES' : 'NO'}`);

        console.log('\n=== RESULTS ===');
        console.log(`Fix successful: ${newCount === newData.length ? 'YES' : 'NO'}`);
        console.log(`Data consistency improved: ${Math.abs(oldCount - oldValidData.length) > Math.abs(newCount - newData.length) ? 'YES' : 'NO'}`);

        if (newData.length > 0) {
            console.log('\nSample data from new method:');
            newData.slice(0, 3).forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.referredUser?.name || 'N/A'} (${item.referredUser?.email || 'N/A'})`);
            });
        }

    } catch (error) {
        console.error('Error testing pagination fix:', error);
    } finally {
        mongoose.connection.close();
    }
}

testPaginationFix();