/**
 * Negative Balance Analysis Script
 *
 * This script analyzes users who have negative balances and were last updated in December 2024.
 * It compares their actual balance to what their balance should be based on their transaction history.
 *
 * Formula for expected balance:
 *   Expected XAF Balance = SUM(XAF deposits) + SUM(USD->XAF conversions) - SUM(XAF withdrawals)
 *
 * Usage:
 *   npx ts-node src/scripts/analyze-negative-balances.ts           # Run analysis
 *   npx ts-node src/scripts/analyze-negative-balances.ts --verbose # Show detailed transactions
 */

import mongoose from 'mongoose';

// Production database connection strings
const PAYMENT_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27017/sbc_payment?authSource=admin';
const USER_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27017/sbc_users?authSource=admin';
// const PAYMENT_MONGODB_URI = 'mongodb://localhost:27017/sbc_payment_dev?authSource=admin';
// const USER_MONGODB_URI = 'mongodb://localhost:27017/sbc_user_dev?authSource=admin';

// Import transaction model
import TransactionModel, { TransactionType, TransactionStatus, Currency } from '../database/models/transaction.model';

// December 2025 date range (adjust as needed)
const DECEMBER_START = new Date('2025-12-01T00:00:00.000Z');
const DECEMBER_END = new Date('2025-12-31T23:59:59.999Z');

interface TransactionSummary {
    transactionId: string;
    type: string;
    amount: number;
    currency: string;
    status: string;
    description: string;
    createdAt: Date;
    conversionDetails?: {
        sourceAmount: number;
        sourceCurrency: string;
        targetAmount: number;
        targetCurrency: string;
    };
}

interface UserAnalysis {
    userId: string;
    userName?: string;
    email?: string;
    phoneNumber?: string;

    // Current balances
    currentXafBalance: number;
    currentUsdBalance: number;

    // Transaction totals
    totalXafDeposits: number;
    totalUsdToXafConversions: number;  // XAF received from USD conversions
    totalXafWithdrawals: number;
    totalFailedWithdrawals: number; // Failed/pending withdrawals (potential balance leak)
    totalOtherDebits: number;  // Other debits (transfers, fees, payments, etc.)
    totalOtherCredits: number; // Other credits (refunds, etc.)

    // Calculated expected balance
    expectedXafBalance: number;

    // Discrepancy
    discrepancy: number;

    // Transaction counts
    depositCount: number;
    conversionCount: number;
    withdrawalCount: number;
    failedWithdrawalCount: number;
    otherCount: number;

    // Raw transactions (for verbose mode)
    deposits: TransactionSummary[];
    conversions: TransactionSummary[];
    withdrawals: TransactionSummary[];
    failedWithdrawals: TransactionSummary[];
    otherTransactions: TransactionSummary[];

    updatedAt: Date;
}

// Create a separate connection for user-service database
let userConnection: mongoose.Connection;

async function connectToDatabases() {
    console.log('Connecting to MongoDB (payment database)...');
    await mongoose.connect(PAYMENT_MONGODB_URI);
    console.log('Connected to payment database');

    console.log('Connecting to MongoDB (user database)...');
    userConnection = mongoose.createConnection(USER_MONGODB_URI);
    await userConnection.asPromise();
    console.log('Connected to user database');
}

async function getUsersWithNegativeBalances(): Promise<any[]> {
    const UserModel = userConnection.collection('users');

    // Find users with negative balance, updated in December 2024
    const users = await UserModel.find({
        balance: { $lt: 0 },
        updatedAt: {
            $gte: DECEMBER_START,
            $lte: DECEMBER_END
        },
        deleted: { $ne: true }
    }).toArray();

    return users;
}

