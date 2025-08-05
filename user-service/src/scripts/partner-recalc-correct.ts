import mongoose from 'mongoose';
import connectDB from '../database/connection';
import PartnerModel from '../database/models/partner.model';
import PartnerTransactionModel, { PartnerTransactionType } from '../database/models/partnerTransaction.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionType, SubscriptionStatus } from '../database/models/subscription.model';

// Commission rates and bases (from current system)
const PARTNER_RATES = { silver: 0.18, gold: 0.30 };
const PARTNER_COMMISSION_BASES = {
    [SubscriptionType.CLASSIQUE]: 250,
    [SubscriptionType.CIBLE]: 625
};

// Partner system launch date - only referrals after this date should count
const PARTNER_SYSTEM_LAUNCH_DATE = new Date('2024-09-01T00:00:00.000Z');

async function recalculatePartnerTransactionsCorrect(dryRun = true) {
    console.log(`🔄 Starting CORRECT partner recalculation (DRY RUN: ${dryRun})`);
    console.log(`📅 Partner system launched: ${PARTNER_SYSTEM_LAUNCH_DATE.toISOString()}`);
    console.log(`📋 Only counting referrals created after this date`);

    // Get all active partners
    const partners = await PartnerModel.find({ isActive: true });
    console.log(`📊 Found ${partners.length} active partners`);

    const results = [];

    for (const partner of partners) {
        console.log(`\n👤 Processing partner ${partner._id} (${partner.pack})`);

        // CORRECT LOGIC: Get referrals created after partner system launch
        const referrals = await ReferralModel.find({
            referrer: partner.user,
            archived: { $ne: true },
            createdAt: { $gte: PARTNER_SYSTEM_LAUNCH_DATE } // Only referrals after partner system launch
        });

        let newBalance = 0;
        const newTransactions = [];

        console.log(`  Found ${referrals.length} valid referrals (after ${PARTNER_SYSTEM_LAUNCH_DATE.toDateString()})`);

        // Process each valid referral
        for (const referral of referrals) {
            // Get ALL subscriptions for the referred user (regardless of when they were created)
            // This is correct because if someone was referred after the partner system launched,
            // the partner should get credit for all their subscriptions
            const subscriptions = await SubscriptionModel.find({
                user: referral.referredUser,
                status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
            });

            console.log(`    Referral ${referral.referredUser} (L${referral.referralLevel}): ${subscriptions.length} subscriptions`);

            // Calculate commission for each subscription
            for (const sub of subscriptions) {
                const baseAmount = PARTNER_COMMISSION_BASES[sub.subscriptionType] || 0;
                const commission = Math.round(baseAmount * PARTNER_RATES[partner.pack]);

                if (commission > 0) {
                    newBalance += commission;
                    newTransactions.push({
                        partnerId: partner._id,
                        user: partner.user,
                        pack: partner.pack,
                        transType: PartnerTransactionType.DEPOSIT,
                        message: `L${referral.referralLevel} commission from ${sub.subscriptionType} subscription`,
                        amount: commission,
                        sourceSubscriptionType: sub.subscriptionType,
                        referralLevelInvolved: referral.referralLevel,
                        sourcePaymentSessionId: `correct-recalc-${sub._id}`,
                        createdAt: sub.createdAt
                    });

                    console.log(`      Commission: ${commission} XAF from ${sub.subscriptionType} (${sub.createdAt.toDateString()})`);
                }
            }
        }

        const currentBalance = partner.amount || 0;
        const difference = newBalance - currentBalance;

        console.log(`  Current: ${currentBalance} XAF`);
        console.log(`  Recalculated: ${newBalance} XAF`);
        console.log(`  Difference: ${difference} XAF`);
        console.log(`  Transactions: ${newTransactions.length}`);

        results.push({
            partnerId: partner._id,
            currentBalance,
            newBalance,
            difference,
            transactions: newTransactions
        });

        // Apply changes if not dry run
        if (!dryRun && (difference !== 0 || newTransactions.length > 0)) {
            // Clear existing transactions
            await PartnerTransactionModel.deleteMany({ partnerId: partner._id });

            // Create new transactions
            if (newTransactions.length > 0) {
                await PartnerTransactionModel.insertMany(newTransactions);
            }

            // Update partner balance
            await PartnerModel.findByIdAndUpdate(partner._id, { amount: newBalance });

            console.log(`  ✅ Applied changes`);
        }
    }

    // Summary
    const totalCurrent = results.reduce((sum, r) => sum + r.currentBalance, 0);
    const totalNew = results.reduce((sum, r) => sum + r.newBalance, 0);
    const totalTransactions = results.reduce((sum, r) => sum + r.transactions.length, 0);
    const partnersWithChanges = results.filter(r => r.difference !== 0).length;

    console.log(`\n📈 SUMMARY:`);
    console.log(`Partners processed: ${results.length}`);
    console.log(`Partners with changes: ${partnersWithChanges}`);
    console.log(`Total current balance: ${totalCurrent} XAF`);
    console.log(`Total new balance: ${totalNew} XAF`);
    console.log(`Net difference: ${totalNew - totalCurrent} XAF`);
    console.log(`Total transactions: ${totalTransactions}`);

    if (dryRun) {
        console.log(`\n⚠️  DRY RUN - No changes applied. Use --apply to execute.`);
    }

    return results;
}

