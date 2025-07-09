import logger from '../utils/logger';
import config from '../config';
import { emailService } from './email.service';

const log = logger.getLogger('BounceHandlerService');

interface BounceEvent {
    email: string;
    timestamp: Date;
    reason: string;
    bounceType: 'hard' | 'soft' | 'spam' | 'block';
    severity: 'low' | 'medium' | 'high';
    retryCount: number;
}

interface EmailRetryInfo {
    email: string;
    subject: string;
    html: string;
    text?: string;
    retryCount: number;
    lastAttempt: Date;
    nextRetry: Date;
    originalError: string;
}

export class BounceHandlerService {
    private bounceHistory: Map<string, BounceEvent[]> = new Map();
    private retryQueue: Map<string, EmailRetryInfo> = new Map();
    private blacklistedEmails: Set<string> = new Set();

    constructor() {
        this.loadBlacklistedEmails();
    }

    /**
     * Process bounce webhook from SendGrid
     */
    async processBounceWebhook(webhookData: any): Promise<void> {
        try {
            log.info('Processing bounce webhook', { data: webhookData });

            for (const event of webhookData) {
                if (event.event === 'bounce' || event.event === 'dropped') {
                    await this.handleBounce({
                        email: event.email,
                        timestamp: new Date(event.timestamp * 1000),
                        reason: event.reason || 'Unknown',
                        bounceType: this.classifyBounceType(event.reason || ''),
                        severity: this.calculateSeverity(event.reason || ''),
                        retryCount: 0
                    });
                }
            }
        } catch (error) {
            log.error('Error processing bounce webhook', { error });
        }
    }

    /**
     * Handle individual bounce event
     */
    async handleBounce(bounce: BounceEvent): Promise<void> {
        log.warn('Email bounce detected', {
            email: bounce.email,
            reason: bounce.reason,
            type: bounce.bounceType,
            severity: bounce.severity
        });

        // Store bounce history
        if (!this.bounceHistory.has(bounce.email)) {
            this.bounceHistory.set(bounce.email, []);
        }
        this.bounceHistory.get(bounce.email)!.push(bounce);

        // Handle based on bounce type and severity
        switch (bounce.bounceType) {
            case 'hard':
                await this.handleHardBounce(bounce);
                break;
            case 'soft':
                await this.handleSoftBounce(bounce);
                break;
            case 'spam':
                await this.handleSpamComplaint(bounce);
                break;
            case 'block':
                await this.handleBlockedBounce(bounce);
                break;
        }
    }

    /**
     * Handle hard bounces (permanent failures)
     */
    private async handleHardBounce(bounce: BounceEvent): Promise<void> {
        log.error('Hard bounce detected - adding to blacklist', { email: bounce.email });

        // Add to blacklist immediately
        this.blacklistedEmails.add(bounce.email);

        // Remove from retry queue if exists
        this.retryQueue.delete(bounce.email);

        // Log for admin attention
        log.error('Email permanently undeliverable', {
            email: bounce.email,
            reason: bounce.reason
        });
    }

    /**
     * Handle soft bounces (temporary failures)
     */
    private async handleSoftBounce(bounce: BounceEvent): Promise<void> {
        const bounceCount = this.getBounceCount(bounce.email);

        if (bounceCount >= 5) {
            log.warn('Too many soft bounces - treating as hard bounce', {
                email: bounce.email,
                bounceCount
            });
            await this.handleHardBounce(bounce);
            return;
        }

        // Check if domain-specific issue (like the current problem)
        if (this.isDomainConfigurationIssue(bounce.reason)) {
            log.info('Domain configuration issue detected - will retry after fix', {
                email: bounce.email,
                reason: bounce.reason
            });
            // Don't blacklist, but log for admin attention
            return;
        }

        // Schedule retry for soft bounces
        await this.scheduleRetry(bounce);
    }

    /**
     * Handle spam complaints
     */
    private async handleSpamComplaint(bounce: BounceEvent): Promise<void> {
        log.error('Spam complaint received', { email: bounce.email });

        // Immediately blacklist
        this.blacklistedEmails.add(bounce.email);

        // Alert admin
        log.error('URGENT: Spam complaint - review email content and practices', {
            email: bounce.email,
            reason: bounce.reason
        });
    }

    /**
     * Handle blocked emails (reputation issues)
     */
    private async handleBlockedBounce(bounce: BounceEvent): Promise<void> {
        log.warn('Email blocked by provider', {
            email: bounce.email,
            reason: bounce.reason
        });

        // Temporary blacklist for blocked emails
        this.blacklistedEmails.add(bounce.email);

        // Schedule retry after longer delay
        setTimeout(() => {
            this.blacklistedEmails.delete(bounce.email);
            log.info('Removed from temporary blacklist', { email: bounce.email });
        }, 24 * 60 * 60 * 1000); // 24 hours
    }

    /**
     * Classify bounce type based on reason
     */
    private classifyBounceType(reason: string): 'hard' | 'soft' | 'spam' | 'block' {
        const lowerReason = reason.toLowerCase();

        // Hard bounces
        if (lowerReason.includes('user unknown') ||
            lowerReason.includes('mailbox does not exist') ||
            lowerReason.includes('invalid recipient') ||
            lowerReason.includes('no such user')) {
            return 'hard';
        }

        // Spam-related
        if (lowerReason.includes('spam') ||
            lowerReason.includes('blacklist') ||
            lowerReason.includes('blocked')) {
            return 'spam';
        }

        // Domain/configuration issues (current problem)
        if (lowerReason.includes('domain not found') ||
            lowerReason.includes('sender address rejected') ||
            lowerReason.includes('authentication')) {
            return 'block';
        }

        // Default to soft bounce
        return 'soft';
    }

