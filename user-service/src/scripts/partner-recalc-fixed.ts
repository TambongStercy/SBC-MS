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

async function recalculatePartnerTransactionsFixed(dryRun = true) {
    console.log(`🔄 Starting FIXED partner recalculation (DRY RUN: ${dryRun})`);
    
    // Get all active partners
    const partners = await PartnerModel.find({ isActive: true });
    console.log(`📊 Found ${partners.length} active partners`);
    
    const results = [];
    
    for (const partner of partners) {
        console.log(`\n👤 Processing partner ${partner._id} (${partner.pack})`);
        
        // Get referrals for this partner
        const referrals = await ReferralModel.find({
            referrer: partner.user,
            archived: { $ne: true }
        });
        
        let newBalance = 0;
        const newTransactions = [];
        
        console.log(`  Found ${referrals.length} referrals`);
        
        // Process each referral
        for (const referral of referrals) {
            // FIXED LOGIC: Get ALL subscriptions for referred users
            // We'll use different logic based on business requirements
            
            // Option 1: Count all subscriptions (regardless of when they were created)
            const allSubscriptions = await SubscriptionModel.find({
                user: referral.referredUser,
                status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
            });
            
            // Option 2: Count subscriptions created after referral creation
            const subscriptionsAfterReferral = await SubscriptionModel.find({
                user: referral.referredUser,
                createdAt: { $gte: referral.createdAt },
                status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
            });
            
            // Option 3: Count subscriptions created after partner creation
            const subscriptionsAfterPartner = await SubscriptionModel.find({
                user: referral.referredUser,
                createdAt: { $gte: partner.createdAt },
                status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
            });
            
            console.log(`    Referral ${referral.referredUser} (L${referral.referralLevel}):`);
            console.log(`      All subscriptions: ${allSubscriptions.length}`);
            console.log(`      After referral: ${subscriptionsAfterReferral.length}`);
            console.log(`      After partner: ${subscriptionsAfterPartner.length}`);
            
            // BUSINESS DECISION: Which subscriptions should count?
            // For now, let's use ALL subscriptions (Option 1) since the referral relationship exists
            const subscriptionsToCount = allSubscriptions;
            
            // Calculate commission for each subscription
            for (const sub of subscriptionsToCount) {
                const baseAmount = PARTNER_COMMISSION_BASES[sub.subscriptionType] || 0;
                const commission = Math.round(baseAmount * PARTNER_RATES[partner.pack]);
                
                if (commission > 0) {
                    newBalance += commission;
                    newTransactions.push({
                        partnerId: partner._id,
                        user: partner.user,
                        pack: partner.pack,
                        transType: PartnerTransactionType.DEPOSIT,
                        message: `L${referral.referralLevel} commission from ${sub.subscriptionType} subscription (Fixed calculation)`,
                        amount: commission,
                        sourceSubscriptionType: sub.subscriptionType,
                        referralLevelInvolved: referral.referralLevel,
                        sourcePaymentSessionId: `fixed-recalc-${sub._id}`,
                        createdAt: sub.createdAt
                    });
                    
                    console.log(`      Commission: ${commission} XAF from ${sub.subscriptionType}`);
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
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`Partners processed: ${results.length}`);
    console.log(`Total current balance: ${totalCurrent} XAF`);
    console.log(`Total new balance: ${totalNew} XAF`);
    console.log(`Net difference: ${totalNew - totalCurrent} XAF`);
    console.log(`Total transactions: ${totalTransactions}`);
    
    if (dryRun) {
        console.log(`\n⚠️  DRY RUN - No changes applied. Use --apply to execute.`);
    }
    
    return results;
}

// Test specific partner function
async function testSpecificPartner(userId: string) {
    console.log(`🔍 Testing specific partner: ${userId}`);
    
    const partner = await PartnerModel.findOne({ user: new mongoose.Types.ObjectId(userId) });
    if (!partner) {
        console.log('❌ Partner not found');
        return;
    }
    
    console.log(`Partner: ${partner._id} (${partner.pack})`);
    console.log(`Current amount: ${partner.amount || 0} XAF`);
    console.log(`Partner created: ${partner.createdAt}`);
    
    const referrals = await ReferralModel.find({
        referrer: partner.user,
        archived: { $ne: true }
    });
    
    console.log(`\nReferrals: ${referrals.length}`);
    
    let expectedCommission = 0;
    
    for (const referral of referrals) {
        const subscriptions = await SubscriptionModel.find({
            user: referral.referredUser,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
        });
        
        console.log(`  Referral ${referral.referredUser} (L${referral.referralLevel}): ${subscriptions.length} subscriptions`);
        
        for (const sub of subscriptions) {
            const baseAmount = PARTNER_COMMISSION_BASES[sub.subscriptionType] || 0;
            const commission = Math.round(baseAmount * PARTNER_RATES[partner.pack]);
            expectedCommission += commission;
            
            console.log(`    ${sub.subscriptionType} (${sub.createdAt}): ${commission} XAF`);
        }
    }
    
    console.log(`\nExpected total commission: ${expectedCommission} XAF`);
    console.log(`Current balance: ${partner.amount || 0} XAF`);
    console.log(`Difference: ${expectedCommission - (partner.amount || 0)} XAF`);
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
            await testSpecificPartner(testUserId);
        } else {
            await recalculatePartnerTransactionsFixed(dryRun);
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

export { recalculatePartnerTransactionsFixed, testSpecificPartner };