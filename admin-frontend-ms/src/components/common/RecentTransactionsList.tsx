import React from 'react';
import { format } from 'date-fns';
// Import the correct transaction type from the API service file
import { AccountTransaction } from '../../services/adminAccountTransactionApi';
import { ArrowDownCircle, ArrowUpCircle, CreditCard } from 'lucide-react'; // Example icons

interface RecentTransactionsListProps {
    transactions: AccountTransaction[]; // Use the imported AccountTransaction type
}

// Helper to get icon and color based on transaction type
// Changed type parameter to match AccountTransaction['type'] (assuming TransactionType enum)
import { TransactionType } from '../../types/enums'; // Corrected path
const getTransactionStyle = (type: TransactionType | undefined | null) => {
    // Provide a default style if type is missing
    if (!type) {
        return { Icon: CreditCard, color: 'text-gray-500' }; // Default to gray CreditCard
    }
    // Proceed with the switch if type exists
    // Use enum members for comparison
    switch (type) {
        case TransactionType.DEPOSIT:
            return { Icon: ArrowUpCircle, color: 'text-green-500' };
        case TransactionType.WITHDRAWAL:
            return { Icon: ArrowDownCircle, color: 'text-red-500' };
        case TransactionType.PAYMENT:
            return { Icon: CreditCard, color: 'text-blue-500' };
        // Add cases for other TransactionType members if needed
        // case TransactionType.REFUND:
        // case TransactionType.TRANSFER:
        // case TransactionType.FEE:
        default:
            return { Icon: CreditCard, color: 'text-gray-500' };
    }
};

const RecentTransactionsList: React.FC<RecentTransactionsListProps> = ({ transactions }) => {
    if (!transactions || transactions.length === 0) {
        return <div className="text-gray-400 text-center py-4">No recent transactions.</div>;
    }

    return (
        <ul className="space-y-3">
            {transactions.map((tx) => {
                // Use AccountTransaction type here
                const { Icon, color } = getTransactionStyle(tx.type);
                const formattedDate = format(new Date(tx.createdAt), 'PPpp'); // Format date nicely
                const formattedAmount = `${tx.amount > 0 ? '+' : ''}${tx.amount.toLocaleString()} ${tx.currency}`;

                return (
                    <li key={tx._id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-700/50 transition-colors duration-150">
                        <Icon className={`w-5 h-5 ${color}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-200 truncate">{tx.description}</p>
                            <p className="text-xs text-gray-400 truncate">
                                {/* Use userName or fallback to userId */}
                                {tx.userName || `User: ${tx.userId.substring(0, 6)}...`} - {formattedDate}
                            </p>
                        </div>
                        <div className={`text-sm font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formattedAmount}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};

export default RecentTransactionsList; 