// Test specific partner function with correct logic
async function testSpecificPartnerCorrect(userId: string) {
    console.log(`🔍 Testing specific partner with CORRECT logic: ${userId}`);
    console.log(`📅 Partner system launched: ${PARTNER_SYSTEM_LAUNCH_DATE.toISOString()}`);

    const partner = await PartnerModel.findOne({ user: new mongoose.Types.ObjectId(userId) });
    if (!partner) {
        console.log('❌ Partner not found');
        return;
    }

    console.log(`Partner: ${partner._id} (${partner.pack})`);
    console.log(`Current amount: ${partner.amount || 0} XAF`);
    console.log(`Partner created: ${partner.createdAt}`);

    // Get referrals created after partner system launch
    const allReferrals = await ReferralModel.find({
        referrer: partner.user,
        archived: { $ne: true }
    });

    const validReferrals = await ReferralModel.find({
        referrer: partner.user,
        archived: { $ne: true },
        createdAt: { $gte: PARTNER_SYSTEM_LAUNCH_DATE }
    });

    console.log(`\nTotal referrals: ${allReferrals.length}`);
    console.log(`Valid referrals (after ${PARTNER_SYSTEM_LAUNCH_DATE.toDateString()}): ${validReferrals.length}`);

    let expectedCommission = 0;

    for (const referral of validReferrals) {
        const subscriptions = await SubscriptionModel.find({
            user: referral.referredUser,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
        });

        console.log(`  Referral ${referral.referredUser} (L${referral.referralLevel}): ${subscriptions.length} subscriptions`);
        console.log(`    Referral created: ${referral.createdAt.toDateString()}`);

        for (const sub of subscriptions) {
            const baseAmount = PARTNER_COMMISSION_BASES[sub.subscriptionType] || 0;
            const commission = Math.round(baseAmount * PARTNER_RATES[partner.pack]);
            expectedCommission += commission;

            console.log(`    ${sub.subscriptionType} (${sub.createdAt.toDateString()}): ${commission} XAF`);
        }
    }

    console.log(`\nExpected total commission: ${expectedCommission} XAF`);
    console.log(`Current balance: ${partner.amount || 0} XAF`);
    console.log(`Difference: ${expectedCommission - (partner.amount || 0)} XAF`);

    // Show invalid referrals for reference
    const invalidReferrals = allReferrals.filter(ref => ref.createdAt < PARTNER_SYSTEM_LAUNCH_DATE);
    if (invalidReferrals.length > 0) {
        console.log(`\n⚠️  Invalid referrals (before partner system launch): ${invalidReferrals.length}`);
        invalidReferrals.slice(0, 3).forEach((ref, index) => {
            console.log(`  ${index + 1}. ${ref.referredUser} - Created: ${ref.createdAt.toDateString()}`);
        });
    }
}

// Run script
async function main() {
    const dryRun = !process.argv.includes('--apply');
    const testMode = process.argv.includes('--test');
    const testUserId = process.argv.find(arg => arg.startsWith('--user='))?.split('=')[1];

    try {
        // Connect to database using the existing connection module
        await connectDB();

        if (testMode && testUserId) {
            await testSpecificPartnerCorrect(testUserId);
        } else {
            await recalculatePartnerTransactionsCorrect(dryRun);
        }

        console.log('\n✅ Script completed successfully');
    } catch (error) {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        }
    }
}

if (require.main === module) {
    main();
}

export { recalculatePartnerTransactionsCorrect, testSpecificPartnerCorrect };