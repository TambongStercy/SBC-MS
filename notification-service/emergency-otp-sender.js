/**
 * Emergency OTP Sender - Plain Text Only
 * Use this when template message limits are reached
 */

const axios = require('axios');
require('dotenv').config();

const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    baseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

async function sendEmergencyOTP(phoneNumber, otpCode) {
    console.log(`🚨 Sending emergency OTP to ${phoneNumber}`);
    console.log('📝 Using plain text (no limit impact)');

    try {
        const message = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: {
                body: `🔐 *Your SBC verification code is: ${otpCode}*\n\n✅ This code is valid for 5 minutes.\n🔒 For your security, do not share this code.\n\n_Sniper Business Center - Your trusted platform_`
            }
        };

        const response = await axios.post(
            `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
            message,
            {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.messages && response.data.messages.length > 0) {
            console.log('✅ Emergency OTP sent successfully!');
            console.log(`📱 Message ID: ${response.data.messages[0].id}`);
            return {
                success: true,
                messageId: response.data.messages[0].id,
                method: 'emergency_plaintext'
            };
        }

        return { success: false, error: 'No message ID in response' };

    } catch (error) {
        console.error('❌ Emergency OTP failed:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error?.message || error.message
        };
    }
}

// Test function
async function testEmergencyOTP() {
    const testNumber = '237675080477'; // Your number
    const testOTP = Math.floor(100000 + Math.random() * 900000).toString();

    console.log('🧪 Testing Emergency OTP Sender');
    console.log('===============================');
    console.log(`📞 Target: ${testNumber}`);
    console.log(`🔢 OTP: ${testOTP}\n`);

    const result = await sendEmergencyOTP(testNumber, testOTP);

    if (result.success) {
        console.log('\n🎉 SUCCESS! Check your WhatsApp for the OTP.');
    } else {
        console.log('\n❌ FAILED:', result.error);
    }

    return result;
}

// Export for use in other modules
module.exports = { sendEmergencyOTP };

// Run test if called directly
if (require.main === module) {
    testEmergencyOTP();
}