/**
 * Currency Bug Fix Migration Script v2
 *
 * This version fixes the issues in v1:
 * 1. Deletes existing correction transactions first
 * 2. Actually updates user balances (not just outputs commands)
 * 3. Properly accounts for USD to XAF conversions already made
 *
 * Problem: Starting from September 8, 2025, commissions from CinetPay/FeexPay payments
 * were incorrectly distributed as USD instead of XAF. The amounts should have been:
 *   - Level 1: 1000 XAF (was given as 2 USD)
 *   - Level 2: 500 XAF (was given as 1 USD)
 *   - Level 3: 250 XAF (was given as 0.5 USD)
 *
 * Fix Logic:
 * 1. Delete existing correction transactions from v1 script
 * 2. Calculate total fake USD received from feexpay/cinetpay payments (from Sept 8, 2025)
 * 3. Calculate total USD already converted to XAF (they already got XAF at 500 rate)
 * 4. Net USD to fix = fake USD received - already converted
 * 5. Deduct net USD from user's USD balance
 * 6. Credit equivalent XAF to user's XAF balance
 *
 * Usage:
 *   npx ts-node src/scripts/fix-currency-bug-v2.ts           # Dry run (analysis only)
 *   npx ts-node src/scripts/fix-currency-bug-v2.ts --apply   # Apply fixes
 */

import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

// Production database connection strings
const PAYMENT_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27017/sbc_payment?authSource=admin';
const USER_MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27017/sbc_users?authSource=admin';
// const PAYMENT_MONGODB_URI = 'mongodb://localhost:27017/sbc_payment_dev?authSource=admin';
// const USER_MONGODB_URI = 'mongodb://localhost:27017/sbc_user_dev?authSource=admin';

// Bug start date - September 8, 2025
const BUG_START_DATE = new Date('2025-09-08T00:00:00.000Z');

// Import models
import TransactionModel, { TransactionType, TransactionStatus, Currency } from '../database/models/transaction.model';
import PaymentIntentModel from '../database/models/PaymentIntent';

const USD_TO_XAF_RATE = 500; // Conversion rate

interface CommissionTransaction {
    transactionId: string;
    amount: number;
    description: string;
    sessionId: string;
    gateway: string;
    commissionLevel: number;
    createdAt: Date;
}

interface ConversionTransaction {
    transactionId: string;
    usdAmount: number;
    xafAmount: number;
    createdAt: Date;
    isCorrection: boolean; // True if this was a v1 correction transaction
}

interface AffectedUser {
    userId: string;
    fakeUsdReceived: number;           // Total fake USD from feexpay/cinetpay
    usdAlreadyConverted: number;       // USD they already converted to XAF (excluding v1 corrections)
    xafFromConversions: number;        // XAF they got from conversions
    currentUsdBalance: number;         // Their current USD balance
    currentXafBalance: number;         // Their current XAF balance

    // Calculated corrections
    netUsdToFix: number;               // fakeUsdReceived - usdAlreadyConverted
    usdToDeduct: number;               // How much to subtract from USD balance
    xafToCredit: number;               // How much to add to XAF balance (netUsdToFix * 500)

    commissionTransactions: CommissionTransaction[];
    conversionTransactions: ConversionTransaction[];
    v1CorrectionTransactions: ConversionTransaction[]; // Corrections from v1 to be deleted
}

interface FixResult {
    totalAffectedTransactions: number;
    totalAffectedUsers: number;
    affectedUsers: Map<string, AffectedUser>;
    legitUsdTransactions: number;
    deletedV1Corrections: number;
    errors: string[];
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

async function getUserBalances(userId: string): Promise<{ usdBalance: number; xafBalance: number }> {
    const UserModel = userConnection.collection('users');
    const user = await UserModel.findOne({ _id: new mongoose.Types.ObjectId(userId) });

    if (!user) {
        return { usdBalance: 0, xafBalance: 0 };
    }

    return {
        usdBalance: user.usdBalance || 0,
        xafBalance: user.balance || 0
    };
}

async function updateUserBalances(userId: string, usdChange: number, xafChange: number): Promise<boolean> {
    const UserModel = userConnection.collection('users');

    const result = await UserModel.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        {
            $inc: {
                usdBalance: usdChange,
                balance: xafChange
            }
        }
    );

