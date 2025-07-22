const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Test script to verify dual WhatsApp OTP message functionality
async function testOtpWhatsapp() {
    const baseUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api';
    
    // Test data for OTP verification
    const testData = {
        userId: "507f1f77bcf86cd799439011", // Test ObjectId
        recipient: "+237675080477", // Test phone number  
        channel: "whatsapp",
        code: "123456",
        expireMinutes: 10,
        isRegistration: true,
        userName: "Test User",
        purpose: "registration"
    };

    try {
        console.log('🧪 Testing dual WhatsApp OTP message...');
        console.log('📱 Test Data:', testData);
        
        const response = await axios.post(`${baseUrl}/notifications/otp`, testData, {
            headers: {
                'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Response:', response.data);
        
        if (response.data.success) {
            console.log('🎉 Test completed successfully!');
            console.log('📋 Expected behavior:');
            console.log('   1. First message: Welcome message with user info');
            console.log('   2. Second message: *123456* (bold OTP code)');
        } else {
            console.log('❌ Test failed:', response.data.message);
        }
        
    } catch (error) {
        console.error('❌ Test error:', error.response?.data || error.message);
    }
}

// Test different OTP purposes
async function testAllOtpTypes() {
    const baseUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002/api';
    
    const testCases = [
        {
            name: 'Registration OTP',
            data: {
                userId: "507f1f77bcf86cd799439011",
                recipient: "+237675080477",
                channel: "whatsapp", 
                code: "123456",
                expireMinutes: 10,
                isRegistration: true,
                userName: "Test User"
            }
        },
        {
            name: 'Login OTP', 
            data: {
                userId: "507f1f77bcf86cd799439011",
                recipient: "+237675080477",
                channel: "whatsapp",
                code: "654321", 
                expireMinutes: 10,
                isRegistration: false
            }
        },
        {
            name: 'Withdrawal Verification OTP',
            data: {
                userId: "507f1f77bcf86cd799439011", 
                recipient: "+237675080477",
                channel: "whatsapp",
                code: "789012",
                expireMinutes: 10,
                isRegistration: false,
                userName: "Test User",
                purpose: "withdrawal_verification"
            }
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🧪 Testing ${testCase.name}...`);
        
        try {
            const response = await axios.post(`${baseUrl}/notifications/otp`, testCase.data, {
                headers: {
                    'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data.success) {
                console.log(`✅ ${testCase.name} test passed`);
            } else {
                console.log(`❌ ${testCase.name} test failed:`, response.data.message);
            }
            
        } catch (error) {
            console.error(`❌ ${testCase.name} test error:`, error.response?.data || error.message);
        }
        
        // Wait 1 second between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Run the tests
console.log('🚀 Starting OTP WhatsApp dual message tests...\n');

if (process.argv.includes('--all')) {
    testAllOtpTypes();
} else {
    testOtpWhatsapp();
} 