/**
 * Check user's referrers (who referred this user)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';

const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const referralSchema = new mongoose.Schema({}, { strict: false, collection: 'referrals' });

async function checkUserReferrers(userId) {
    let connection;
    try {
        connection = await mongoose.createConnection(USER_DB_URI).asPromise();
        const User = connection.model('User', userSchema);
        const Referral = connection.model('Referral', referralSchema);

        console.log(`\n🔍 Checking referrers for user: ${userId}\n`);

        // Get user details
        const user = await User.findById(userId).lean();
        if (user) {
            console.log('👤 User Details:');
            console.log(`   Name: ${user.name}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Phone: ${user.phoneNumber}`);
            console.log(`   referredBy: ${user.referredBy || 'None'}`);
            console.log();
        } else {
            console.log('❌ User not found');
            return;
        }

        // Find who referred this user (this user is the referredUser)
        const referrals = await Referral.find({
            referredUser: new mongoose.Types.ObjectId(userId),
            archived: false
        }).lean();

        console.log(`📊 Found ${referrals.length} referral records where this user was referred:\n`);

        for (const ref of referrals) {
            const referrer = await User.findById(ref.referrer).lean();
            console.log(`   Level ${ref.referralLevel}: ${referrer?.name || 'Unknown'} (${ref.referrer})`);
        }

        // Check if user has referredBy field
        if (user.referredBy) {
            console.log(`\n📌 User's referredBy field points to: ${user.referredBy}`);
            const directReferrer = await User.findById(user.referredBy).lean();
            if (directReferrer) {
                console.log(`   Direct Referrer: ${directReferrer.name} (${directReferrer.email})`);
            }
        } else {
            console.log('\n⚠️ User has NO referredBy field - they have no referrer!');
            console.log('   This means commissions cannot be distributed because there is no one to receive them.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.close();
    }
}

// Check the user from the logs
checkUserReferrers('693680fcb719f2f5bbb4102b');