    return result.modifiedCount > 0;
}

async function deleteV1CorrectionTransactions(): Promise<number> {
    // Find and delete v1 correction transactions
    const result = await TransactionModel.deleteMany({
        type: TransactionType.CONVERSION,
        'metadata.isCurrencyBugCorrection': true,
        'paymentProvider.provider': 'system',
        'paymentProvider.metadata.type': 'currency_bug_correction'
    });

    return result.deletedCount;
}

async function analyzeAndFix(dryRun: boolean = true): Promise<FixResult> {
    const result: FixResult = {
        totalAffectedTransactions: 0,
        totalAffectedUsers: 0,
        affectedUsers: new Map(),
        legitUsdTransactions: 0,
        deletedV1Corrections: 0,
        errors: []
    };

    console.log('\n=== PHASE 0: Deleting v1 correction transactions ===\n');

    // Count v1 corrections first
    const v1CorrectionCount = await TransactionModel.countDocuments({
        type: TransactionType.CONVERSION,
        'metadata.isCurrencyBugCorrection': true,
        'paymentProvider.provider': 'system',
        'paymentProvider.metadata.type': 'currency_bug_correction'
    });

    console.log(`Found ${v1CorrectionCount} v1 correction transactions to delete`);

    if (!dryRun && v1CorrectionCount > 0) {
        result.deletedV1Corrections = await deleteV1CorrectionTransactions();
        console.log(`Deleted ${result.deletedV1Corrections} v1 correction transactions`);
    } else {
        result.deletedV1Corrections = v1CorrectionCount;
    }

    console.log('\n=== PHASE 1: Finding USD commission transactions ===\n');
    console.log(`Looking for transactions from ${BUG_START_DATE.toISOString()} onwards...\n`);

    // Find all USD deposit transactions that are commission-related (from bug start date)
    const usdCommissionTransactions = await TransactionModel.find({
        type: TransactionType.DEPOSIT,
        currency: Currency.USD,
        'paymentProvider.metadata.sourcePaymentSessionId': { $exists: true },
        'paymentProvider.provider': 'internal',
        status: 'completed',
        createdAt: { $gte: BUG_START_DATE }
    }).lean();

    console.log(`Found ${usdCommissionTransactions.length} USD commission transactions to analyze (since Sept 8, 2025)`);

    // Group by sourcePaymentSessionId
    const sessionIdMap = new Map<string, any[]>();
    for (const tx of usdCommissionTransactions) {
        const sessionId = tx.paymentProvider?.metadata?.sourcePaymentSessionId;
        if (sessionId) {
            if (!sessionIdMap.has(sessionId)) {
                sessionIdMap.set(sessionId, []);
            }
            sessionIdMap.get(sessionId)!.push(tx);
        }
    }

    console.log(`Grouped into ${sessionIdMap.size} unique payment sessions`);

    // Lookup PaymentIntents
    const sessionIds = Array.from(sessionIdMap.keys());
    const paymentIntents = await PaymentIntentModel.find({
        sessionId: { $in: sessionIds }
    }).lean();

    console.log(`Found ${paymentIntents.length} corresponding PaymentIntents`);

    const paymentIntentMap = new Map<string, any>();
    for (const pi of paymentIntents) {
        paymentIntentMap.set(pi.sessionId, pi);
    }

    console.log('\n=== PHASE 2: Identifying affected transactions ===\n');

    // Process each transaction
    for (const tx of usdCommissionTransactions) {
        const sessionId = tx.paymentProvider?.metadata?.sourcePaymentSessionId;
        const paymentIntent = paymentIntentMap.get(sessionId);

        if (!paymentIntent) {
            result.errors.push(`PaymentIntent not found for session ${sessionId} (tx: ${tx.transactionId})`);
            continue;
        }

        const gateway = paymentIntent.gateway?.toLowerCase();

        if (gateway === 'feexpay' || gateway === 'cinetpay') {
            result.totalAffectedTransactions++;
            const userId = tx.userId.toString();

            if (!result.affectedUsers.has(userId)) {
                result.affectedUsers.set(userId, {
                    userId,
                    fakeUsdReceived: 0,
                    usdAlreadyConverted: 0,
                    xafFromConversions: 0,
                    currentUsdBalance: 0,
                    currentXafBalance: 0,
                    netUsdToFix: 0,
                    usdToDeduct: 0,
                    xafToCredit: 0,
                    commissionTransactions: [],
                    conversionTransactions: [],
                    v1CorrectionTransactions: []
                });
            }

            const userInfo = result.affectedUsers.get(userId)!;
            userInfo.fakeUsdReceived += tx.amount;
            userInfo.commissionTransactions.push({
                transactionId: tx.transactionId,
                amount: tx.amount,
                description: tx.description,
                sessionId,
                gateway,
                commissionLevel: tx.paymentProvider?.metadata?.commissionLevel || 0,
                createdAt: tx.createdAt
            });
        } else if (gateway === 'nowpayments') {
            result.legitUsdTransactions++;
        } else {
            result.errors.push(`Unknown gateway "${gateway}" for session ${sessionId}`);
        }
    }

    result.totalAffectedUsers = result.affectedUsers.size;

    console.log(`Affected transactions: ${result.totalAffectedTransactions}`);
    console.log(`Affected users: ${result.totalAffectedUsers}`);
    console.log(`Legitimate USD transactions: ${result.legitUsdTransactions}`);

    console.log('\n=== PHASE 3: Checking conversions and balances for each user ===\n');

    // For each affected user, find their USD->XAF conversion transactions (excluding v1 corrections)
    for (const [userId, userInfo] of result.affectedUsers) {
        // Get current balances
        const balances = await getUserBalances(userId);
        userInfo.currentUsdBalance = balances.usdBalance;
        userInfo.currentXafBalance = balances.xafBalance;

        // Find all USD->XAF conversions (including v1 corrections for logging)
        const conversions = await TransactionModel.find({
            userId: new mongoose.Types.ObjectId(userId),
            type: TransactionType.CONVERSION,
            status: 'completed',
            'metadata.conversionType': 'USD_to_XAF'
        }).lean();

        for (const conv of conversions) {
            const usdAmount = conv.metadata?.sourceAmount || conv.amount || 0;
            const xafAmount = conv.metadata?.targetAmount || (usdAmount * USD_TO_XAF_RATE);
            const isCorrection = conv.metadata?.isCurrencyBugCorrection === true;

            const conversionRecord: ConversionTransaction = {
                transactionId: conv.transactionId,
                usdAmount,
                xafAmount,
                createdAt: conv.createdAt,
                isCorrection
            };

            if (isCorrection) {
                // Track v1 corrections separately (these will be deleted)
                userInfo.v1CorrectionTransactions.push(conversionRecord);
            } else {
                // Only count non-correction conversions toward "already converted"
                userInfo.usdAlreadyConverted += usdAmount;
                userInfo.xafFromConversions += xafAmount;
                userInfo.conversionTransactions.push(conversionRecord);
            }
        }

        // Calculate net USD that still needs to be fixed
        // This is the fake USD they received minus what they already converted (excluding v1 corrections)
        userInfo.netUsdToFix = Math.max(0, userInfo.fakeUsdReceived - userInfo.usdAlreadyConverted);

        // The USD to deduct from their balance is the net amount
        // But we need to ensure we don't deduct more than they have
        userInfo.usdToDeduct = Math.min(userInfo.netUsdToFix, userInfo.currentUsdBalance);

        // The XAF to credit is the converted value of what we can deduct
        userInfo.xafToCredit = Math.round(userInfo.usdToDeduct * USD_TO_XAF_RATE);

        console.log(`User ${userId}:`);
        console.log(`  Current USD balance: ${userInfo.currentUsdBalance}`);
        console.log(`  Current XAF balance: ${userInfo.currentXafBalance}`);
        console.log(`  Fake USD received: ${userInfo.fakeUsdReceived}`);
        console.log(`  USD already converted (by user): ${userInfo.usdAlreadyConverted}`);
        console.log(`  v1 correction transactions: ${userInfo.v1CorrectionTransactions.length}`);
        console.log(`  Net USD to fix: ${userInfo.netUsdToFix}`);
        console.log(`  USD to deduct (capped by balance): ${userInfo.usdToDeduct}`);
        console.log(`  XAF to credit: ${userInfo.xafToCredit}`);
        console.log('');
    }

    console.log('\n=== PHASE 4: Summary of corrections ===\n');

    console.log('User ID                          | Fake USD | Converted | Net USD | Curr USD | Deduct | XAF Credit');
    console.log('-'.repeat(110));

    for (const [userId, userInfo] of result.affectedUsers) {
        console.log(
            `${userId} | ${userInfo.fakeUsdReceived.toString().padStart(8)} | ` +
            `${userInfo.usdAlreadyConverted.toString().padStart(9)} | ` +
            `${userInfo.netUsdToFix.toString().padStart(7)} | ` +
            `${userInfo.currentUsdBalance.toFixed(2).padStart(8)} | ` +
            `${userInfo.usdToDeduct.toFixed(2).padStart(6)} | ` +
            `${userInfo.xafToCredit.toString().padStart(10)}`
        );
    }

    // Apply fixes
    if (!dryRun) {
        console.log('\n=== PHASE 5: Applying fixes ===\n');

        for (const [userId, userInfo] of result.affectedUsers) {
            if (userInfo.usdToDeduct <= 0) {
                console.log(`User ${userId}: No fix needed (all fake USD already converted or no balance)`);
                continue;
            }

            // Mark original commission transactions as fixed
            for (const tx of userInfo.commissionTransactions) {
                await TransactionModel.updateOne(
                    { transactionId: tx.transactionId },
                    {
                        $set: {
                            'metadata.currencyBugFixed': true,
                            'metadata.fixedAt': new Date(),
                            'metadata.fixNote': 'Commission was incorrectly given as USD instead of XAF'
                        }
                    }
                );
            }

            // Create correction transaction (this is like a forced conversion)
            const correctionTxId = nanoid(16);
            const correctionTransaction = new TransactionModel({
                transactionId: correctionTxId,
                userId: new mongoose.Types.ObjectId(userId),
                type: TransactionType.CONVERSION,
                amount: userInfo.usdToDeduct,
                currency: Currency.USD,
                fee: 0,
                status: TransactionStatus.COMPLETED,
                description: `Correction: Conversion automatique de ${userInfo.usdToDeduct} USD vers ${userInfo.xafToCredit} XAF (correction bug devise commission v2)`,
                metadata: {
                    conversionType: 'USD_to_XAF',
                    sourceAmount: userInfo.usdToDeduct,
                    sourceCurrency: 'USD',
                    targetAmount: userInfo.xafToCredit,
                    targetCurrency: 'XAF',
                    conversionRate: USD_TO_XAF_RATE,
                    isCurrencyBugCorrection: true,
                    correctionVersion: 2,
                    affectedTransactions: userInfo.commissionTransactions.map(t => t.transactionId),
                    originalFakeUsd: userInfo.fakeUsdReceived,
                    userConvertedUsd: userInfo.usdAlreadyConverted,
                    timestamp: new Date().toISOString()
                },
                paymentProvider: {
                    provider: 'system',
                    transactionId: `correction_v2_${Date.now()}`,
                    status: 'completed',
                    metadata: {
                        type: 'currency_bug_correction_v2',
                        fakeUsdReceived: userInfo.fakeUsdReceived,
                        usdAlreadyConverted: userInfo.usdAlreadyConverted,
                        netUsdFixed: userInfo.usdToDeduct
                    }
                }
            });

            await correctionTransaction.save();
            console.log(`Created correction transaction ${correctionTxId} for user ${userId}`);

            // UPDATE USER BALANCES DIRECTLY
            const updated = await updateUserBalances(
                userId,
                -userInfo.usdToDeduct,  // Deduct USD
                userInfo.xafToCredit    // Add XAF
            );

            if (updated) {
                console.log(`  Updated user ${userId} balances: -${userInfo.usdToDeduct} USD, +${userInfo.xafToCredit} XAF`);
            } else {
                result.errors.push(`Failed to update balances for user ${userId}`);
                console.error(`  ERROR: Failed to update balances for user ${userId}`);
            }
        }
    }

    return result;
}

