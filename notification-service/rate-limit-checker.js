/**
 * WhatsApp Business API Rate Limit Checker
 * Helps track and manage messaging limits to prevent hitting daily caps
 */

const fs = require('fs');
const path = require('path');

class WhatsAppRateLimiter {
    constructor() {
        this.limitsFile = path.join(__dirname, 'messaging-limits.json');
        this.loadLimits();
    }

    loadLimits() {
        try {
            if (fs.existsSync(this.limitsFile)) {
                this.limits = JSON.parse(fs.readFileSync(this.limitsFile, 'utf8'));
            } else {
                this.limits = {
                    dailyLimit: 250, // Default tier limit
                    currentCount: 0,
                    resetTime: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
                    lastUpdated: Date.now()
                };
                this.saveLimits();
            }
        } catch (error) {
            console.error('Error loading limits:', error);
            this.limits = {
                dailyLimit: 250,
                currentCount: 0,
                resetTime: Date.now() + (24 * 60 * 60 * 1000),
                lastUpdated: Date.now()
            };
        }
    }

    saveLimits() {
        try {
            fs.writeFileSync(this.limitsFile, JSON.stringify(this.limits, null, 2));
        } catch (error) {
            console.error('Error saving limits:', error);
        }
    }

    checkAndResetIfNeeded() {
        const now = Date.now();
        if (now >= this.limits.resetTime) {
            // Reset the counter
            this.limits.currentCount = 0;
            this.limits.resetTime = now + (24 * 60 * 60 * 1000);
            this.limits.lastUpdated = now;
            this.saveLimits();
            console.log('✅ Messaging limits reset for new 24-hour period');
        }
    }

    canSendMessage() {
        this.checkAndResetIfNeeded();
        return this.limits.currentCount < this.limits.dailyLimit;
    }

    incrementCount() {
        this.limits.currentCount++;
        this.limits.lastUpdated = Date.now();
        this.saveLimits();
    }

    getRemainingMessages() {
        this.checkAndResetIfNeeded();
        return Math.max(0, this.limits.dailyLimit - this.limits.currentCount);
    }

    getStatus() {
        this.checkAndResetIfNeeded();
        const remaining = this.getRemainingMessages();
        const hoursUntilReset = Math.ceil((this.limits.resetTime - Date.now()) / (1000 * 60 * 60));

        return {
            canSend: this.canSendMessage(),
            remaining: remaining,
            used: this.limits.currentCount,
            total: this.limits.dailyLimit,
            hoursUntilReset: hoursUntilReset,
            resetTime: new Date(this.limits.resetTime).toISOString()
        };
    }

    updateDailyLimit(newLimit) {
        this.limits.dailyLimit = newLimit;
        this.saveLimits();
        console.log(`📊 Daily limit updated to ${newLimit}`);
    }
}

module.exports = WhatsAppRateLimiter;