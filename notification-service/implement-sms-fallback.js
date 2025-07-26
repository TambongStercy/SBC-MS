const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// SMS Fallback Implementation for WhatsApp OTP Failures
class SMSFallbackService {
    constructor() {
        // Using a simple SMS API service (you can replace with your preferred provider)
        this.smsApiUrl = process.env.SMS_API_URL || 'https://api.textflow.me/api/send-sms';
        this.smsApiKey = process.env.SMS_API_KEY || '';
        this.notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api';
    }

    /**
     * Check if WhatsApp OTP delivery failed and send SMS fallback
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} otpCode - OTP code to send
     * @param {string} userName - User name (optional)
     * @param {number} delayMinutes - Wait time before fallback (default: 2 minutes)
     */
    async scheduleSmsFallback(phoneNumber, otpCode, userName = '', delayMinutes = 2) {
        console.log(`📞 Scheduling SMS fallback for ${phoneNumber} in ${delayMinutes} minutes...`);

        // Wait for specified delay
        setTimeout(async () => {
            try {
                // Check if WhatsApp message was delivered
                const delivered = await this.checkWhatsAppDeliveryStatus(phoneNumber, otpCode);

                if (!delivered) {
                    console.log(`📱 WhatsApp not delivered to ${phoneNumber}, sending SMS fallback...`);
                    await this.sendSmsFallback(phoneNumber, otpCode, userName);
                } else {
                    console.log(`✅ WhatsApp delivered to ${phoneNumber}, SMS fallback not needed`);
                }
            } catch (error) {
                console.error(`❌ SMS fallback error for ${phoneNumber}:`, error.message);
            }
        }, delayMinutes * 60 * 1000);
    }

    /**
     * Check if WhatsApp OTP was delivered in the last few minutes
     * @param {string} phoneNumber - Phone number to check
     * @param {string} otpCode - OTP code sent
     * @returns {boolean} - Whether message was delivered
     */
    async checkWhatsAppDeliveryStatus(phoneNumber, otpCode) {
        try {
            // This would query your notification database
            // For now, return false to trigger SMS fallback for testing
            console.log(`🔍 Checking WhatsApp delivery status for ${phoneNumber}...`);

            // TODO: Implement actual database check
            // const delivered = await this.queryNotificationDatabase(phoneNumber, otpCode);

            // For demonstration, assume WhatsApp failed
            return false;
        } catch (error) {
            console.error('Error checking delivery status:', error);
            return false; // Assume failed, send SMS
        }
    }

