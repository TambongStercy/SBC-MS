/**
 * WhatsApp Fallback Strategy
 * Automatically falls back to plain text when rate limits are hit
 */

const WhatsAppRateLimiter = require('./rate-limit-checker');

class WhatsAppFallbackService {
    constructor(whatsappService) {
        this.whatsappService = whatsappService;
        this.rateLimiter = new WhatsAppRateLimiter();
    }

    async sendOTP(phoneNumber, otpCode, options = {}) {
        const status = this.rateLimiter.getStatus();

        // If we can send template messages and user prefers them
        if (status.canSend && options.preferTemplate !== false) {
            try {
                console.log(`📱 Sending template OTP to ${phoneNumber} (${status.remaining} remaining)`);

                const result = await this.whatsappService.sendTemplateMessage({
                    phoneNumber,
                    templateName: 'connexion',
                    languageCode: 'en_US',
                    components: [
                        {
                            type: 'body',
                            parameters: [{ type: 'text', text: otpCode }]
                        }
                    ]
                });

                if (result.success) {
                    this.rateLimiter.incrementCount();
                    return {
                        success: true,
                        method: 'template',
                        messageId: result.messageId
                    };
                }
            } catch (error) {
                console.warn('Template message failed, falling back to plain text:', error.message);
            }
        }

        // Fallback to plain text message
        console.log(`📝 Sending plain text OTP to ${phoneNumber} (fallback mode)`);

        try {
            const result = await this.whatsappService.sendTextMessage({
                phoneNumber,
                message: `🔐 Your SBC verification code is: ${otpCode}\n\nFor your security, do not share this code.\n\nThis code expires in 5 minutes.`
            });

            return {
                success: result.success,
                method: 'plaintext',
                messageId: result.messageId,
                fallbackReason: !status.canSend ? 'rate_limit_exceeded' : 'template_failed'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                method: 'failed'
            };
        }
    }

    getStatus() {
        return this.rateLimiter.getStatus();
    }

    async sendBulkOTP(recipients, otpGenerator, options = {}) {
        const results = [];
        const status = this.rateLimiter.getStatus();

        console.log(`📊 Starting bulk OTP send. ${status.remaining} template messages available.`);

        for (const recipient of recipients) {
            const otpCode = otpGenerator(recipient);
            const result = await this.sendOTP(recipient.phoneNumber, otpCode, options);

            results.push({
                phoneNumber: recipient.phoneNumber,
                ...result
            });

            // Add delay between messages to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }
}

module.exports = WhatsAppFallbackService;