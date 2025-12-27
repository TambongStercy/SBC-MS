/**
 * Currency Bug Fix Migration Script
 *
 * Problem: Starting from September 8, 2025, commissions from CinetPay/FeexPay payments
 * were incorrectly distributed as USD instead of XAF. The amounts should have been:
 *   - Level 1: 1000 XAF (was given as 2 USD)
 *   - Level 2: 500 XAF (was given as 1 USD)
 *   - Level 3: 250 XAF (was given as 0.5 USD)
 *
 * Fix Logic:
 * 1. Calculate total fake USD received from feexpay/cinetpay payments (from Sept 8, 2025)
 * 2. Calculate total USD already converted to XAF (they already got XAF at 500 rate)
 * 3. Net USD to fix = fake USD received - already converted
 * 4. Convert remaining fake USD to XAF at 500 rate and create correction transaction
 *
 * Conversion rates (for reference):
 *   - 2 USD = 1000 XAF (Level 1 CLASSIQUE)
 *   - 1 USD = 500 XAF (Level 2 CLASSIQUE)
 *   - 0.5 USD = 250 XAF (Level 3 CLASSIQUE)
 *
 * Usage:
 *   npx ts-node src/scripts/fix-currency-bug.ts           # Dry run (analysis only)
 *   npx ts-node src/scripts/fix-currency-bug.ts --apply   # Apply fixes
 */

import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

// Production database connection string
const MONGODB_URI = 'mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_payment?authSource=admin';

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
}

interface AffectedUser {
    userId: string;
    fakeUsdReceived: number;           // Total fake USD from feexpay/cinetpay
    usdAlreadyConverted: number;       // USD they already converted to XAF
    xafFromConversions: number;        // XAF they got from conversions
    currentUsdBalance: number;         // Their current USD balance (needs DB lookup)

    // Calculated corrections
    netUsdToFix: number;               // fakeUsdReceived - usdAlreadyConverted
    usdToDeduct: number;               // How much to subtract from USD balance
    xafToCredit: number;               // How much to add to XAF balance (netUsdToFix * 500)

    commissionTransactions: CommissionTransaction[];
    conversionTransactions: ConversionTransaction[];
}

interface FixResult {
    totalAffectedTransactions: number;
    totalAffectedUsers: number;
    affectedUsers: Map<string, AffectedUser>;
    legitUsdTransactions: number;
    errors: string[];
}

