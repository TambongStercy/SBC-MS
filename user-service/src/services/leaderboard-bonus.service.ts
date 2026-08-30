import { Types } from 'mongoose';
import LeaderboardBonusModel, { BonusTierKey, ILeaderboardBonus } from '../database/models/leaderboard-bonus.model';
import LeaderboardPayoutRunModel from '../database/models/leaderboard-payout-run.model';
import {
    referralRepository,
    startOfCurrentMonthDouala,
    startOfNextMonthDouala,
} from '../database/repositories/referral.repository';
import { userRepository } from '../database/repositories/user.repository';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('LeaderboardBonusService');

export interface PayoutReport {
    month: string;
    dryRun: boolean;
    qualifiers: number;
    paid: number;
    skipped: number;      // already had a ledger row from an earlier run
    failed: number;
    amountPaid: number;
    /** Rows left mid-flight by an earlier crashed run. Never re-credited. */
    stuck: number;
    byTier: Record<BonusTierKey, number>;
}

/** 'YYYY-MM' for a month window start, in the SBC timezone. */
export function monthKey(monthStart: Date): string {
    const local = new Date(monthStart.getTime() + 60 * 60 * 1000); // Douala = UTC+1
    return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month that just closed, relative to `now`. */
export function previousMonthStart(now: Date = new Date()): Date {
    const current = startOfCurrentMonthDouala(now);
    // One millisecond before this month began is somewhere inside the last one.
    return startOfCurrentMonthDouala(new Date(current.getTime() - 1));
}

/** The highest tier a sales count reaches, or null below the first threshold. */
export function tierForSales(salesCount: number) {
    const tiers = config.leaderboardBonus.tiers;
    for (let i = tiers.length - 1; i >= 0; i--) {
        if (salesCount >= tiers[i].minSales) return tiers[i];
    }
    return null;
}

class LeaderboardBonusService {

    /**
     * Pays the monthly leaderboard bonus into every qualifying member's
     * ACTIVATION balance (never the main balance: the bonus is meant to be
     * reinvested in activating filleuls, and the activation wallet is one-way).
     *
     * Safety model, in order:
     *   1. insert the ledger row first — `{userId, month}` is unique, so a
     *      duplicate insert means "already handled" and we skip without paying;
     *   2. credit the activation balance;
     *   3. flip the row to `paid`.
     *
     * A crash between 2 and 3 leaves a `pending` row. The next run sees it as an
     * existing row and skips it, so nobody is ever paid twice — the trade is an
     * under-payment that is visible (`stuck` in the report, status `pending` in
     * the ledger) and can be settled by hand. For money, that is the right way
     * round.
     */
    async payoutForMonth(
        monthStart: Date,
        opts: { dryRun?: boolean; triggeredBy?: string } = {},
    ): Promise<PayoutReport> {
        const dryRun = opts.dryRun ?? false;
        const month = monthKey(monthStart);
        const monthEnd = startOfNextMonthDouala(monthStart);
        const tiers = config.leaderboardBonus.tiers;
        const minSales = Math.min(...tiers.map(t => t.minSales));

        // The programme has a start date: nothing is owed for the months before
        // it. 'YYYY-MM' compares correctly as a string, which is why the key is
        // zero-padded.
        if (month < config.leaderboardBonus.firstPaidMonth) {
            throw new Error(`The leaderboard bonus starts with ${config.leaderboardBonus.firstPaidMonth}; ${month} is before that and is never paid.`);
        }

        const report: PayoutReport = {
            month, dryRun, qualifiers: 0, paid: 0, skipped: 0, failed: 0, amountPaid: 0, stuck: 0,
            byTier: { leader: 0, gold: 0, elite: 0 },
        };

        // Exactly the population the board ranks, so a badge and a payment can
        // never disagree.
        const qualifiers = await referralRepository.getMonthlyQualifiers(minSales, monthStart, monthEnd);
        report.qualifiers = qualifiers.length;
        log.info(`Leaderboard bonus ${month}: ${qualifiers.length} qualifier(s) at >= ${minSales} sales.`);

        for (const q of qualifiers) {
            const tier = tierForSales(q.salesCount);
            if (!tier) continue; // impossible given minSales, but never pay 0

            report.byTier[tier.key]++;

            if (dryRun) {
                report.paid++;
                report.amountPaid += tier.amountXaf;
                continue;
            }

            let row: ILeaderboardBonus;
            try {
                row = await LeaderboardBonusModel.create({
                    userId: new Types.ObjectId(q.userId),
                    month,
                    tier: tier.key,
                    salesCount: q.salesCount,
                    amount: tier.amountXaf,
                    status: 'pending',
                });
            } catch (error: any) {
                if (error?.code === 11000) {
                    // Someone already claimed this (userId, month) — an earlier
                    // run, or another replica a millisecond ago. Never pay again.
                    report.skipped++;
                    const existing = await LeaderboardBonusModel.findOne({ userId: q.userId, month }).lean();
                    if (existing?.status === 'pending') report.stuck++;
                    continue;
                }
                throw error;
            }

            try {
                const updated = await userRepository.updateActivationBalance(q.userId, tier.amountXaf);
                if (!updated) throw new Error('User not found');

                await LeaderboardBonusModel.updateOne({ _id: row._id }, { status: 'paid', paidAt: new Date() });
                report.paid++;
                report.amountPaid += tier.amountXaf;
                log.info(`AUDIT: leaderboard bonus paid`, {
                    userId: q.userId, month, tier: tier.key, salesCount: q.salesCount,
                    amount: tier.amountXaf, wallet: 'activation', newActivationBalance: updated.activationBalance,
                });
            } catch (error: any) {
                // The credit did not go through: mark it failed so a human can
                // see it. The row stays, so an automatic retry can never turn
                // this into a double payment.
                await LeaderboardBonusModel.updateOne({ _id: row._id }, { status: 'failed', error: String(error?.message ?? error) });
                report.failed++;
                log.error(`Leaderboard bonus credit failed for ${q.userId} (${month}): ${error?.message}`);
            }
        }

        return report;
    }

    /**
     * The scheduled run: pays for the month that just closed.
     *
     * Claims the month first. With several replicas the cron fires on each one;
     * the loser of the insert stands down rather than recomputing the whole
     * aggregation for nothing.
     */
    async runScheduledPayout(triggeredBy = 'cron'): Promise<PayoutReport | null> {
        if (!config.leaderboardBonus.enabled) {
            log.info('Leaderboard bonus payout is disabled (LEADERBOARD_BONUS_ENABLED).');
            return null;
        }

        const monthStart = previousMonthStart();
        const month = monthKey(monthStart);

        if (month < config.leaderboardBonus.firstPaidMonth) {
            log.info(`Leaderboard bonus starts with ${config.leaderboardBonus.firstPaidMonth}; nothing to pay for ${month}.`);
            return null;
        }

        try {
            await LeaderboardPayoutRunModel.create({ month, startedAt: new Date(), triggeredBy });
        } catch (error: any) {
            if (error?.code === 11000) {
                log.info(`Leaderboard bonus for ${month} is already being handled elsewhere — standing down.`);
                return null;
            }
            throw error;
        }

        const report = await this.payoutForMonth(monthStart, { triggeredBy });
        await LeaderboardPayoutRunModel.updateOne({ month }, {
            finishedAt: new Date(),
            qualifiers: report.qualifiers,
            paid: report.paid,
            skipped: report.skipped,
            failed: report.failed,
            amountPaid: report.amountPaid,
        });

        log.info(`Leaderboard bonus ${month} done: ${report.paid} paid (${report.amountPaid} FCFA), ${report.skipped} skipped, ${report.failed} failed.`);
        return report;
    }

    /** The ledger for a month, for the admin console. */
    async listBonuses(month: string, limit = 100, skip = 0) {
        const [items, total] = await Promise.all([
            LeaderboardBonusModel.find({ month }).sort({ amount: -1, createdAt: 1 }).skip(skip).limit(limit).lean(),
            LeaderboardBonusModel.countDocuments({ month }),
        ]);
        return { items, total };
    }

    /** What a member has been paid, newest first (their own history). */
    async listForUser(userId: string, limit = 24) {
        return LeaderboardBonusModel.find({ userId: new Types.ObjectId(userId) })
            .sort({ month: -1 }).limit(limit).lean();
    }
}

export const leaderboardBonusService = new LeaderboardBonusService();
