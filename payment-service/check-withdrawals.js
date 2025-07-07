const mongoose = require('mongoose');

// Transaction Schema (simplified for diagnostic purposes)
const TransactionSchema = new mongoose.Schema({
    transactionId: String,
    userId: mongoose.Schema.Types.ObjectId,
    type: String,
    amount: Number,
    currency: String,
    fee: Number,
    status: String,
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    deleted: { type: Boolean, default: false },
    createdAt: Date,
    updatedAt: Date,
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', TransactionSchema);

async function diagnoseWithdrawals() {
    try {
        // Connect to MongoDB using environment variable
        const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/sbc_ms_db';
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB for withdrawal diagnosis...\n');

        // 1. Count all withdrawal transactions
        const totalWithdrawals = await Transaction.countDocuments({
            type: 'WITHDRAWAL',
            deleted: { $ne: true }
        });
        console.log(`Total withdrawal transactions: ${totalWithdrawals}`);

        // 2. Count completed withdrawals
        const completedWithdrawals = await Transaction.countDocuments({
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            deleted: { $ne: true }
        });
        console.log(`Completed withdrawal transactions: ${completedWithdrawals}`);

        // 3. Analyze amounts for completed withdrawals
        const amountAnalysis = await Transaction.aggregate([
            {
                $match: {
                    type: 'WITHDRAWAL',
                    status: 'COMPLETED',
                    deleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPositive: {
                        $sum: {
                            $cond: { if: { $gt: ['$amount', 0] }, then: '$amount', else: 0 }
                        }
                    },
                    totalNegative: {
                        $sum: {
                            $cond: { if: { $lt: ['$amount', 0] }, then: { $abs: '$amount' }, else: 0 }
                        }
                    },
                    countPositive: {
                        $sum: {
                            $cond: { if: { $gt: ['$amount', 0] }, then: 1, else: 0 }
                        }
                    },
                    countNegative: {
                        $sum: {
                            $cond: { if: { $lt: ['$amount', 0] }, then: 1, else: 0 }
                        }
                    },
                    maxAmount: { $max: '$amount' },
                    minAmount: { $min: '$amount' },
                    avgAmount: { $avg: '$amount' }
                }
            }
        ]);

        if (amountAnalysis.length > 0) {
            const stats = amountAnalysis[0];
            console.log('\n=== AMOUNT ANALYSIS ===');
            console.log(`Positive amounts: ${stats.countPositive} transactions, total: ${stats.totalPositive} F`);
            console.log(`Negative amounts: ${stats.countNegative} transactions, total: ${stats.totalNegative} F`);
            console.log(`Max amount: ${stats.maxAmount} F`);
            console.log(`Min amount: ${stats.minAmount} F`);
            console.log(`Average amount: ${stats.avgAmount?.toFixed(2)} F`);

            // Calculate what the current method would return
            const calculatedTotal = Math.abs((-1 * stats.totalPositive) + (-1 * stats.totalNegative));
            console.log(`\nCalculated total using current method: ${calculatedTotal} F`);
        }

        // 4. Find largest transactions (potential outliers)
        console.log('\n=== LARGEST TRANSACTIONS ===');
        const largestTransactions = await Transaction.find({
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            deleted: { $ne: true },
            $or: [
                { amount: { $gt: 500000 } },
                { amount: { $lt: -500000 } }
            ]
        }).select('transactionId amount createdAt userId').sort({ amount: -1 }).limit(10);

        largestTransactions.forEach(tx => {
            console.log(`Transaction ${tx.transactionId}: ${tx.amount} F (User: ${tx.userId}, Date: ${tx.createdAt})`);
        });

        // 5. Check for duplicate transaction IDs
        console.log('\n=== DUPLICATE CHECK ===');
        const duplicates = await Transaction.aggregate([
            {
                $match: {
                    type: 'WITHDRAWAL',
                    status: 'COMPLETED',
                    deleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: '$transactionId',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    ids: { $push: '$_id' }
                }
            },
            {
                $match: { count: { $gt: 1 } }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        if (duplicates.length > 0) {
            console.log(`Found ${duplicates.length} duplicate transaction IDs:`);
            duplicates.forEach(dup => {
                console.log(`Transaction ID "${dup._id}": ${dup.count} occurrences, total amount: ${dup.totalAmount} F`);
            });
        } else {
            console.log('No duplicate transaction IDs found');
        }

        // 6. Recent large withdrawals
        console.log('\n=== RECENT LARGE WITHDRAWALS ===');
        const recentLarge = await Transaction.find({
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            deleted: { $ne: true },
            $or: [
                { amount: { $gt: 100000 } },
                { amount: { $lt: -100000 } }
            ],
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        }).select('transactionId amount createdAt userId').sort({ createdAt: -1 }).limit(5);

        if (recentLarge.length > 0) {
            recentLarge.forEach(tx => {
                console.log(`Recent: ${tx.transactionId}: ${tx.amount} F (User: ${tx.userId}, Date: ${tx.createdAt})`);
            });
        } else {
            console.log('No large withdrawals in the last 30 days');
        }

    } catch (error) {
        console.error('Error during withdrawal diagnosis:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDatabase disconnected.');
    }
}

diagnoseWithdrawals(); 