async function main() {
    const dryRun = !process.argv.includes('--apply');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       CURRENCY BUG FIX MIGRATION SCRIPT v2                 ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Mode: ${dryRun ? 'DRY RUN (analysis only)' : 'APPLY FIXES           '}                        ║`);
    console.log('║                                                            ║');
    console.log('║  This version:                                             ║');
    console.log('║  - Deletes v1 correction transactions                      ║');
    console.log('║  - Updates user balances directly                          ║');
    console.log('║  - Accounts for user\'s own USD->XAF conversions            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    try {
        await connectToDatabases();

        const result = await analyzeAndFix(dryRun);

        // Calculate totals
        let totalFakeUsd = 0;
        let totalAlreadyConverted = 0;
        let totalNetToFix = 0;
        let totalUsdToDeduct = 0;
        let totalXafToCredit = 0;

        for (const userInfo of result.affectedUsers.values()) {
            totalFakeUsd += userInfo.fakeUsdReceived;
            totalAlreadyConverted += userInfo.usdAlreadyConverted;
            totalNetToFix += userInfo.netUsdToFix;
            totalUsdToDeduct += userInfo.usdToDeduct;
            totalXafToCredit += userInfo.xafToCredit;
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    FINAL SUMMARY                           ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  v1 corrections deleted: ${result.deletedV1Corrections.toString().padStart(29)} ║`);
        console.log(`║  Affected transactions: ${result.totalAffectedTransactions.toString().padStart(30)} ║`);
        console.log(`║  Affected users: ${result.totalAffectedUsers.toString().padStart(37)} ║`);
        console.log(`║  Legitimate USD transactions: ${result.legitUsdTransactions.toString().padStart(24)} ║`);
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  Total fake USD distributed: ${totalFakeUsd.toFixed(2).padStart(25)} ║`);
        console.log(`║  Total already converted by users: ${totalAlreadyConverted.toFixed(2).padStart(19)} ║`);
        console.log(`║  Total net USD to fix: ${totalNetToFix.toFixed(2).padStart(31)} ║`);
        console.log(`║  Total USD actually deducted: ${totalUsdToDeduct.toFixed(2).padStart(24)} ║`);
        console.log(`║  Total XAF credited: ${totalXafToCredit.toString().padStart(33)} ║`);
        console.log('╚════════════════════════════════════════════════════════════╝');

        if (result.errors.length > 0) {
            console.log('\nWarnings/Errors:');
            result.errors.forEach(e => console.log(`  ⚠ ${e}`));
        }

        if (dryRun) {
            console.log('\n⚠️  DRY RUN - No changes applied');
            console.log('Run with --apply to execute fixes');
        } else {
            console.log('\n✅ FIXES APPLIED');
            console.log('- v1 correction transactions deleted');
            console.log('- New correction transactions created');
            console.log('- User balances updated directly');
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
