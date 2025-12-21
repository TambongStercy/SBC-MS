/**
 * Check Specific User Script
 *
 * This script investigates a specific user to understand their balance and referral data.
 *
 * Usage: node scripts/check-specific-user.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// User ID to check
const TARGET_USER_ID = '65d4ddea8ce5ffe48a44a8dd';

// Referral commission rates (in XAF)
const REFERRAL_COMMISSIONS = {
    1: 1000,  // Level 1
    2: 500,   // Level 2
    3: 250    // Level 3
};

// Models
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });
const referralSchema = new mongoose.Schema({}, { strict: false, collection: 'referrals' });
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

async function checkSpecificUser() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('🔗 Connecting to databases...\n');

        // Connect to databases
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to User Service DB');

        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to Payment Service DB\n');

        // Get models
        const User = userConnection.model('User', userSchema);
        const Subscription = userConnection.model('Subscription', subscriptionSchema);
        const Referral = userConnection.model('Referral', referralSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        console.log(`🔍 Investigating User: ${TARGET_USER_ID}\n`);
        console.log('═══════════════════════════════════════════════════════════════\n');

        // Get user details
        const user = await User.findById(TARGET_USER_ID).lean();

        if (!user) {
            console.log('❌ User not found!\n');
            return;
        }

        // Check if user is subscribed
        const userSubscription = await Subscription.findOne({
            user: TARGET_USER_ID,
            status: 'active',
            category: 'registration',
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        }).lean();

        const isUserSubscribed = !!userSubscription;

        // Get all subscribed users for checking referrals
        const subscribedUsers = await Subscription.find({
            status: 'active',
            category: 'registration',
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        }).distinct('user');

        const subscribedUserIds = subscribedUsers.map(id => id.toString());

        // Get user's referrals
        const referrals = await Referral.find({
            referrer: TARGET_USER_ID,
            archived: false
        }).lean();

        // Calculate expected earnings from subscribed referrals
        let expectedEarnings = 0;
        let subscribedReferralsCount = 0;
        const referralBreakdown = { lvl1: 0, lvl2: 0, lvl3: 0 };
        const subscribedReferralBreakdown = { lvl1: 0, lvl2: 0, lvl3: 0 };

        for (const referral of referrals) {
            const level = referral.referralLevel;
            referralBreakdown[`lvl${level}`]++;

            const isReferredUserSubscribed = subscribedUserIds.includes(
                referral.referredUser.toString()
            );

            if (isReferredUserSubscribed) {
                subscribedReferralsCount++;
                subscribedReferralBreakdown[`lvl${level}`]++;
                const commission = REFERRAL_COMMISSIONS[level] || 0;
                expectedEarnings += commission;
            }
        }

        // Get current balance
        const currentBalance = user.balance || 0;
        const usdBalance = user.usdBalance || 0;
        const activationBalance = user.activationBalance || 0;

        // Get all completed withdrawal transactions
        const withdrawals = await Transaction.find({
            userId: TARGET_USER_ID,
            type: 'withdrawal',
            status: 'completed',
            currency: 'XAF'
        }).lean();

        const totalWithdrawals = withdrawals.reduce((sum, tx) => {
            return sum + (tx.amount || 0);
        }, 0);

        // Calculate actual earnings
        const actualEarnings = currentBalance + totalWithdrawals;

        // Calculate discrepancy
        const discrepancy = actualEarnings - expectedEarnings;
        const discrepancyPercentage = expectedEarnings > 0
            ? ((discrepancy / expectedEarnings) * 100).toFixed(2)
            : 'N/A';

        // Display results
        console.log('👤 USER INFORMATION:');
        console.log(`   Name:              ${user.name || 'N/A'}`);
        console.log(`   Email:             ${user.email || 'N/A'}`);
        console.log(`   Phone:             ${user.phoneNumber || 'N/A'}`);
        console.log(`   Role:              ${user.role || 'user'}`);
        console.log(`   Created:           ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}`);
        console.log(`   Is Subscribed:     ${isUserSubscribed ? '✅ YES' : '❌ NO'}`);
        if (isUserSubscribed) {
            console.log(`   Subscription Type: ${userSubscription.subscriptionType}`);
        }

        console.log(`\n💰 BALANCE DATA:`);
        console.log(`   Current XAF Balance:       ${currentBalance.toFixed(2)} XAF`);
        console.log(`   USD Balance:               $${usdBalance.toFixed(2)}`);
        console.log(`   Activation Balance:        ${activationBalance.toFixed(2)} XAF`);

        console.log(`\n💸 WITHDRAWAL DATA:`);
        console.log(`   Total Withdrawals:         ${totalWithdrawals.toFixed(2)} XAF`);
        console.log(`   Withdrawal Count:          ${withdrawals.length}`);

        console.log(`\n👥 REFERRAL DATA:`);
        console.log(`   Total Referrals:           ${referrals.length}`);
        console.log(`   By Level:                  L1=${referralBreakdown.lvl1}, L2=${referralBreakdown.lvl2}, L3=${referralBreakdown.lvl3}`);
        console.log(`   Subscribed Referrals:      ${subscribedReferralsCount}`);
        console.log(`   Subscribed By Level:       L1=${subscribedReferralBreakdown.lvl1}, L2=${subscribedReferralBreakdown.lvl2}, L3=${subscribedReferralBreakdown.lvl3}`);

        console.log(`\n📊 EARNINGS ANALYSIS:`);
        console.log(`   Expected Earnings:         ${expectedEarnings.toFixed(2)} XAF (from subscribed referrals)`);
        console.log(`   Actual Earnings:           ${actualEarnings.toFixed(2)} XAF (balance + withdrawals)`);
        console.log(`   Discrepancy:               ${discrepancy.toFixed(2)} XAF`);
        console.log(`   Discrepancy Percentage:    ${discrepancyPercentage}%`);

        if (discrepancy > 0) {
            console.log(`\n⚠️ USER HAS ${discrepancy.toFixed(2)} XAF MORE THAN EXPECTED`);
            console.log(`   This means they have more money than referral commissions alone would provide.`);
        } else if (discrepancy < 0) {
            console.log(`\n⚠️ USER HAS ${Math.abs(discrepancy).toFixed(2)} XAF LESS THAN EXPECTED`);
            console.log(`   This means they have less money than expected from referrals.`);
        } else {
            console.log(`\n✅ BALANCE MATCHES EXPECTED EARNINGS EXACTLY`);
        }

        console.log(`\n🔍 ANALYSIS:`);
        if (!isUserSubscribed) {
            console.log(`   ⚠️ This user is NOT subscribed, so they were NOT analyzed by the previous script.`);
            console.log(`   The script only analyzed subscribed users.`);
        } else {
            console.log(`   ✅ This user IS subscribed and WAS analyzed by the previous script.`);
        }

        if (currentBalance >= 50000 && subscribedReferralsCount <= 10) {
            console.log(`   🚨 HIGH BALANCE with FEW SUBSCRIBED REFERRALS - SUSPICIOUS`);
        }

        if (expectedEarnings > 0) {
            const balancePerReferral = currentBalance / subscribedReferralsCount;
            console.log(`   Balance per subscribed referral: ${balancePerReferral.toFixed(2)} XAF`);
            if (balancePerReferral > 10000) {
                console.log(`   🚨 Very high balance per referral ratio`);
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        // Close connections
        if (userConnection) {
            await userConnection.close();
            console.log('✅ User Service DB connection closed');
        }
        if (paymentConnection) {
            await paymentConnection.close();
            console.log('✅ Payment Service DB connection closed');
        }
    }
}

// Run the script
checkSpecificUser().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
