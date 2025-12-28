/**
 * Fix User Balances Script
 *
 * This script recalculates user balances based on all completed transactions
 * and updates them to the correct values.
 *
 * Formula for XAF balance:
 *   Correct Balance = SUM(XAF deposits) + SUM(USD→XAF conversion credits) - SUM(XAF withdrawals) - SUM(XAF→USD conversion debits) - SUM(other debits) + SUM(other credits)
 *
 * Usage:
 *   npx ts-node src/scripts/fix-user-balances.ts                    # Dry run (analysis only)
 *   npx ts-node src/scripts/fix-user-balances.ts --apply            # Apply fixes
 *   npx ts-node src/scripts/fix-user-balances.ts --user <userId>    # Analyze specific user only
 */

import mongoose from 'mongoose';

// Database connection strings
const PAYMENT_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_payment?authSource=admin';
const USER_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin';

// Import transaction model
import TransactionModel, { TransactionType, TransactionStatus, Currency } from '../database/models/transaction.model';

interface BalanceCalculation {
    userId: string;
    userName?: string;
    email?: string;

    // Current balances
    currentXafBalance: number;

    // Transaction components
    totalXafDeposits: number;
    totalXafFromConversions: number;  // XAF received from USD→XAF conversions
    totalXafWithdrawals: number;
    totalXafToConversions: number;    // XAF spent on XAF→USD conversions
    totalOtherDebits: number;
    totalOtherCredits: number;

    // Calculated correct balance
    correctXafBalance: number;

    // Difference
    difference: number;

    // Transaction counts for debugging
    depositCount: number;
    withdrawalCount: number;
    usdToXafConversionCount: number;
    xafToUsdConversionCount: number;
    otherTransactionCount: number;
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

// December 2025 date range
const DECEMBER_START = new Date('2025-12-01T00:00:00.000Z');
const DECEMBER_END = new Date('2025-12-31T23:59:59.999Z');

async function getUsers(specificUserId?: string, negativeBalanceOnly: boolean = false): Promise<any[]> {
    const UserModel = userConnection.collection('users');

    const query: any = { deleted: { $ne: true } };

    if (specificUserId) {
        query._id = new mongoose.Types.ObjectId(specificUserId);
    }

    if (negativeBalanceOnly) {
        query.balance = { $lt: 0 };
        query.updatedAt = {
            $gte: DECEMBER_START,
            $lte: DECEMBER_END
        };
    }

    const users = await UserModel.find(query).toArray();
    return users;
}

async function calculateCorrectBalance(userId: string): Promise<BalanceCalculation | null> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get user info
    const UserModel = userConnection.collection('users');
    const user = await UserModel.findOne({ _id: userObjectId });

    if (!user) {
        return null;
    }