async function analyzeUserTransactions(userId: string): Promise<{
    deposits: TransactionSummary[];
    conversions: TransactionSummary[];
    withdrawals: TransactionSummary[];
    failedWithdrawals: TransactionSummary[];
    otherTransactions: TransactionSummary[];
    totalXafDeposits: number;
    totalUsdToXafConversions: number;
    totalXafWithdrawals: number;
    totalFailedWithdrawals: number;
    totalOtherDebits: number;
    totalOtherCredits: number;
}> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get all XAF deposits for this user
    const deposits = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.DEPOSIT,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED
    }).lean();

    // Get all USD->XAF conversions for this user
    const conversions = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.CONVERSION,
        status: TransactionStatus.COMPLETED,
        'metadata.conversionType': 'USD_to_XAF'
    }).lean();

    // Get all XAF withdrawals for this user (COMPLETED)
    const withdrawals = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.WITHDRAWAL,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED
    }).lean();

    // Get FAILED/REJECTED/PENDING withdrawals (these might have deducted balance without refunding)
    const failedWithdrawals = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.WITHDRAWAL,
        currency: Currency.XAF,
        status: {
            $in: [
                TransactionStatus.FAILED,
                TransactionStatus.CANCELLED,
                TransactionStatus.REJECTED_BY_ADMIN,
                TransactionStatus.EXPIRED,
                TransactionStatus.PENDING,
                TransactionStatus.PENDING_ADMIN_APPROVAL,
                TransactionStatus.PROCESSING
            ]
        }
    }).lean();

    // Get ALL other XAF transactions (transfers, fees, payments, activation transfers, etc.)
    const otherTransactions = await TransactionModel.find({
        userId: userObjectId,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED,
        type: {
            $nin: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL],
            $ne: TransactionType.CONVERSION  // exclude conversions since we handle them separately
        }
    }).lean();

    // Also get conversions that are NOT USD_to_XAF (like XAF_to_USD which would debit XAF)
    const xafToUsdConversions = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.CONVERSION,
        status: TransactionStatus.COMPLETED,
        'metadata.conversionType': 'XAF_to_USD'
    }).lean();

    // Calculate totals
    let totalXafDeposits = 0;
    const depositSummaries: TransactionSummary[] = [];

    for (const dep of deposits) {
        totalXafDeposits += dep.amount;
        depositSummaries.push({
            transactionId: dep.transactionId,
            type: dep.type,
            amount: dep.amount,
            currency: dep.currency,
            status: dep.status,
            description: dep.description,
            createdAt: dep.createdAt
        });
    }

    let totalUsdToXafConversions = 0;
    const conversionSummaries: TransactionSummary[] = [];

    for (const conv of conversions) {
        // For conversions, we want the XAF amount received
        const xafReceived = conv.metadata?.targetAmount || (conv.amount * 500);
        totalUsdToXafConversions += xafReceived;
        conversionSummaries.push({
            transactionId: conv.transactionId,
            type: conv.type,
            amount: conv.amount,
            currency: conv.currency,
            status: conv.status,
            description: conv.description,
            createdAt: conv.createdAt,
            conversionDetails: {
                sourceAmount: conv.metadata?.sourceAmount || conv.amount,
                sourceCurrency: conv.metadata?.sourceCurrency || 'USD',
                targetAmount: conv.metadata?.targetAmount || (conv.amount * 500),
                targetCurrency: conv.metadata?.targetCurrency || 'XAF'
            }
        });
    }

    let totalXafWithdrawals = 0;
    const withdrawalSummaries: TransactionSummary[] = [];

    for (const wit of withdrawals) {
        totalXafWithdrawals += wit.amount;
        withdrawalSummaries.push({
            transactionId: wit.transactionId,
            type: wit.type,
            amount: wit.amount,
            currency: wit.currency,
            status: wit.status,
            description: wit.description,
            createdAt: wit.createdAt
        });
    }

    // Process failed/pending withdrawals (potential balance leaks)
    let totalFailedWithdrawals = 0;
    const failedWithdrawalSummaries: TransactionSummary[] = [];

    for (const wit of failedWithdrawals) {
        totalFailedWithdrawals += wit.amount;
        failedWithdrawalSummaries.push({
            transactionId: wit.transactionId,
            type: wit.type,
            amount: wit.amount,
            currency: wit.currency,
            status: wit.status,
            description: wit.description,
            createdAt: wit.createdAt
        });
    }

    // Process other transactions (transfers, fees, payments, activation transfers, XAF->USD conversions)
    let totalOtherDebits = 0;
    let totalOtherCredits = 0;
    const otherSummaries: TransactionSummary[] = [];

    // Debit types: transfer out, fee, payment, activation_transfer_in (moves XAF to activation balance)
    const debitTypes = ['transfer', 'fee', 'payment', 'activation_transfer_in', 'sponsor_activation'];

    for (const tx of otherTransactions) {
        const isDebit = debitTypes.includes(tx.type) || tx.description?.toLowerCase().includes('débit');
        if (isDebit) {
            totalOtherDebits += tx.amount;
        } else {
            totalOtherCredits += tx.amount;
        }
        otherSummaries.push({
            transactionId: tx.transactionId,
            type: tx.type,
            amount: tx.amount,
            currency: tx.currency,
            status: tx.status,
            description: tx.description,
            createdAt: tx.createdAt
        });
    }

    // XAF->USD conversions are debits from XAF balance
    for (const conv of xafToUsdConversions) {
        const xafDebited = conv.metadata?.sourceAmount || conv.amount;
        totalOtherDebits += xafDebited;
        otherSummaries.push({
            transactionId: conv.transactionId,
            type: conv.type + ' (XAF→USD)',
            amount: xafDebited,
            currency: 'XAF',
            status: conv.status,
            description: conv.description,
            createdAt: conv.createdAt
        });
    }

    return {
        deposits: depositSummaries,
        otherTransactions: otherSummaries,
        failedWithdrawals: failedWithdrawalSummaries,
        totalOtherDebits,
        totalOtherCredits,
        totalFailedWithdrawals,
        conversions: conversionSummaries,
        withdrawals: withdrawalSummaries,
        totalXafDeposits,
        totalUsdToXafConversions,
        totalXafWithdrawals
    };
}

