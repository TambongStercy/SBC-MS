/**
 * Email + WhatsApp Fallback Strategy
 * Tries email first, falls back to WhatsApp if email bounces or fails
 */

const { emailService } = require('./dist/services/email.service');
const WhatsAppFallbackService = require('./whatsapp-fallback-strategy');

class SmartNotificationService {
    constructor() {
        // Initialize WhatsApp fallback service
        // You'll need to pass your actual WhatsApp service here
        this.whatsappFallback = new WhatsAppFallbackService(null); // Replace with actual service

        // Track email bounce patterns
        this.emailBounceCache = new Map();
        this.emailSuccessCache = new Map();
    }

    /**
     * Smart notification sending with automatic fallback
     */
    async sendNotification(options) {
        const {
            email,
            phoneNumber,
            message,
            type = 'general', // 'otp', 'transaction', 'general'
            forceWhatsApp = false
        } = options;

        const result = {
            email: { attempted: false, success: false, error: null },
            whatsapp: { attempted: false, success: false, error: null },
            finalMethod: null,
            recommendation: null
        };

        // Check if this email has bounced recently
        const recentBounce = this.hasRecentBounce(email);
        const shouldSkipEmail = forceWhatsApp || recentBounce;

        // Strategy 1: Try email first (unless we should skip)
        if (!shouldSkipEmail) {
            try {
                result.email.attempted = true;
                console.log(`📧 Attempting email to ${email}...`);

                const emailSuccess = await emailService.sendEmail({
                    to: email,
                    subject: this.getSubjectForType(type),
                    html: this.getHtmlForType(type, message),
                    text: this.getTextForType(type, message)
                });

                result.email.success = emailSuccess;

                if (emailSuccess) {
                    result.finalMethod = 'email';
                    this.markEmailSuccess(email);
                    console.log(`✅ Email sent successfully to ${email}`);
                    return result;
                }
            } catch (error) {
                result.email.error = error.message;
                console.log(`❌ Email failed: ${error.message}`);
                this.markEmailFailure(email, error.message);
            }
        } else if (recentBounce) {
            console.log(`⚠️ Skipping email to ${email} due to recent bounce`);
            result.email.error = 'Skipped due to recent bounce';
        }

        // Strategy 2: Fallback to WhatsApp
        if (phoneNumber) {
            try {
                result.whatsapp.attempted = true;
                console.log(`📱 Falling back to WhatsApp for ${phoneNumber}...`);

                const whatsappResult = await this.sendWhatsAppMessage(phoneNumber, message, type);
                result.whatsapp.success = whatsappResult.success;
                result.whatsapp.error = whatsappResult.error;

                if (whatsappResult.success) {
                    result.finalMethod = 'whatsapp';
                    console.log(`✅ WhatsApp sent successfully to ${phoneNumber}`);

                    // Add recommendation
                    if (result.email.attempted && !result.email.success) {
                        result.recommendation = 'Consider collecting more reliable email addresses from users';
                    }

                    return result;
                }
            } catch (error) {
                result.whatsapp.error = error.message;
                console.log(`❌ WhatsApp also failed: ${error.message}`);
            }
        }

        // Both methods failed
        result.finalMethod = 'failed';
        result.recommendation = 'Both email and WhatsApp failed. Check user contact information.';
        return result;
    }

    /**
     * Send OTP with smart fallback
     */
    async sendOTP(email, phoneNumber, otpCode) {
        return this.sendNotification({
            email,
            phoneNumber,
            message: otpCode,
            type: 'otp'
        });
    }

    /**
     * Send transaction notification with smart fallback
     */
    async sendTransactionNotification(email, phoneNumber, transactionData) {
        return this.sendNotification({
            email,
            phoneNumber,
            message: transactionData,
            type: 'transaction'
        });
    }

    /**
     * WhatsApp message sending (replace with your actual implementation)
     */
    async sendWhatsAppMessage(phoneNumber, message, type) {
        // This is a placeholder - replace with your actual WhatsApp service
        try {
            if (type === 'otp') {
                return await this.whatsappFallback.sendOTP(phoneNumber, message);
            } else {
                // For other types, send as plain text
                return {
                    success: true, // Replace with actual WhatsApp call
                    messageId: 'placeholder'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if email has bounced recently
     */
    hasRecentBounce(email) {
        const bounceTime = this.emailBounceCache.get(email);
        if (!bounceTime) return false;

        // Consider "recent" as within the last 24 hours
        const hoursSinceBounce = (Date.now() - bounceTime) / (1000 * 60 * 60);
        return hoursSinceBounce < 24;
    }

    /**
     * Mark email as having bounced
     */
    markEmailFailure(email, reason) {
        this.emailBounceCache.set(email, Date.now());
        console.log(`📝 Marked ${email} as bounced: ${reason}`);
    }

    /**
     * Mark email as successful
     */
    markEmailSuccess(email) {
        this.emailSuccessCache.set(email, Date.now());
        // Remove from bounce cache if it was there
        this.emailBounceCache.delete(email);
    }

    /**
     * Get email bounce statistics
     */
    getEmailStats() {
        return {
            totalBounces: this.emailBounceCache.size,
            totalSuccesses: this.emailSuccessCache.size,
            recentBounces: Array.from(this.emailBounceCache.entries()).map(([email, time]) => ({
                email,
                hoursAgo: Math.round((Date.now() - time) / (1000 * 60 * 60))
            }))
        };
    }

    // Helper methods for different message types
    getSubjectForType(type) {
        switch (type) {
            case 'otp': return '🔐 Your SBC Verification Code';
            case 'transaction': return '💳 SBC Transaction Notification';
            default: return '📧 SBC Notification';
        }
    }

    getHtmlForType(type, message) {
        // Return appropriate HTML based on type and message
        // This is a simplified version - expand based on your needs
        return `<div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>SBC Notification</h2>
            <p>${message}</p>
        </div>`;
    }

    getTextForType(type, message) {
        return `SBC Notification: ${message}`;
    }
}

module.exports = SmartNotificationService;