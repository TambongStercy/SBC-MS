import { Types } from 'mongoose';
import TransactionModel, { TransactionStatus, TransactionType } from '../database/models/transaction.model';

export const MAX_SOURCE_USERS = 5000;

/**
 * Referral commissions a user has been paid because of given filleuls.
 *
 * A commission is a completed internal deposit whose source filleul sits in
 * `paymentProvider.metadata.sourceUserId` (a string) — not in top-level
 * `metadata`, which processDeposit leaves unset. Read-only. Grouped by
 * currency because crypto purchases pay commissions in USD.
 */
export async function sumCommissionsFromSources(userId: string, sourceUserIds: string[]) {
    const rows = await TransactionModel.aggregate<{ _id: string; total: number; count: number }>([
        {
            $match: {
                userId: new Types.ObjectId(userId),
                type: TransactionType.DEPOSIT,
                status: TransactionStatus.COMPLETED,
                deleted: { $ne: true },
                'paymentProvider.provider': 'internal',
                'paymentProvider.metadata.commissionLevel': { $exists: true },
                'paymentProvider.metadata.sourceUserId': { $in: sourceUserIds.map(String) },
            },
        },
        { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const byCurrency = Object.fromEntries(rows.map(r => [r._id, r.total])) as Record<string, number>;
    return {
        XAF: byCurrency.XAF ?? 0,
        USD: byCurrency.USD ?? 0,
        commissions: rows.reduce((n, r) => n + r.count, 0),
    };
}
