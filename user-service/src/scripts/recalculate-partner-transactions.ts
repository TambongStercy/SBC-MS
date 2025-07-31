import mongoose from 'mongoose';
import connectDB from '../database/connection';
import PartnerModel, { IPartner } from '../database/models/partner.model';
import PartnerTransactionModel, { IPartnerTransaction, PartnerTransactionType } from '../database/models/partnerTransaction.model';
import ReferralModel, { IReferral } from '../database/models/referral.model';
import SubscriptionModel, { ISubscription, SubscriptionType, SubscriptionStatus } from '../database/models/subscription.model';
import UserModel, { IUser } from '../database/models/user.model';
import logger from '../utils/logger';

const log = logger.getLogger('RecalculatePartnerTransactions');

// Commission calculation constants (matching current system)
const PARTNER_RATES = {
    silver: 0.18,
    gold: 0.30
};

const PARTNER_COMMISSION_BASES = {
    [SubscriptionType.CLASSIQUE]: 250,
    [SubscriptionType.CIBLE]: 625,
    upgrade: 500 // For upgrades
};

interface PartnerRecalculationData {
    partnerId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    pack: 'silver' | 'gold';
    partnerCreatedAt: Date;
    currentAmount: number;
    recalculatedAmount: number;
    transactions: {
        amount: number;
        message: string;
        sourceSubscriptionType: SubscriptionType;
        referralLevelInvolved: 1 | 2 | 3;
        sourcePaymentSessionId?: string;
        createdAt: Date;
    }[];
}

class PartnerTransactionRecalculator {
    private dryRun: boolean;

    constructor(dryRun: boolean = true) {
        this.dryRun = dryRun;
    }

    async recalculateAllPartnerTransactions(): Promise<void> {
        log.info(`Starting partner transaction recalculation (DRY RUN: ${this.dryRun})`);

        try {
            // Step 1: Get all active partners
            const partners = await PartnerModel.find({ isActive: true }).lean();
            log.info(`Found ${partners.length} active partners to process`);

            const recalculationResults: PartnerRecalculationData[] = [];

            // Step 2: Process each partner
            for (const partner of partners) {
                const result = await this.recalculatePartnerTransactions(partner);
                if (result) {
                    recalculationResults.push(result);
                }
            }

            // Step 3: Apply changes if not dry run
            if (!this.dryRun) {
                await this.applyRecalculationResults(recalculationResults);
            }

            // Step 4: Generate summary report
            this.generateSummaryReport(recalculationResults);

        } catch (error) {
            log.error('Error during partner transaction recalculation:', error);
            throw error;
        }
    }

    private async recalculatePartnerTransactions(partner: IPartner): Promise<PartnerRecalculationData | null> {
        const partnerId = partner._id as mongoose.Types.ObjectId;
        const userId = partner.user as mongoose.Types.ObjectId;
        const partnerCreatedAt = partner.createdAt || new Date();

        log.info(`Processing partner ${partnerId} (User: ${userId}, Pack: ${partner.pack})`);

        try {
            // Get all referrals where this partner is the referrer
            const referrals = await ReferralModel.find({
                referrer: userId,
                archived: { $ne: true }
            }).lean();

            log.debug(`Found ${referrals.length} referrals for partner ${partnerId}`);

            const newTransactions: PartnerRecalculationData['transactions'] = [];
            let totalRecalculatedAmount = 0;

            // Process each referral
            for (const referral of referrals) {
                const referredUserId = referral.referredUser;
                const referralLevel = referral.referralLevel as 1 | 2 | 3;

                // Get all subscriptions for the referred user that were created after the partner became active
                const subscriptions = await SubscriptionModel.find({
                    user: referredUserId,
                    createdAt: { $gte: partnerCreatedAt }, // Only subscriptions after partner creation
                    status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] } // Include both active and expired
                }).lean();

                log.debug(`Found ${subscriptions.length} relevant subscriptions for referred user ${referredUserId} at level ${referralLevel}`);

                // Calculate commission for each subscription
                for (const subscription of subscriptions) {
                    const commission = this.calculatePartnerCommission(
                        partner.pack,
                        subscription.subscriptionType,
                        referralLevel,
                        false // Assume not upgrade for now - you might want to add upgrade detection logic
                    );

                    if (commission > 0) {
                        newTransactions.push({
                            amount: commission,
                            message: `Recalculated L${referralLevel} partner commission of ${commission} XAF from user ${referredUserId}'s ${subscription.subscriptionType} subscription.`,
                            sourceSubscriptionType: subscription.subscriptionType,
                            referralLevelInvolved: referralLevel,
                            sourcePaymentSessionId: `recalc-${subscription._id}`,
                            createdAt: subscription.createdAt
                        });

                        totalRecalculatedAmount += commission;
                    }
                }
            }

            // Sort transactions by creation date
            newTransactions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const result: PartnerRecalculationData = {
                partnerId,
                userId,
                pack: partner.pack,
                partnerCreatedAt,
                currentAmount: partner.amount || 0,
                recalculatedAmount: totalRecalculatedAmount,
                transactions: newTransactions
            };

            log.info(`Partner ${partnerId}: Current amount: ${result.currentAmount}, Recalculated: ${result.recalculatedAmount}, Difference: ${result.recalculatedAmount - result.currentAmount}`);

