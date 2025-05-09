const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Load .env from the parent user-service directory

// Define minimal schemas (only fields needed for the query)
const UserSchema = new mongoose.Schema({ _id: mongoose.Schema.Types.ObjectId });
const ReferralSchema = new mongoose.Schema({
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: Date,
    referralLevel: Number
});

const User = mongoose.model('User', UserSchema, 'users'); // Explicitly set collection name
const Referral = mongoose.model('Referral', ReferralSchema, 'referrals'); // Explicitly set collection name

async function findOrphanReferrals() {
    const dbUrl = 'mongodb+srv://stercytambong:w23N0S5Qb6kMUwTi@simbtech0.ljkwg8k.mongodb.net/SBC?retryWrites=true&w=majority';
    if (!dbUrl) {
        console.error('Error: DB_URL environment variable not set.');
        process.exit(1);
    }

    try {
        await mongoose.connect(dbUrl, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully.');

        const orphanReferrals = await Referral.aggregate([
            {
                $lookup: {
                    from: 'users', // Ensure this matches your users collection name
                    localField: 'referrer', // Field in referrals collection
                    foreignField: '_id',    // Field in users collection
                    as: 'referrerDoc'
                }
            },
            {
                $lookup: {
                    from: 'users', // Ensure this matches your users collection name
                    localField: 'referredUser',
                    foreignField: '_id',
                    as: 'referredUserDoc'
                }
            },
            {
                $match: {
                    $or: [
                        { 'referrerDoc': { $eq: [] } }, // Referrer not found
                        { 'referredUserDoc': { $eq: [] } } // Referred user not found
                    ]
                }
            },
            {
                $project: {
                    _id: 1,
                    referrer: 1,
                    referredUser: 1,
                    referralLevel: 1,
                    createdAt: 1,
                    referrerExists: { $cond: { if: { $eq: [{ $size: "$referrerDoc" }, 0] }, then: false, else: true } },
                    referredUserExists: { $cond: { if: { $eq: [{ $size: "$referredUserDoc" }, 0] }, then: false, else: true } }
                }
            }
        ]);

        if (orphanReferrals.length === 0) {
            console.log('No orphaned referrals found.');
        } else {
            console.log(`Found ${orphanReferrals.length} orphaned referrals:`);
            orphanReferrals.forEach(ref => {
                console.log(`  Referral ID: ${ref._id}, Referrer: ${ref.referrer} (Exists: ${ref.referrerExists}), Referred User: ${ref.referredUser} (Exists: ${ref.referredUserExists}), Level: ${ref.referralLevel}, Created: ${ref.createdAt}`);
            });
            // Optionally write to a file
            // const fs = require('fs');
            // fs.writeFileSync('orphan_referrals.json', JSON.stringify(orphanReferrals, null, 2));
            // console.log('Results saved to orphan_referrals.json');
        }

    } catch (error) {
        console.error('Error finding orphaned referrals:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
}

findOrphanReferrals(); 