    /**
     * Send SMS fallback message
     * @param {string} phoneNumber - Recipient phone number  
     * @param {string} otpCode - OTP code
     * @param {string} userName - User name
     */
    async sendSmsFallback(phoneNumber, otpCode, userName = '') {
        try {
            // Format SMS message
            const message = this.formatSmsMessage(otpCode, userName);

            console.log(`📞 Sending SMS fallback to ${phoneNumber}: ${message}`);

            // Example using TextFlow API (replace with your SMS provider)
            const response = await axios.post(this.smsApiUrl, {
                to: phoneNumber,
                text: message,
                api_key: this.smsApiKey
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.ok) {
                console.log(`✅ SMS fallback sent successfully to ${phoneNumber}`);

                // Log the fallback event
                await this.logFallbackEvent(phoneNumber, otpCode, 'sms_sent');

            } else {
                console.error(`❌ SMS fallback failed for ${phoneNumber}:`, response.data);
                await this.logFallbackEvent(phoneNumber, otpCode, 'sms_failed');
            }

        } catch (error) {
            console.error(`❌ SMS fallback error for ${phoneNumber}:`, error.message);
            await this.logFallbackEvent(phoneNumber, otpCode, 'sms_error');
        }
    }

    /**
     * Format SMS message for OTP
     * @param {string} otpCode - OTP code
     * @param {string} userName - User name
     * @returns {string} - Formatted SMS message
     */
    formatSmsMessage(otpCode, userName = '') {
        const greeting = userName ? `Hi ${userName}, ` : '';
        return `${greeting}Your SBC verification code is: ${otpCode}. This code expires in 10 minutes. Do not share this code with anyone.`;
    }

    /**
     * Log fallback events for monitoring
     * @param {string} phoneNumber - Phone number
     * @param {string} otpCode - OTP code  
     * @param {string} event - Event type
     */
    async logFallbackEvent(phoneNumber, otpCode, event) {
        try {
            const logData = {
                timestamp: new Date().toISOString(),
                phoneNumber,
                otpCode: otpCode.substring(0, 2) + '****', // Partial OTP for security
                event,
                fallbackMethod: 'sms'
            };

            console.log(`📊 Logging fallback event:`, logData);

            // TODO: Store in database or send to monitoring service
            // await this.storeFallbackLog(logData);

        } catch (error) {
            console.error('Error logging fallback event:', error);
        }
    }

    /**
     * Integration with notification service
     * @param {string} userId - User ID
     * @param {string} phoneNumber - Phone number
     * @param {string} otpCode - OTP code
     * @param {string} userName - User name
     */
    async sendOtpWithFallback(userId, phoneNumber, otpCode, userName = '') {
        try {
            console.log(`🚀 Sending OTP with SMS fallback to ${phoneNumber}`);

            // 1. Send WhatsApp OTP first
            const whatsappResponse = await axios.post(`${this.notificationServiceUrl}/notifications/otp`, {
                userId,
                recipient: phoneNumber,
                channel: 'whatsapp',
                code: otpCode,
                expireMinutes: 10,
                userName
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                    'Content-Type': 'application/json'
                }
            });

            if (whatsappResponse.data.success) {
                console.log(`✅ WhatsApp OTP queued for ${phoneNumber}`);

                // 2. Schedule SMS fallback in 2 minutes
                this.scheduleSmsFallback(phoneNumber, otpCode, userName, 2);

                return {
                    success: true,
                    method: 'whatsapp_with_sms_fallback',
                    message: 'OTP sent via WhatsApp with SMS fallback scheduled'
                };
            } else {
                // WhatsApp failed immediately, send SMS now
                console.log(`❌ WhatsApp OTP failed for ${phoneNumber}, sending SMS immediately`);
                await this.sendSmsFallback(phoneNumber, otpCode, userName);

                return {
                    success: true,
                    method: 'sms_immediate',
                    message: 'OTP sent via SMS (WhatsApp unavailable)'
                };
            }

        } catch (error) {
            console.error(`❌ Error in OTP with fallback for ${phoneNumber}:`, error.message);

            // Last resort: try SMS
            try {
                await this.sendSmsFallback(phoneNumber, otpCode, userName);
                return {
                    success: true,
                    method: 'sms_emergency',
                    message: 'OTP sent via SMS (emergency fallback)'
                };
            } catch (smsError) {
                return {
                    success: false,
                    method: 'failed',
                    message: 'Both WhatsApp and SMS delivery failed'
                };
            }
        }
    }
}

// Example usage and testing
async function testSmsFallback() {
    const smsService = new SMSFallbackService();

    console.log('🧪 Testing SMS Fallback Service\n');

    // Test with your phone number
    const testPhoneNumber = '+237675080477'; // Replace with your number
    const testOtpCode = '123456';
    const testUserName = 'Test User';

    try {
        const result = await smsService.sendOtpWithFallback(
            '507f1f77bcf86cd799439011', // Test user ID
            testPhoneNumber,
            testOtpCode,
            testUserName
        );

        console.log('🎉 Test Result:', result);

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
    }
}

// Run test if called directly
if (require.main === module) {
    console.log('📞 SMS Fallback Service');
    console.log('='.repeat(40));
    console.log('📋 Configuration:');
    console.log(`   SMS API URL: ${process.env.SMS_API_URL || 'Not configured'}`);
    console.log(`   SMS API Key: ${process.env.SMS_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   Notification Service: ${process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api'}`);

    if (process.argv.includes('--test')) {
        testSmsFallback().catch(console.error);
    } else {
        console.log('\n💡 Usage:');
        console.log('   node implement-sms-fallback.js --test  # Run test');
        console.log('   # Or import and use SMSFallbackService class');
    }
}

module.exports = { SMSFallbackService }; 