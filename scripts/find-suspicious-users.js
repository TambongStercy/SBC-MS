/**
 * Find Suspicious Users Script
 *
 * This script identifies users whose balances and transaction volumes are
 * disproportionately high compared to their referral activity.
 *
 * Usage: node scripts/find-suspicious-users.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const PAYMENT_DB_URI = process.env.PAYMENT_DB_URI || 'mongodb://localhost:27017/sbc_payment_dev';

// Thresholds for suspicious activity (can be adjusted)
const THRESHOLDS = {
    // Minimum balance to consider (in XAF)
    MIN_BALANCE: 50000,

    // Minimum transaction volume to consider (in XAF)
    MIN_TRANSACTION_VOLUME: 100000,

    // Maximum referrals for high balance users
    MAX_REFERRALS_FOR_HIGH_BALANCE: 10,

    // Balance per referral ratio (XAF per referral)
    // If user has 50,000 XAF but only 2 referrals, ratio = 25,000 (suspicious)
    SUSPICIOUS_BALANCE_PER_REFERRAL: 10000,

    // Transaction volume per referral ratio
    SUSPICIOUS_TRANSACTION_PER_REFERRAL: 20000
};

// User Schema (simplified)
const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });

// Transaction Schema (simplified)
const transactionSchema = new mongoose.Schema({}, { strict: false, collection: 'transactions' });

async function findSuspiciousUsers() {
    let userConnection;
    let paymentConnection;

    try {
        console.log('🔗 Connecting to databases...\n');

        // Connect to User Service DB
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to User Service DB');

        // Connect to Payment Service DB
        paymentConnection = await mongoose.createConnection(PAYMENT_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();
        console.log('✅ Connected to Payment Service DB\n');

        // Get models
        const User = userConnection.model('User', userSchema);
        const Transaction = paymentConnection.model('Transaction', transactionSchema);

        console.log('🔍 Analyzing users...\n');

        // Get users with significant balances
        const usersWithBalance = await User.find({
            $or: [
                { balance: { $gte: THRESHOLDS.MIN_BALANCE } },
                { usdBalance: { $gte: THRESHOLDS.MIN_BALANCE / 600 } } // ~USD equivalent
            ]
        }).lean();

        console.log(`📊 Found ${usersWithBalance.length} users with significant balances\n`);

        const suspiciousUsers = [];

        for (const user of usersWithBalance) {
            // Get referral count
            const referralCount = user.referredUsers?.length || 0;
            const totalReferrals = user.totalReferrals || referralCount;

            // Get transaction statistics
            const transactions = await Transaction.find({
                userId: user._id.toString(),
                status: 'completed'
            }).lean();

            const totalTransactionVolume = transactions.reduce((sum, tx) => {
                if (tx.currency === 'XAF') {
                    return sum + (tx.amount || 0);
                }
                return sum;
            }, 0);

            const balance = user.balance || 0;
            const usdBalance = user.usdBalance || 0;
            const totalBalance = balance + (usdBalance * 600); // Convert USD to XAF

            // Calculate ratios
            const balancePerReferral = totalReferrals > 0 ? totalBalance / totalReferrals : totalBalance;
            const transactionPerReferral = totalReferrals > 0 ? totalTransactionVolume / totalReferrals : totalTransactionVolume;

            // Check if user is suspicious
            const isSuspicious = (
                // High balance with few referrals
                (totalBalance >= THRESHOLDS.MIN_BALANCE &&
                 totalReferrals <= THRESHOLDS.MAX_REFERRALS_FOR_HIGH_BALANCE) ||

                // Balance per referral is too high
                (balancePerReferral >= THRESHOLDS.SUSPICIOUS_BALANCE_PER_REFERRAL) ||

                // Transaction volume per referral is too high
                (totalTransactionVolume >= THRESHOLDS.MIN_TRANSACTION_VOLUME &&
                 transactionPerReferral >= THRESHOLDS.SUSPICIOUS_TRANSACTION_PER_REFERRAL)
            );

            if (isSuspicious) {
                suspiciousUsers.push({
                    userId: user._id.toString(),
                    name: user.name,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    role: user.role,
                    balance: balance.toFixed(2),
                    usdBalance: usdBalance.toFixed(2),
                    totalBalance: totalBalance.toFixed(2),
                    referralCount: totalReferrals,
                    transactionCount: transactions.length,
                    totalTransactionVolume: totalTransactionVolume.toFixed(2),
                    balancePerReferral: balancePerReferral.toFixed(2),
                    transactionPerReferral: transactionPerReferral.toFixed(2),
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin,
                    flags: []
                });

                // Add specific flags
                const lastUser = suspiciousUsers[suspiciousUsers.length - 1];

                if (totalBalance >= THRESHOLDS.MIN_BALANCE && totalReferrals === 0) {
                    lastUser.flags.push('⚠️ HIGH BALANCE - NO REFERRALS');
                }

                if (totalBalance >= THRESHOLDS.MIN_BALANCE && totalReferrals <= THRESHOLDS.MAX_REFERRALS_FOR_HIGH_BALANCE) {
                    lastUser.flags.push('⚠️ HIGH BALANCE - FEW REFERRALS');
                }

                if (balancePerReferral >= THRESHOLDS.SUSPICIOUS_BALANCE_PER_REFERRAL * 2) {
                    lastUser.flags.push('🚨 VERY HIGH BALANCE PER REFERRAL');
                }

                if (transactionPerReferral >= THRESHOLDS.SUSPICIOUS_TRANSACTION_PER_REFERRAL * 2) {
                    lastUser.flags.push('🚨 VERY HIGH TRANSACTIONS PER REFERRAL');
                }

                if (transactions.length >= 50 && totalReferrals <= 5) {
                    lastUser.flags.push('⚠️ MANY TRANSACTIONS - FEW REFERRALS');
                }
            }
        }

        // Sort by balance per referral (most suspicious first)
        suspiciousUsers.sort((a, b) => parseFloat(b.balancePerReferral) - parseFloat(a.balancePerReferral));

        // Display results
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🚨 SUSPICIOUS USERS REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');

        console.log(`Total Suspicious Users: ${suspiciousUsers.length}\n`);

        if (suspiciousUsers.length === 0) {
            console.log('✅ No suspicious users found based on current thresholds.\n');
        } else {
            suspiciousUsers.forEach((user, index) => {
                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`#${index + 1} - ${user.name}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`User ID:           ${user.userId}`);
                console.log(`Email:             ${user.email}`);
                console.log(`Phone:             ${user.phoneNumber || 'N/A'}`);
                console.log(`Role:              ${user.role || 'user'}`);
                console.log(`Created:           ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}`);
                console.log(`\n💰 FINANCIAL DATA:`);
                console.log(`   Balance (XAF):           ${user.balance} XAF`);
                console.log(`   Balance (USD):           $${user.usdBalance}`);
                console.log(`   Total Balance (XAF):     ${user.totalBalance} XAF`);
                console.log(`   Transaction Count:       ${user.transactionCount}`);
                console.log(`   Transaction Volume:      ${user.totalTransactionVolume} XAF`);
                console.log(`\n👥 REFERRAL DATA:`);
                console.log(`   Total Referrals:         ${user.referralCount}`);
                console.log(`\n📊 RATIOS (SUSPICIOUS IF HIGH):`);
                console.log(`   Balance/Referral:        ${user.balancePerReferral} XAF/referral`);
                console.log(`   Transactions/Referral:   ${user.transactionPerReferral} XAF/referral`);

                if (user.flags.length > 0) {
                    console.log(`\n🚩 FLAGS:`);
                    user.flags.forEach(flag => console.log(`   ${flag}`));
                }
            });

            console.log('\n\n═══════════════════════════════════════════════════════════════');
            console.log('📈 SUMMARY STATISTICS');
            console.log('═══════════════════════════════════════════════════════════════\n');

            const avgBalance = suspiciousUsers.reduce((sum, u) => sum + parseFloat(u.totalBalance), 0) / suspiciousUsers.length;
            const avgReferrals = suspiciousUsers.reduce((sum, u) => sum + u.referralCount, 0) / suspiciousUsers.length;
            const avgTransactions = suspiciousUsers.reduce((sum, u) => sum + u.transactionCount, 0) / suspiciousUsers.length;
            const totalSuspiciousBalance = suspiciousUsers.reduce((sum, u) => sum + parseFloat(u.totalBalance), 0);

            console.log(`Average Balance:              ${avgBalance.toFixed(2)} XAF`);
            console.log(`Average Referrals:            ${avgReferrals.toFixed(2)}`);
            console.log(`Average Transactions:         ${avgTransactions.toFixed(2)}`);
            console.log(`Total Suspicious Balance:     ${totalSuspiciousBalance.toFixed(2)} XAF\n`);

            // Export to JSON
            const fs = require('fs');
            const outputPath = './suspicious-users-report.json';
            fs.writeFileSync(outputPath, JSON.stringify({
                generatedAt: new Date().toISOString(),
                thresholds: THRESHOLDS,
                totalSuspiciousUsers: suspiciousUsers.length,
                users: suspiciousUsers,
                summary: {
                    avgBalance,
                    avgReferrals,
                    avgTransactions,
                    totalSuspiciousBalance
                }
            }, null, 2));

            console.log(`📄 Full report exported to: ${outputPath}\n`);
        }

        console.log('═══════════════════════════════════════════════════════════════\n');

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
findSuspiciousUsers().then(() => {
    console.log('\n✨ Analysis complete!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