async function connectToDatabase() {
    console.log('Connecting to MongoDB (production)...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
}

async function analyzeAndFix(dryRun: boolean = true): Promise<FixResult> {
    const result: FixResult = {
        totalAffectedTransactions: 0,
        totalAffectedUsers: 0,
        affectedUsers: new Map(),
        legitUsdTransactions: 0,
        errors: []
    };

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
                    netUsdToFix: 0,
                    usdToDeduct: 0,
                    xafToCredit: 0,
                    commissionTransactions: [],
                    conversionTransactions: []
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

    console.log('\n=== PHASE 3: Checking conversions for each user ===\n');

    // For each affected user, find their USD->XAF conversion transactions
    for (const [userId, userInfo] of result.affectedUsers) {
        const conversions = await TransactionModel.find({
            userId: new mongoose.Types.ObjectId(userId),
            type: TransactionType.CONVERSION,
            status: 'completed',
            'metadata.conversionType': 'USD_to_XAF'
        }).lean();

        for (const conv of conversions) {
            const usdAmount = conv.metadata?.sourceAmount || conv.amount || 0;
            const xafAmount = conv.metadata?.targetAmount || (usdAmount * USD_TO_XAF_RATE);

            userInfo.usdAlreadyConverted += usdAmount;
            userInfo.xafFromConversions += xafAmount;
            userInfo.conversionTransactions.push({
                transactionId: conv.transactionId,
                usdAmount,
                xafAmount,
                createdAt: conv.createdAt
            });
        }

        // Calculate net USD that still needs to be fixed
        // This is the fake USD they received minus what they already converted
        userInfo.netUsdToFix = Math.max(0, userInfo.fakeUsdReceived - userInfo.usdAlreadyConverted);

        // The USD to deduct from their balance is the net amount
        userInfo.usdToDeduct = userInfo.netUsdToFix;

        // The XAF to credit is the converted value
        userInfo.xafToCredit = Math.round(userInfo.netUsdToFix * USD_TO_XAF_RATE);

        if (conversions.length > 0) {
            console.log(`User ${userId}:`);
            console.log(`  Fake USD received: ${userInfo.fakeUsdReceived}`);
            console.log(`  USD already converted: ${userInfo.usdAlreadyConverted}`);
            console.log(`  XAF from conversions: ${userInfo.xafFromConversions}`);
            console.log(`  Net USD to fix: ${userInfo.netUsdToFix}`);
        }
    }

    console.log('\n=== PHASE 4: Summary of corrections ===\n');

    console.log('User ID                          | Fake USD | Converted | Net USD | USD Deduct | XAF Credit');
    console.log('-'.repeat(100));

    for (const [userId, userInfo] of result.affectedUsers) {
        console.log(
            `${userId} | ${userInfo.fakeUsdReceived.toString().padStart(8)} | ` +
            `${userInfo.usdAlreadyConverted.toString().padStart(9)} | ` +
            `${userInfo.netUsdToFix.toString().padStart(7)} | ` +
            `${userInfo.usdToDeduct.toString().padStart(10)} | ` +
            `${userInfo.xafToCredit.toString().padStart(10)}`
        );
    }

    // Apply fixes
    if (!dryRun) {
        console.log('\n=== PHASE 5: Applying fixes ===\n');

        for (const [userId, userInfo] of result.affectedUsers) {
            if (userInfo.netUsdToFix <= 0) {
                console.log(`User ${userId}: No fix needed (all fake USD already converted)`);
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
                description: `Correction: Conversion automatique de ${userInfo.usdToDeduct} USD vers ${userInfo.xafToCredit} XAF (correction bug devise commission)`,
                metadata: {
                    conversionType: 'USD_to_XAF',
                    sourceAmount: userInfo.usdToDeduct,
                    sourceCurrency: 'USD',
                    targetAmount: userInfo.xafToCredit,
                    targetCurrency: 'XAF',
                    conversionRate: USD_TO_XAF_RATE,
                    isCurrencyBugCorrection: true,
                    affectedTransactions: userInfo.commissionTransactions.map(t => t.transactionId),
                    timestamp: new Date().toISOString()
                },
                paymentProvider: {
                    provider: 'system',
                    transactionId: `correction_${Date.now()}`,
                    status: 'completed',
                    metadata: {
                        type: 'currency_bug_correction',
                        fakeUsdReceived: userInfo.fakeUsdReceived,
                        usdAlreadyConverted: userInfo.usdAlreadyConverted,
                        netUsdFixed: userInfo.netUsdToFix
                    }
                }
            });

            await correctionTransaction.save();
            console.log(`Created correction transaction ${correctionTxId} for user ${userId}`);
            console.log(`  Deduct ${userInfo.usdToDeduct} USD, Credit ${userInfo.xafToCredit} XAF`);
        }

        // Output MongoDB commands for user balance updates
        console.log('\n=== USER BALANCE UPDATE COMMANDS ===');
        console.log('Run these on the user-service database:\n');

        for (const [userId, userInfo] of result.affectedUsers) {
            if (userInfo.netUsdToFix <= 0) continue;

            console.log(`// User: ${userId}`);
            console.log(`// Fake USD: ${userInfo.fakeUsdReceived}, Already converted: ${userInfo.usdAlreadyConverted}, Net to fix: ${userInfo.netUsdToFix}`);
            console.log(`db.users.updateOne(`);
            console.log(`  { _id: ObjectId("${userId}") },`);
            console.log(`  {`);
            console.log(`    $inc: {`);
            console.log(`      usdBalance: -${userInfo.usdToDeduct},`);
            console.log(`      balance: ${userInfo.xafToCredit}`);
            console.log(`    }`);
            console.log(`  }`);
            console.log(`);\n`);
        }
    }

    return result;
}

async function main() {
    const dryRun = !process.argv.includes('--apply');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         CURRENCY BUG FIX MIGRATION SCRIPT                  ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Mode: ${dryRun ? 'DRY RUN (analysis only)' : 'APPLY FIXES           '}                        ║`);
    console.log('║                                                            ║');
    console.log('║  Problem: Since Sept 8, 2025, commissions from             ║');
    console.log('║  FeexPay/CinetPay were given as USD instead of XAF.        ║');
    console.log('║                                                            ║');
    console.log('║  Fix: Convert remaining fake USD to XAF at 500 rate        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    try {
        await connectToDatabase();

        const result = await analyzeAndFix(dryRun);

        // Calculate totals
        let totalFakeUsd = 0;
        let totalAlreadyConverted = 0;
        let totalNetToFix = 0;
        let totalXafToCredit = 0;

        for (const userInfo of result.affectedUsers.values()) {
            totalFakeUsd += userInfo.fakeUsdReceived;
            totalAlreadyConverted += userInfo.usdAlreadyConverted;
            totalNetToFix += userInfo.netUsdToFix;
            totalXafToCredit += userInfo.xafToCredit;
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    FINAL SUMMARY                           ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  Affected transactions: ${result.totalAffectedTransactions.toString().padStart(30)} ║`);
        console.log(`║  Affected users: ${result.totalAffectedUsers.toString().padStart(37)} ║`);
        console.log(`║  Legitimate USD transactions: ${result.legitUsdTransactions.toString().padStart(24)} ║`);
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log(`║  Total fake USD distributed: ${totalFakeUsd.toString().padStart(25)} ║`);
        console.log(`║  Total already converted to XAF: ${totalAlreadyConverted.toString().padStart(21)} ║`);
        console.log(`║  Total net USD to fix: ${totalNetToFix.toString().padStart(31)} ║`);
        console.log(`║  Total XAF to credit: ${totalXafToCredit.toString().padStart(32)} ║`);
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
            console.log('Correction transactions have been created.');
            console.log('Please run the MongoDB commands above to update user balances.');
        }

    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

main();
