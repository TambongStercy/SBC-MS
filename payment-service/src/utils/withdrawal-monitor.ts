import logger from './logger';

const log = logger.getLogger('WithdrawalMonitor');

interface BlockedWithdrawalAttempt {
    userId: string;
    amount: number;
    countryCode: string;
    timestamp: Date;
    reason: string;
    adminId?: string;
}

class WithdrawalMonitor {
    private blockedAttempts: BlockedWithdrawalAttempt[] = [];
    private readonly maxStoredAttempts = 1000;

    /**
     * Log a blocked withdrawal attempt
     */
    public logBlockedAttempt(attempt: BlockedWithdrawalAttempt): void {
        // Add to in-memory storage
        this.blockedAttempts.unshift(attempt);
        
        // Keep only the most recent attempts
        if (this.blockedAttempts.length > this.maxStoredAttempts) {
            this.blockedAttempts = this.blockedAttempts.slice(0, this.maxStoredAttempts);
        }

        // Log the attempt
        log.warn(`🚫 BLOCKED WITHDRAWAL ATTEMPT`, {
            userId: attempt.userId,
            amount: attempt.amount,
            countryCode: attempt.countryCode,
            reason: attempt.reason,
            adminId: attempt.adminId,
            timestamp: attempt.timestamp.toISOString()
        });
    }

    /**
     * Get recent blocked attempts for monitoring
     */
    public getRecentBlockedAttempts(limit: number = 50): BlockedWithdrawalAttempt[] {
        return this.blockedAttempts.slice(0, limit);
    }

    /**
     * Get blocked attempts statistics
     */
    public getBlockedAttemptsStats(): {
        totalBlocked: number;
        last24Hours: number;
        byCountry: Record<string, number>;
        byReason: Record<string, number>;
    } {
        const now = new Date();
        const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const stats = {
            totalBlocked: this.blockedAttempts.length,
            last24Hours: 0,
            byCountry: {} as Record<string, number>,
            byReason: {} as Record<string, number>
        };

        this.blockedAttempts.forEach(attempt => {
            // Count last 24 hours
            if (attempt.timestamp >= last24Hours) {
                stats.last24Hours++;
            }

            // Count by country
            stats.byCountry[attempt.countryCode] = (stats.byCountry[attempt.countryCode] || 0) + 1;

            // Count by reason
            stats.byReason[attempt.reason] = (stats.byReason[attempt.reason] || 0) + 1;
        });

        return stats;
    }
}

export const withdrawalMonitor = new WithdrawalMonitor();