async function analyzeNegativeBalances(verbose: boolean = false): Promise<UserAnalysis[]> {
    console.log('\n=== Finding users with negative balances (updated in December 2024) ===\n');

    const users = await getUsersWithNegativeBalances();
    console.log(`Found ${users.length} users with negative balances updated in December 2024\n`);

    const analyses: UserAnalysis[] = [];

    for (const user of users) {
        const userId = user._id.toString();

        console.log(`Analyzing user: ${userId} (${user.name || 'Unknown'})...`);

        const txAnalysis = await analyzeUserTransactions(userId);

        // Formula: Expected = Deposits + USD→XAF conversions + Other Credits - Withdrawals - Other Debits
        const expectedXafBalance =
            txAnalysis.totalXafDeposits +
            txAnalysis.totalUsdToXafConversions +
            txAnalysis.totalOtherCredits -
            txAnalysis.totalXafWithdrawals -
            txAnalysis.totalOtherDebits;
        const discrepancy = expectedXafBalance - (user.balance || 0);

        const analysis: UserAnalysis = {
            userId,
            userName: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber,
            currentXafBalance: user.balance || 0,
            currentUsdBalance: user.usdBalance || 0,
            totalXafDeposits: txAnalysis.totalXafDeposits,
            totalUsdToXafConversions: txAnalysis.totalUsdToXafConversions,
            totalXafWithdrawals: txAnalysis.totalXafWithdrawals,
            totalFailedWithdrawals: txAnalysis.totalFailedWithdrawals,
            totalOtherDebits: txAnalysis.totalOtherDebits,
            totalOtherCredits: txAnalysis.totalOtherCredits,
            expectedXafBalance,
            discrepancy,
            depositCount: txAnalysis.deposits.length,
            conversionCount: txAnalysis.conversions.length,
            withdrawalCount: txAnalysis.withdrawals.length,
            failedWithdrawalCount: txAnalysis.failedWithdrawals.length,
            otherCount: txAnalysis.otherTransactions.length,
            deposits: txAnalysis.deposits,
            conversions: txAnalysis.conversions,
            withdrawals: txAnalysis.withdrawals,
            failedWithdrawals: txAnalysis.failedWithdrawals,
            otherTransactions: txAnalysis.otherTransactions,
            updatedAt: user.updatedAt
        };

        analyses.push(analysis);
    }

    return analyses;
}

