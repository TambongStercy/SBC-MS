const mongoose = require('mongoose');

// Transaction Schema (simplified for diagnostic purposes)
const TransactionSchema = new mongoose.Schema({
    transactionId: String,
    userId: mongoose.Schema.Types.ObjectId,
    type: String,
    amount: Number,
    currency: String,
    status: String,
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    deleted: { type: Boolean, default: false },
    createdAt: Date,
    updatedAt: Date,
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', TransactionSchema);

async function checkTransactionTypes() {
    try {
        // Connect to MongoDB using environment variable
        const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/sbc_ms_db';
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB for transaction type analysis...\n');

        // 1. Get all unique transaction types
        console.log('=== ALL TRANSACTION TYPES ===');
        const allTypes = await Transaction.distinct('type');
        console.log('Unique transaction types found:', allTypes);
        console.log('Total types:', allTypes.length);

        // 2. Get count for each type
        console.log('\n=== TRANSACTION COUNTS BY TYPE ===');
        const typeCounts = await Transaction.aggregate([
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    avgAmount: { $avg: '$amount' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        typeCounts.forEach(typeData => {
            console.log(`Type: "${typeData._id}" - Count: ${typeData.count}, Total Amount: ${typeData.totalAmount} F, Avg: ${typeData.avgAmount?.toFixed(2)} F`);
        });

        // 3. Get all unique statuses
        console.log('\n=== ALL TRANSACTION STATUSES ===');
        const allStatuses = await Transaction.distinct('status');
        console.log('Unique statuses found:', allStatuses);

        // 4. Check if there are transactions that look like withdrawals but have different names
        console.log('\n=== POTENTIAL WITHDRAWAL-LIKE TRANSACTIONS ===');
        const withdrawalLike = await Transaction.aggregate([
            {
                $match: {
                    $or: [
                        { type: { $regex: /withdraw/i } },
                        { type: { $regex: /retrait/i } },
                        { type: { $regex: /payout/i } },
                        { description: { $regex: /withdraw/i } },
                        { description: { $regex: /retrait/i } }
                    ]
                }
            },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    sampleDescriptions: { $addToSet: '$description' }
                }
            }
        ]);

        if (withdrawalLike.length > 0) {
            withdrawalLike.forEach(data => {
                console.log(`Potential withdrawal type: "${data._id}"`);
                console.log(`  Count: ${data.count}, Total: ${data.totalAmount} F`);
                console.log(`  Sample descriptions: ${data.sampleDescriptions.slice(0, 3).join(', ')}`);
            });
        } else {
            console.log('No withdrawal-like transactions found');
        }

        // 5. Check for large negative amounts (which might be withdrawals)
        console.log('\n=== LARGE NEGATIVE AMOUNTS ===');
        const largeNegative = await Transaction.find({
            amount: { $lt: -10000 },
            deleted: { $ne: true }
        }).select('type status amount description createdAt').limit(5);

        if (largeNegative.length > 0) {
            largeNegative.forEach(tx => {
                console.log(`Type: ${tx.type}, Status: ${tx.status}, Amount: ${tx.amount} F, Desc: ${tx.description?.substring(0, 50)}...`);
            });
        } else {
            console.log('No large negative amounts found');
        }

        // 6. Total count and amount
        console.log('\n=== OVERALL STATISTICS ===');
        const overallStats = await Transaction.aggregate([
            {
                $group: {
                    _id: null,
                    totalTransactions: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    positiveAmount: { $sum: { $cond: { if: { $gt: ['$amount', 0] }, then: '$amount', else: 0 } } },
                    negativeAmount: { $sum: { $cond: { if: { $lt: ['$amount', 0] }, then: '$amount', else: 0 } } }
                }
            }
        ]);

        if (overallStats.length > 0) {
            const stats = overallStats[0];
            console.log(`Total transactions: ${stats.totalTransactions}`);
            console.log(`Total amount: ${stats.totalAmount} F`);
            console.log(`Positive amounts total: ${stats.positiveAmount} F`);
            console.log(`Negative amounts total: ${stats.negativeAmount} F`);
        }

    } catch (error) {
        console.error('Error during transaction type analysis:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDatabase disconnected.');
    }
}

checkTransactionTypes(); 