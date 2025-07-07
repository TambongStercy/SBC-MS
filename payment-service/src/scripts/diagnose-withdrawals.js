const mongoose = require('mongoose');
const config = require('../config').default;

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
        await mongoose.connect(config.mongoUri);
        console.log('Connected to MongoDB');

        console.log('\n=== WITHDRAWAL DIAGNOSTICS ===\n');

        // 1. Total withdrawals count
        const totalWithdrawals = await Transaction.countDocuments({
            type: 'withdrawal',
            deleted: { $ne: true }
        });
        console.log(`Total withdrawal transactions: ${totalWithdrawals}`);

        // 2. Withdrawals by status
        console.log('\n--- Withdrawals by Status ---');
        const withdrawalsByStatus = await Transaction.aggregate([
            { $match: { type: 'withdrawal', deleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
            { $sort: { count: -1 } }
        ]);
        
        withdrawalsByStatus.forEach(status => {
            console.log(`${status._id}: ${status.count} transactions, Total: ${status.totalAmount} F`);
        });

        // 3. Current calculation (as used in getTotalWithdrawalsAmount)
        console.log('\n--- Current Calculation Method ---');
        const currentCalculation = await Transaction.aggregate([
            {
                $match: {
                    type: 'withdrawal',
                    status: 'completed',
                    deleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);
        
        const currentTotal = currentCalculation.length > 0 ? currentCalculation[0].totalAmount : 0;
        const currentResult = Math.abs(currentTotal);
        console.log(`Sum of completed withdrawal amounts: ${currentTotal} F`);
        console.log(`After Math.abs(): ${currentResult} F`);

        // 4. Check for positive withdrawal amounts (should be negative)
        console.log('\n--- Checking for Positive Withdrawal Amounts ---');
        const positiveWithdrawals = await Transaction.find({
            type: 'withdrawal',
            amount: { $gt: 0 },
            deleted: { $ne: true }
        }).limit(10);
        
        console.log(`Found ${positiveWithdrawals.length} withdrawals with positive amounts (should be negative):`);
        positiveWithdrawals.forEach(tx => {
            console.log(`  ${tx.transactionId}: ${tx.amount} F, Status: ${tx.status}, Date: ${tx.createdAt}`);
        });

        // 5. Check for extremely large amounts
        console.log('\n--- Checking for Large Withdrawal Amounts ---');
        const largeWithdrawals = await Transaction.find({
            type: 'withdrawal',
            $or: [
                { amount: { $gt: 1000000 } },  // Positive amounts > 1M
                { amount: { $lt: -1000000 } }  // Negative amounts < -1M
            ],
            deleted: { $ne: true }
        }).sort({ amount: 1 }).limit(20);
        
        console.log(`Found ${largeWithdrawals.length} withdrawals with large amounts (>1M or <-1M):`);
        largeWithdrawals.forEach(tx => {
            console.log(`  ${tx.transactionId}: ${tx.amount} F, Status: ${tx.status}, Date: ${tx.createdAt}`);
        });

        // 6. Check for duplicate transactions
        console.log('\n--- Checking for Potential Duplicate Transactions ---');
        const duplicates = await Transaction.aggregate([
            { 
                $match: { 
                    type: 'withdrawal',
                    deleted: { $ne: true }
                } 
            },
            {
                $group: {
                    _id: {
                        userId: '$userId',
                        amount: '$amount',
                        description: '$description',
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                    },
                    count: { $sum: 1 },
                    transactions: { $push: '$transactionId' }
                }
            },
            { $match: { count: { $gt: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        console.log(`Found ${duplicates.length} potential duplicate withdrawal groups:`);
        duplicates.forEach(dup => {
            console.log(`  User: ${dup._id.userId}, Amount: ${dup._id.amount} F, Count: ${dup.count}, TxIds: ${dup.transactions.join(', ')}`);
        });

        // 7. Monthly breakdown
        console.log('\n--- Monthly Withdrawal Breakdown (Last 12 Months) ---');
        const monthlyBreakdown = await Transaction.aggregate([
            {
                $match: {
                    type: 'withdrawal',
                    status: 'completed',
                    deleted: { $ne: true },
                    createdAt: { 
                        $gte: new Date(new Date().setMonth(new Date().getMonth() - 12))
                    }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            },
            {
                $sort: { '_id.year': 1, '_id.month': 1 }
            }
        ]);

        monthlyBreakdown.forEach(month => {
            const absoluteAmount = Math.abs(month.totalAmount);
            console.log(`  ${month._id.year}-${month._id.month.toString().padStart(2, '0')}: ${month.count} withdrawals, ${absoluteAmount} F`);
        });

        // 8. Summary and recommendations
        console.log('\n=== SUMMARY ===');
        console.log(`Total withdrawals: ${totalWithdrawals}`);
        console.log(`Current calculated total: ${currentResult} F`);
        
        if (positiveWithdrawals.length > 0) {
            console.log(`⚠️  WARNING: Found ${positiveWithdrawals.length} withdrawals with positive amounts!`);
        }
        
        if (largeWithdrawals.length > 0) {
            console.log(`⚠️  WARNING: Found ${largeWithdrawals.length} withdrawals with large amounts!`);
        }
        
        if (duplicates.length > 0) {
            console.log(`⚠️  WARNING: Found ${duplicates.length} potential duplicate withdrawal groups!`);
        }

        console.log('\n=== RECOMMENDATIONS ===');
        if (positiveWithdrawals.length > 0) {
            console.log('1. Fix positive withdrawal amounts - they should be negative');
        }
        if (duplicates.length > 0) {
            console.log('2. Investigate and remove duplicate withdrawal transactions');
        }
        if (largeWithdrawals.length > 0) {
            console.log('3. Review large withdrawal amounts for validity');
        }
        console.log('4. Consider implementing data validation to prevent future issues');

    } catch (error) {
        console.error('Error during diagnosis:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

// Run the diagnosis
diagnoseWithdrawals().catch(console.error); 