    // 1. Get all COMPLETED XAF deposits
    const deposits = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.DEPOSIT,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED
    }).lean();

    let totalXafDeposits = 0;
    for (const dep of deposits) {
        totalXafDeposits += dep.amount || 0;
    }

    // 2. Get all COMPLETED USD→XAF conversions (credits XAF)
    const usdToXafConversions = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.CONVERSION,
        status: TransactionStatus.COMPLETED,
        'metadata.conversionType': 'USD_to_XAF'
    }).lean();

    let totalXafFromConversions = 0;
    for (const conv of usdToXafConversions) {
        // The XAF amount credited is in metadata.targetAmount
        const xafAmount = conv.metadata?.targetAmount || (conv.amount * 500);
        totalXafFromConversions += xafAmount;
    }

    // 3. Get all COMPLETED XAF withdrawals
    const withdrawals = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.WITHDRAWAL,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED
    }).lean();

    let totalXafWithdrawals = 0;
    for (const wit of withdrawals) {
        totalXafWithdrawals += wit.amount || 0;
    }

    // 4. Get all COMPLETED XAF→USD conversions (debits XAF)
    const xafToUsdConversions = await TransactionModel.find({
        userId: userObjectId,
        type: TransactionType.CONVERSION,
        status: TransactionStatus.COMPLETED,
        'metadata.conversionType': 'XAF_to_USD'
    }).lean();

    let totalXafToConversions = 0;
    for (const conv of xafToUsdConversions) {
        // The XAF amount debited is in metadata.sourceAmount
        const xafAmount = conv.metadata?.sourceAmount || conv.amount;
        totalXafToConversions += xafAmount;
    }

    // 5. Get all other COMPLETED XAF transactions (transfers, fees, payments, activation transfers, etc.)
    const otherTransactions = await TransactionModel.find({
        userId: userObjectId,
        currency: Currency.XAF,
        status: TransactionStatus.COMPLETED,
        type: {
            $nin: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL, TransactionType.CONVERSION]
        }
    }).lean();

    // Categorize other transactions as debits or credits
    const debitTypes = ['transfer', 'fee', 'payment', 'activation_transfer_in', 'sponsor_activation'];
    const creditTypes = ['refund', 'activation_transfer_out']; // activation_transfer_out means receiving from someone

    let totalOtherDebits = 0;
    let totalOtherCredits = 0;

    for (const tx of otherTransactions) {
        // Check if it's explicitly a debit or credit based on type
        if (debitTypes.includes(tx.type)) {
            totalOtherDebits += tx.amount || 0;
        } else if (creditTypes.includes(tx.type)) {
            totalOtherCredits += tx.amount || 0;
        } else {
            // For unknown types, check description for hints
            const desc = (tx.description || '').toLowerCase();
            if (desc.includes('débit') || desc.includes('debit') || desc.includes('retrait')) {
                totalOtherDebits += tx.amount || 0;
            } else if (desc.includes('crédit') || desc.includes('credit') || desc.includes('reçu')) {
                totalOtherCredits += tx.amount || 0;
            } else {
                // Default: assume it's a debit if unknown
                console.log(`  Unknown transaction type: ${tx.type} - ${tx.description} - treating as debit`);
                totalOtherDebits += tx.amount || 0;
            }
        }
    }

    // Calculate correct balance
    const correctXafBalance =
        totalXafDeposits +
        totalXafFromConversions +
        totalOtherCredits -
        totalXafWithdrawals -
        totalXafToConversions -
        totalOtherDebits;

    const currentXafBalance = user.balance || 0;
    const difference = correctXafBalance - currentXafBalance;

    return {
        userId,
        userName: user.name,
        email: user.email,
        currentXafBalance,
        totalXafDeposits,
        totalXafFromConversions,
        totalXafWithdrawals,
        totalXafToConversions,
        totalOtherDebits,
        totalOtherCredits,
        correctXafBalance,
        difference,
        depositCount: deposits.length,
        withdrawalCount: withdrawals.length,
        usdToXafConversionCount: usdToXafConversions.length,
        xafToUsdConversionCount: xafToUsdConversions.length,
        otherTransactionCount: otherTransactions.length
    };
}