            return result;

        } catch (error) {
            log.error(`Error processing partner ${partnerId}:`, error);
            return null;
        }
    }

    private calculatePartnerCommission(
        partnerPack: 'silver' | 'gold',
        subscriptionType: SubscriptionType,
        referralLevel: 1 | 2 | 3,
        isUpgrade: boolean = false
    ): number {
        const partnerRate = PARTNER_RATES[partnerPack];

        let baseAmount = 0;
        if (isUpgrade) {
            baseAmount = PARTNER_COMMISSION_BASES.upgrade;
        } else {
            baseAmount = PARTNER_COMMISSION_BASES[subscriptionType] || 0;
        }

        return Math.round(baseAmount * partnerRate);
    }

    private async applyRecalculationResults(results: PartnerRecalculationData[]): Promise<void> {
        log.info('Applying recalculation results...');

        const session = await mongoose.startSession();

        try {
            await session.withTransaction(async () => {
                for (const result of results) {
                    // Clear existing partner transactions
                    await PartnerTransactionModel.deleteMany(
                        { partnerId: result.partnerId },
                        { session }
                    );

                    // Create new transactions
                    if (result.transactions.length > 0) {
                        const transactionsToCreate = result.transactions.map(tx => ({
                            partnerId: result.partnerId,
                            user: result.userId,
                            pack: result.pack,
                            transType: PartnerTransactionType.DEPOSIT,
                            message: tx.message,
                            amount: tx.amount,
                            sourcePaymentSessionId: tx.sourcePaymentSessionId,
                            sourceSubscriptionType: tx.sourceSubscriptionType,
                            referralLevelInvolved: tx.referralLevelInvolved,
                            createdAt: tx.createdAt,
                            updatedAt: tx.createdAt
                        }));

                        await PartnerTransactionModel.insertMany(transactionsToCreate, { session });
                    }

                    // Update partner balance
                    await PartnerModel.findByIdAndUpdate(
                        result.partnerId,
                        { amount: result.recalculatedAmount },
                        { session }
                    );

                    log.info(`Updated partner ${result.partnerId}: ${result.transactions.length} transactions, balance: ${result.recalculatedAmount}`);
                }
            });

            log.info('Successfully applied all recalculation results');

        } catch (error) {
            log.error('Error applying recalculation results:', error);
            throw error;
        } finally {
            await session.endSession();
        }
    }

    private generateSummaryReport(results: PartnerRecalculationData[]): void {
        log.info('\n=== PARTNER TRANSACTION RECALCULATION SUMMARY ===');

        let totalCurrentAmount = 0;
        let totalRecalculatedAmount = 0;
        let totalTransactions = 0;
        let partnersWithChanges = 0;

        const packSummary = {
            silver: { count: 0, currentAmount: 0, recalculatedAmount: 0, transactions: 0 },
            gold: { count: 0, currentAmount: 0, recalculatedAmount: 0, transactions: 0 }
        };

        for (const result of results) {
            totalCurrentAmount += result.currentAmount;
            totalRecalculatedAmount += result.recalculatedAmount;
            totalTransactions += result.transactions.length;

            if (result.currentAmount !== result.recalculatedAmount) {
                partnersWithChanges++;
            }

            // Pack-specific summary
            packSummary[result.pack].count++;
            packSummary[result.pack].currentAmount += result.currentAmount;
            packSummary[result.pack].recalculatedAmount += result.recalculatedAmount;
            packSummary[result.pack].transactions += result.transactions.length;
        }

        log.info(`Total Partners Processed: ${results.length}`);
        log.info(`Partners with Balance Changes: ${partnersWithChanges}`);
        log.info(`Total Current Amount: ${totalCurrentAmount} XAF`);
        log.info(`Total Recalculated Amount: ${totalRecalculatedAmount} XAF`);
        log.info(`Net Difference: ${totalRecalculatedAmount - totalCurrentAmount} XAF`);
        log.info(`Total New Transactions: ${totalTransactions}`);

        log.info('\n--- Pack Breakdown ---');
        for (const [pack, summary] of Object.entries(packSummary)) {
            log.info(`${pack.toUpperCase()} Partners:`);
            log.info(`  Count: ${summary.count}`);
            log.info(`  Current Amount: ${summary.currentAmount} XAF`);
            log.info(`  Recalculated Amount: ${summary.recalculatedAmount} XAF`);
            log.info(`  Difference: ${summary.recalculatedAmount - summary.currentAmount} XAF`);
            log.info(`  Transactions: ${summary.transactions}`);
        }

        if (this.dryRun) {
            log.info('\n*** THIS WAS A DRY RUN - NO CHANGES WERE APPLIED ***');
            log.info('Run with dryRun=false to apply changes');
        }

        log.info('=== END SUMMARY ===\n');
    }
}

// Main execution function
async function main() {
    const dryRun = process.argv.includes('--apply') ? false : true;

    if (dryRun) {
        log.info('Running in DRY RUN mode. Use --apply flag to actually apply changes.');
    } else {
        log.info('Running in APPLY mode. Changes will be made to the database.');
    }

    try {
        // Connect to database using the existing connection module
        await connectDB();

        const recalculator = new PartnerTransactionRecalculator(dryRun);
        await recalculator.recalculateAllPartnerTransactions();

        log.info('Partner transaction recalculation completed successfully');

    } catch (error) {
        log.error('Script execution failed:', error);
        process.exit(1);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            log.info('Disconnected from MongoDB');
        }
    }
}

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error);
}

export { PartnerTransactionRecalculator };