function printResults(analyses: UserAnalysis[], verbose: boolean) {
    console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           NEGATIVE BALANCE ANALYSIS RESULTS                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

    // Sort by discrepancy (largest first)
    analyses.sort((a, b) => Math.abs(b.discrepancy) - Math.abs(a.discrepancy));

    for (const analysis of analyses) {
        console.log('─'.repeat(100));
        console.log(`USER: ${analysis.userName || 'Unknown'}`);
        console.log(`ID: ${analysis.userId}`);
        console.log(`Email: ${analysis.email || 'N/A'}`);
        console.log(`Phone: ${analysis.phoneNumber || 'N/A'}`);
        console.log(`Last Updated: ${analysis.updatedAt?.toISOString() || 'N/A'}`);
        console.log('');
        console.log('CURRENT BALANCES:');
        console.log(`  XAF Balance: ${analysis.currentXafBalance.toLocaleString()} XAF`);
        console.log(`  USD Balance: ${analysis.currentUsdBalance.toFixed(2)} USD`);
        console.log('');
        console.log('TRANSACTION TOTALS:');
        console.log(`  XAF Deposits:           +${analysis.totalXafDeposits.toLocaleString()} XAF (${analysis.depositCount} transactions)`);
        console.log(`  USD→XAF Conversions:    +${analysis.totalUsdToXafConversions.toLocaleString()} XAF (${analysis.conversionCount} transactions)`);
        console.log(`  Other Credits:          +${analysis.totalOtherCredits.toLocaleString()} XAF`);
        console.log(`  XAF Withdrawals:        -${analysis.totalXafWithdrawals.toLocaleString()} XAF (${analysis.withdrawalCount} transactions)`);
        console.log(`  Other Debits:           -${analysis.totalOtherDebits.toLocaleString()} XAF (${analysis.otherCount} transactions)`);
        if (analysis.failedWithdrawalCount > 0) {
            console.log(`  ⚠️ FAILED/PENDING WDLS:  ${analysis.totalFailedWithdrawals.toLocaleString()} XAF (${analysis.failedWithdrawalCount} transactions) - POTENTIAL BALANCE LEAK!`);
        }
        console.log('');
        console.log('CALCULATION:');
        const formula = `${analysis.totalXafDeposits.toLocaleString()} + ${analysis.totalUsdToXafConversions.toLocaleString()} + ${analysis.totalOtherCredits.toLocaleString()} - ${analysis.totalXafWithdrawals.toLocaleString()} - ${analysis.totalOtherDebits.toLocaleString()}`;
        console.log(`  Expected Balance: ${formula} = ${analysis.expectedXafBalance.toLocaleString()} XAF`);
        console.log(`  Actual Balance:   ${analysis.currentXafBalance.toLocaleString()} XAF`);
        console.log('');

        if (analysis.discrepancy !== 0) {
            const discrepancyStr = analysis.discrepancy > 0
                ? `+${analysis.discrepancy.toLocaleString()} XAF (user has LESS than expected)`
                : `${analysis.discrepancy.toLocaleString()} XAF (user has MORE than expected)`;
            console.log(`  ⚠️  DISCREPANCY: ${discrepancyStr}`);
        } else {
            console.log(`  ✅ NO DISCREPANCY - Balance matches transactions`);
        }

        if (verbose) {
            console.log('\n  DEPOSIT TRANSACTIONS:');
            if (analysis.deposits.length === 0) {
                console.log('    (none)');
            } else {
                for (const dep of analysis.deposits.slice(0, 10)) {
                    console.log(`    ${dep.createdAt.toISOString().slice(0, 10)} | +${dep.amount.toLocaleString()} XAF | ${dep.description.slice(0, 50)}`);
                }
                if (analysis.deposits.length > 10) {
                    console.log(`    ... and ${analysis.deposits.length - 10} more`);
                }
            }

            console.log('\n  CONVERSION TRANSACTIONS (USD→XAF):');
            if (analysis.conversions.length === 0) {
                console.log('    (none)');
            } else {
                for (const conv of analysis.conversions.slice(0, 10)) {
                    const details = conv.conversionDetails;
                    console.log(`    ${conv.createdAt.toISOString().slice(0, 10)} | ${details?.sourceAmount} USD → +${details?.targetAmount?.toLocaleString()} XAF`);
                }
                if (analysis.conversions.length > 10) {
                    console.log(`    ... and ${analysis.conversions.length - 10} more`);
                }
            }

            console.log('\n  WITHDRAWAL TRANSACTIONS:');
            if (analysis.withdrawals.length === 0) {
                console.log('    (none)');
            } else {
                for (const wit of analysis.withdrawals.slice(0, 10)) {
                    console.log(`    ${wit.createdAt.toISOString().slice(0, 10)} | -${wit.amount.toLocaleString()} XAF | ${wit.description.slice(0, 50)}`);
                }
                if (analysis.withdrawals.length > 10) {
                    console.log(`    ... and ${analysis.withdrawals.length - 10} more`);
                }
            }

            console.log('\n  OTHER TRANSACTIONS (transfers, fees, payments, etc.):');
            if (analysis.otherTransactions.length === 0) {
                console.log('    (none)');
            } else {
                for (const tx of analysis.otherTransactions.slice(0, 15)) {
                    const sign = tx.type.includes('refund') ? '+' : '-';
                    console.log(`    ${tx.createdAt.toISOString().slice(0, 10)} | ${sign}${tx.amount.toLocaleString()} XAF | [${tx.type}] ${tx.description?.slice(0, 40) || 'N/A'}`);
                }
                if (analysis.otherTransactions.length > 15) {
                    console.log(`    ... and ${analysis.otherTransactions.length - 15} more`);
                }
            }

            if (analysis.failedWithdrawals.length > 0) {
                console.log('\n  ⚠️ FAILED/PENDING WITHDRAWALS (may have deducted balance without completing):');
                for (const wit of analysis.failedWithdrawals) {
                    console.log(`    ${wit.createdAt.toISOString().slice(0, 10)} | -${wit.amount.toLocaleString()} XAF | [${wit.status}] ${wit.description?.slice(0, 40) || 'N/A'}`);
                }
            }
        }

        console.log('');
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                        SUMMARY                                                     ║');
    console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════╣');

    const totalNegativeBalance = analyses.reduce((sum, a) => sum + a.currentXafBalance, 0);
    const totalExpectedBalance = analyses.reduce((sum, a) => sum + a.expectedXafBalance, 0);
    const totalDiscrepancy = analyses.reduce((sum, a) => sum + a.discrepancy, 0);
    const usersWithDiscrepancy = analyses.filter(a => a.discrepancy !== 0).length;

    console.log(`║  Total Users Analyzed: ${analyses.length.toString().padStart(70)} ║`);
    console.log(`║  Users with Discrepancy: ${usersWithDiscrepancy.toString().padStart(68)} ║`);
    console.log(`║  Total Current Balance: ${totalNegativeBalance.toLocaleString().padStart(69)} XAF ║`);
    console.log(`║  Total Expected Balance: ${totalExpectedBalance.toLocaleString().padStart(68)} XAF ║`);
    console.log(`║  Total Discrepancy: ${totalDiscrepancy.toLocaleString().padStart(73)} XAF ║`);
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════╝');
}

async function main() {
    const verbose = process.argv.includes('--verbose');

    console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           NEGATIVE BALANCE ANALYSIS SCRIPT                                        ║');
    console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════╣');
    console.log('║  Analyzes users with negative XAF balances (updated December 2024)                                ║');
    console.log('║  Compares actual balance to expected balance from transaction history                             ║');
    console.log('║                                                                                                   ║');
    console.log('║  Formula: Expected = SUM(XAF deposits) + SUM(USD→XAF conversions) - SUM(XAF withdrawals)          ║');
    console.log(`║  Mode: ${verbose ? 'VERBOSE (show transactions)' : 'SUMMARY ONLY            '}                                                              ║`);
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════╝');

    try {
        await connectToDatabases();

        const analyses = await analyzeNegativeBalances(verbose);

        if (analyses.length === 0) {
            console.log('\nNo users found with negative balances updated in December 2024.');
        } else {
            printResults(analyses, verbose);
        }

    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        if (userConnection) {
            await userConnection.close();
        }
        console.log('\nDisconnected from MongoDB');
    }
}

main();