async function updateUserBalance(userId: string, newBalance: number): Promise<boolean> {
    const UserModel = userConnection.collection('users');

    const result = await UserModel.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $set: { balance: newBalance } }
    );

    return result.modifiedCount > 0;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--apply');
    const userIndex = args.indexOf('--user');
    const specificUserId = userIndex !== -1 ? args[userIndex + 1] : undefined;

    console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           FIX USER BALANCES SCRIPT                                                ║');
    console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Mode: ${dryRun ? 'DRY RUN (analysis only)' : 'APPLY FIXES           '}                                                              ║`);
    if (specificUserId) {
        console.log(`║  Target User: ${specificUserId}                                            ║`);
    }
    console.log('║                                                                                                   ║');
    console.log('║  This script recalculates balances from all completed transactions                               ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════╝');

    try {
        await connectToDatabases();

        console.log('\n=== Fetching users ===\n');
        // If no specific user, get only users with negative balances updated in December
        const negativeBalanceOnly = !specificUserId;
        const users = await getUsers(specificUserId, negativeBalanceOnly);
        console.log(`Found ${users.length} user(s) to analyze\n`);
        if (negativeBalanceOnly) {
            console.log('(Filtering: negative balance users updated in December 2025)\n');
        }

        const results: BalanceCalculation[] = [];
        let usersWithDifference = 0;
        let totalDifference = 0;

        for (const user of users) {
            const userId = user._id.toString();
            const calc = await calculateCorrectBalance(userId);

            if (calc) {
                results.push(calc);

                if (Math.abs(calc.difference) > 0.01) {
                    usersWithDifference++;
                    totalDifference += calc.difference;

                    console.log('─'.repeat(100));
                    console.log(`USER: ${calc.userName || 'Unknown'}`);
                    console.log(`ID: ${calc.userId}`);
                    console.log(`Email: ${calc.email || 'N/A'}`);
                    console.log('');
                    console.log('TRANSACTION BREAKDOWN:');
                    console.log(`  (+) XAF Deposits:           ${calc.totalXafDeposits.toLocaleString()} XAF (${calc.depositCount} transactions)`);
                    console.log(`  (+) USD→XAF Conversions:    ${calc.totalXafFromConversions.toLocaleString()} XAF (${calc.usdToXafConversionCount} transactions)`);
                    console.log(`  (+) Other Credits:          ${calc.totalOtherCredits.toLocaleString()} XAF`);
                    console.log(`  (-) XAF Withdrawals:        ${calc.totalXafWithdrawals.toLocaleString()} XAF (${calc.withdrawalCount} transactions)`);
                    console.log(`  (-) XAF→USD Conversions:    ${calc.totalXafToConversions.toLocaleString()} XAF (${calc.xafToUsdConversionCount} transactions)`);
                    console.log(`  (-) Other Debits:           ${calc.totalOtherDebits.toLocaleString()} XAF (${calc.otherTransactionCount} other transactions)`);
                    console.log('');
                    console.log('CALCULATION:');
                    console.log(`  ${calc.totalXafDeposits.toLocaleString()} + ${calc.totalXafFromConversions.toLocaleString()} + ${calc.totalOtherCredits.toLocaleString()} - ${calc.totalXafWithdrawals.toLocaleString()} - ${calc.totalXafToConversions.toLocaleString()} - ${calc.totalOtherDebits.toLocaleString()}`);
                    console.log(`  = ${calc.correctXafBalance.toLocaleString()} XAF`);
                    console.log('');
                    console.log('BALANCES:');
                    console.log(`  Current Balance:  ${calc.currentXafBalance.toLocaleString()} XAF`);
                    console.log(`  Correct Balance:  ${calc.correctXafBalance.toLocaleString()} XAF`);
                    console.log(`  Difference:       ${calc.difference >= 0 ? '+' : ''}${calc.difference.toLocaleString()} XAF`);

                    if (!dryRun) {
                        const updated = await updateUserBalance(userId, calc.correctXafBalance);
                        if (updated) {
                            console.log(`  ✅ BALANCE UPDATED`);
                        } else {
                            console.log(`  ❌ FAILED TO UPDATE`);
                        }
                    }
                    console.log('');
                }
            }
        }

        // Summary
        console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                                        SUMMARY                                                     ║');
        console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════╣');
        console.log(`║  Total Users Analyzed: ${results.length.toString().padStart(70)} ║`);
        console.log(`║  Users with Difference: ${usersWithDifference.toString().padStart(69)} ║`);
        console.log(`║  Total Difference: ${totalDifference.toLocaleString().padStart(74)} XAF ║`);
        console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════╝');

        if (dryRun) {
            console.log('\n⚠️  DRY RUN - No changes applied');
            console.log('Run with --apply to execute fixes');
        } else {
            console.log('\n✅ FIXES APPLIED');
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