    /**
     * Calculate severity based on reason
     */
    private calculateSeverity(reason: string): 'low' | 'medium' | 'high' {
        const lowerReason = reason.toLowerCase();

        if (lowerReason.includes('domain not found') ||
            lowerReason.includes('authentication') ||
            lowerReason.includes('spam')) {
            return 'high';
        }

        if (lowerReason.includes('mailbox full') ||
            lowerReason.includes('temporarily unavailable')) {
            return 'low';
        }

        return 'medium';
    }

    /**
     * Check if bounce is due to domain configuration issues
     */
    private isDomainConfigurationIssue(reason: string): boolean {
        const lowerReason = reason.toLowerCase();
        return lowerReason.includes('domain not found') ||
            lowerReason.includes('sender address rejected') ||
            lowerReason.includes('spf') ||
            lowerReason.includes('dkim') ||
            lowerReason.includes('authentication');
    }

    /**
     * Schedule email retry
     */
    private async scheduleRetry(bounce: BounceEvent): Promise<void> {
        const retryInfo = this.retryQueue.get(bounce.email);
        const retryCount = retryInfo ? retryInfo.retryCount + 1 : 1;

        if (retryCount > config.email.bounceHandling.maxRetries) {
            log.warn('Max retries exceeded - giving up', {
                email: bounce.email,
                retryCount
            });
            this.blacklistedEmails.add(bounce.email);
            this.retryQueue.delete(bounce.email);
            return;
        }

        const delay = this.calculateRetryDelay(retryCount);
        const nextRetry = new Date(Date.now() + delay);

        log.info('Scheduling email retry', {
            email: bounce.email,
            retryCount,
            nextRetry
        });

        // In a real implementation, you'd persist this to database
        // For now, just log the retry schedule
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private calculateRetryDelay(retryCount: number): number {
        const baseDelay = config.email.bounceHandling.retryDelay;
        return baseDelay * Math.pow(2, retryCount - 1);
    }

    /**
     * Get bounce count for email
     */
    private getBounceCount(email: string): number {
        return this.bounceHistory.get(email)?.length || 0;
    }

    /**
     * Check if email is blacklisted
     */
    isBlacklisted(email: string): boolean {
        return this.blacklistedEmails.has(email);
    }

    /**
     * Get email reputation score
     */
    getEmailReputation(email: string): 'good' | 'poor' | 'blacklisted' {
        if (this.blacklistedEmails.has(email)) {
            return 'blacklisted';
        }

        const bounces = this.bounceHistory.get(email) || [];
        const recentBounces = bounces.filter(b =>
            Date.now() - b.timestamp.getTime() < 30 * 24 * 60 * 60 * 1000 // 30 days
        );

        if (recentBounces.length >= 3) {
            return 'poor';
        }

        return 'good';
    }

    /**
     * Generate bounce report for admin
     */
    generateBounceReport(): any {
        const report = {
            summary: {
                totalBlacklisted: this.blacklistedEmails.size,
                totalAddressesWithBounces: this.bounceHistory.size,
                retryQueueSize: this.retryQueue.size
            },
            recentBounces: [] as any[],
            topBounceReasons: new Map(),
            recommendations: [] as string[]
        };

        // Analyze recent bounces
        const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
        for (const [email, bounces] of this.bounceHistory.entries()) {
            const recentBounces = bounces.filter(b => b.timestamp.getTime() > last24Hours);
            if (recentBounces.length > 0) {
                report.recentBounces.push({
                    email,
                    bounceCount: recentBounces.length,
                    lastReason: recentBounces[recentBounces.length - 1].reason
                });
            }
        }

        // Generate recommendations based on current issues
        if (report.summary.totalBlacklisted > 10) {
            report.recommendations.push('High blacklist count - review email practices');
        }

        // Check for domain configuration issues
        let domainIssues = 0;
        for (const bounces of this.bounceHistory.values()) {
            if (bounces.some(b => this.isDomainConfigurationIssue(b.reason))) {
                domainIssues++;
            }
        }

        if (domainIssues > 0) {
            report.recommendations.push('Domain configuration issues detected - check DNS records');
        }

        return report;
    }

    /**
     * Load blacklisted emails from persistent storage
     */
    private loadBlacklistedEmails(): void {
        // In a real implementation, load from database
        // For now, start with empty set
        log.info('Bounce handler service initialized');
    }

    /**
     * Clean up old bounce data
     */
    async cleanup(): Promise<void> {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

        for (const [email, bounces] of this.bounceHistory.entries()) {
            const recentBounces = bounces.filter(b =>
                b.timestamp.getTime() > thirtyDaysAgo
            );

            if (recentBounces.length === 0) {
                this.bounceHistory.delete(email);
            } else {
                this.bounceHistory.set(email, recentBounces);
            }
        }

        log.info('Bounce data cleanup completed');
    }
}

export default BounceHandlerService; 