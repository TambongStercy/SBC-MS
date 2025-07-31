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

async function recalculatePartnerTransactions(dryRun = true) {
    console.log(`🔄 Starting partner recalculation (DRY RUN: ${dryRun})`);
    
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
        
        // Process each referral
        for (const referral of referrals) {
            // Get subscriptions created after partner became active
            const subscriptions = await SubscriptionModel.find({
                user: referral.referredUser,
                createdAt: { $gte: partner.createdAt },
                status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] }
            });
            
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
                        sourcePaymentSessionId: `recalc-${sub._id}`,
                        createdAt: sub.createdAt
                    });
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

// Run script
async function main() {
    const dryRun = !process.argv.includes('--apply');
    
    try {
        // Connect to database using the existing connection module
        await connectDB();
        
        await recalculatePartnerTransactions(dryRun);
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

export { recalculatePartnerTransactions };