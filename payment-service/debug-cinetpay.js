// Debug script to test CinetPay API directly
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://client.cinetpay.com/v1';

async function debugCinetPayAPI() {
    console.log('🔍 Debugging CinetPay API...\n');

    try {
        // Step 1: Test Authentication
        console.log('1️⃣ Testing Authentication...');
        console.log('API Key:', process.env.CINETPAY_API_KEY ? 'Configured' : 'Missing');
        console.log('Transfer Password:', process.env.CINETPAY_TRANSFER_PASSWORD ? 'Configured' : 'Missing');

        if (!process.env.CINETPAY_API_KEY || !process.env.CINETPAY_TRANSFER_PASSWORD) {
            console.log('❌ Missing CinetPay credentials in .env file');
            return;
        }

        const authParams = new URLSearchParams();
        authParams.append('apikey', process.env.CINETPAY_API_KEY);
        authParams.append('password', process.env.CINETPAY_TRANSFER_PASSWORD);

        const authResponse = await axios.post(`${BASE_URL}/auth/login?lang=fr`, authParams, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        console.log('Auth Response Status:', authResponse.status);
        console.log('Auth Response Data:', JSON.stringify(authResponse.data, null, 2));

        if (authResponse.data.code !== 0) {
            console.log('❌ Authentication failed:', authResponse.data.message);
            return;
        }

        const token = authResponse.data.data.token;
        console.log('✅ Authentication successful');
        console.log('Token:', token.substring(0, 20) + '...');
        console.log();

        // Step 2: Test Balance Check
        console.log('2️⃣ Testing Balance Check...');
        const balanceResponse = await axios.get(`${BASE_URL}/transfer/check/balance?token=${token}&lang=fr`);
        
        console.log('Balance Response Status:', balanceResponse.status);
        console.log('Balance Response Data:', JSON.stringify(balanceResponse.data, null, 2));
        console.log();

        // Step 3: Test Add Contact
        console.log('3️⃣ Testing Add Contact...');
        const testContact = {
            prefix: '237',
            phone: '675080477',
            name: 'Test',
            surname: 'User',
            email: 'test@sbc.com'
        };

        console.log('Test Contact:', JSON.stringify(testContact, null, 2));

        const contactResponse = await axios.post(
            `${BASE_URL}/transfer/contact?token=${token}&lang=fr`,
            `data=${JSON.stringify([testContact])}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        console.log('Contact Response Status:', contactResponse.status);
        console.log('Contact Response Data:', JSON.stringify(contactResponse.data, null, 2));

        if (contactResponse.data.code === 0) {
            console.log('✅ Contact added successfully');
        } else if (contactResponse.data.code === 726) {
            console.log('✅ Contact already exists');
        } else {
            console.log('❌ Failed to add contact:', contactResponse.data.message);
        }

    } catch (error) {
        console.error('💥 Error:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Test phone number formatting
function testPhoneFormatting() {
    console.log('\n📱 Testing Phone Number Formatting...\n');

    const testCases = [
        { phone: '675080477', country: 'CM', expected: '675080477' },
        { phone: '0675080477', country: 'CM', expected: '675080477' },
        { phone: '+237675080477', country: 'CM', expected: '675080477' },
        { phone: '237675080477', country: 'CM', expected: '675080477' },
    ];

    const countryPrefixes = { 'CM': '237' };

    testCases.forEach(testCase => {
        let cleanPhone = testCase.phone.replace(/\D/g, '');
        
        const prefix = countryPrefixes[testCase.country];
        if (cleanPhone.startsWith(prefix)) {
            cleanPhone = cleanPhone.substring(prefix.length);
        }
        
        cleanPhone = cleanPhone.replace(/^0+/, '');
        
        const result = cleanPhone === testCase.expected ? '✅' : '❌';
        console.log(`${result} ${testCase.phone} → ${cleanPhone} (expected: ${testCase.expected})`);
    });
}

// Run tests
if (require.main === module) {
    testPhoneFormatting();
    debugCinetPayAPI();
}

module.exports = { debugCinetPayAPI, testPhoneFormatting };
