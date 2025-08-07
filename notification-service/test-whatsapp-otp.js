/**
 * WhatsApp OTP Test Script
 * Tests both template and plain text OTP sending to verify the service is working
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Import the WhatsApp service (handle both CommonJS and ES modules)
let WhatsAppCloudService, getOtpTemplateConfig;

try {
    // Try ES module import
    WhatsAppCloudService = require('./src/services/whatsapp-cloud.service').default;
} catch (e) {
    try {
        // Try CommonJS import
        WhatsAppCloudService = require('./src/services/whatsapp-cloud.service');
    } catch (e2) {
        console.log('❌ Could not import WhatsApp service. Using direct API calls instead.');
        console.log('💡 Run "node simple-whatsapp-test.js" for a working test.');
        process.exit(1);
    }
}

try {
    const otpConfig = require('./src/utils/otp-template.config');
    getOtpTemplateConfig = otpConfig.getOtpTemplateConfig;
} catch (e) {
    console.log('❌ Could not import OTP template config. Using defaults.');
    getOtpTemplateConfig = () => ({ templateName: 'connexion', languageCode: 'en_US' });
}

// Test configuration
const TEST_CONFIG = {
    phoneNumber: '237675080477', // Your number
    testOtpCode: '123456',
    language: 'en', // Can be 'en' or 'fr'
    testMessage: 'Test OTP from SBC: Your verification code is 123456. This is a test message to verify WhatsApp service functionality.'
};

async function testWhatsAppOTP() {
    console.log('🧪 WhatsApp OTP Service Test');
    console.log('============================\n');
    
    try {
        // Initialize WhatsApp service
        console.log('1. Initializing WhatsApp Cloud Service...');
        const whatsappService = new WhatsAppCloudService();
        
        // Wait a moment for service to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check service status
        const status = whatsappService.getConnectionStatus();
        console.log('✅ Service Status:', {
            isReady: status.isReady,
            connectionState: status.connectionState,
            implementation: status.implementation
        });
        
        if (!status.isReady) {
            console.log('❌ WhatsApp service is not ready. Please check configuration.');
            return;
        }
        
        console.log('\n2. Testing Phone Number Formatting...');
        // Test the phone number formatting
        const originalNumber = TEST_CONFIG.phoneNumber;
        console.log(`📱 Original number: ${originalNumber}`);
        console.log(`📱 Expected format: 237675080477 (Cameroon)`);
        
        console.log('\n3. Testing OTP Template Message...');
        
        // Get template configuration
        const templateConfig = getOtpTemplateConfig(TEST_CONFIG.language);
        console.log(`📋 Using template: ${templateConfig.templateName} (${templateConfig.languageCode})`);
        
        // Prepare template components (same structure as in queue service)
        const components = [
            {
                type: "body",
                parameters: [
                    {
                        type: "text",
                        text: TEST_CONFIG.testOtpCode
                    }
                ]
            },
            {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                    {
                        type: "text",
                        text: TEST_CONFIG.testOtpCode
                    }
                ]
            }
        ];
        
        // Test template message
        console.log('📤 Sending OTP template message...');
        const templateResult = await whatsappService.sendTemplateMessage({
            phoneNumber: TEST_CONFIG.phoneNumber,
            templateName: templateConfig.templateName,
            languageCode: templateConfig.languageCode,
            components: components
        });
        
        if (templateResult.success) {
            console.log('✅ Template message sent successfully!');
            console.log(`📨 Message ID: ${templateResult.messageId}`);
            console.log(`📱 Sent to: ${TEST_CONFIG.phoneNumber}`);
            console.log(`🔢 OTP Code: ${TEST_CONFIG.testOtpCode}`);
        } else {
            console.log('❌ Template message failed:', templateResult.error);
            
            // Fallback to plain text message
            console.log('\n4. Fallback: Testing Plain Text Message...');
            console.log('📤 Sending plain text OTP message...');
            
            const textResult = await whatsappService.sendTextMessageEnhanced({
                phoneNumber: TEST_CONFIG.phoneNumber,
                message: TEST_CONFIG.testMessage
            });
            
            if (textResult.success) {
                console.log('✅ Plain text message sent successfully!');
                console.log(`📨 Message ID: ${textResult.messageId}`);
                console.log(`📱 Sent to: ${TEST_CONFIG.phoneNumber}`);
            } else {
                console.log('❌ Plain text message also failed:', textResult.error);
            }
        }
        
        console.log('\n5. Testing Simple Text Message (Legacy Method)...');
        const legacyResult = await whatsappService.sendTextMessage({
            phoneNumber: TEST_CONFIG.phoneNumber,
            message: `🧪 Legacy Test: Your test code is ${TEST_CONFIG.testOtpCode}. This tests the legacy sendTextMessage method.`
        });
        
        if (legacyResult) {
            console.log('✅ Legacy text message sent successfully!');
        } else {
            console.log('❌ Legacy text message failed');
        }
        
        console.log('\n📋 Test Summary:');
        console.log('================');
        console.log(`📱 Target Number: ${TEST_CONFIG.phoneNumber}`);
        console.log(`🔢 Test OTP: ${TEST_CONFIG.testOtpCode}`);
        console.log(`🌍 Language: ${TEST_CONFIG.language}`);
        console.log(`📋 Template: ${templateConfig.templateName}`);
        console.log(`✅ Template Success: ${templateResult.success}`);
        console.log(`📨 Message ID: ${templateResult.messageId || 'N/A'}`);
        
        if (templateResult.success) {
            console.log('\n🎉 SUCCESS! Check your WhatsApp for the OTP message.');
            console.log('📱 You should receive a message with the verification code.');
        } else {
            console.log('\n⚠️  Template failed, but this might be due to:');
            console.log('   - Template not approved in WhatsApp Business Manager');
            console.log('   - Rate limiting');
            console.log('   - Phone number not registered on WhatsApp');
            console.log('   - Check the error details above');
        }
        
    } catch (error) {
        console.error('💥 Test failed with error:', error);
        console.error('Stack trace:', error.stack);
        
        console.log('\n🔧 Troubleshooting Tips:');
        console.log('1. Check your .env file has correct WhatsApp credentials');
        console.log('2. Verify WhatsApp Business Account is active');
        console.log('3. Ensure templates are approved in WhatsApp Business Manager');
        console.log('4. Check if the phone number is registered on WhatsApp');
        console.log('5. Verify network connectivity');
    }
}

// Additional utility function to test just phone formatting
function testPhoneFormatting() {
    console.log('\n📱 Phone Number Formatting Test:');
    console.log('=================================');
    
    const testNumbers = [
        '237675080477',  // Your number (already formatted)
        '675080477',     // Your number without country code
        '0675080477',    // Your number with leading 0
        '+237 675 080 477', // Your number with formatting
    ];
    
    // We can't directly test the private method, but we can show expected results
    testNumbers.forEach(number => {
        console.log(`${number.padEnd(20)} -> Expected: 237675080477`);
    });
}

// Run the test
console.log('Starting WhatsApp OTP Test...\n');
testPhoneFormatting();
testWhatsAppOTP().catch(console.error);