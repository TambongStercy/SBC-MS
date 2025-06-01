// Debug script to test user service connection
const axios = require('axios');
require('dotenv').config();

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001/api';
const SERVICE_SECRET = process.env.SERVICE_SECRET || 'sbc_all_services';

async function debugUserService() {
    console.log('🔍 Debugging User Service Connection...\n');

    console.log('⚙️  Configuration:');
    console.log('   User Service URL:', USER_SERVICE_URL);
    console.log('   Service Secret:', SERVICE_SECRET ? 'Configured' : 'Missing');
    console.log();

    try {
        // Test 1: Check if user service is running
        console.log('1️⃣ Testing: User Service Health Check');
        try {
            const healthResponse = await axios.get(`${USER_SERVICE_URL}/health`, {
                timeout: 5000
            });
            console.log('✅ User service is running');
            console.log('   Status:', healthResponse.status);
            console.log('   Response:', healthResponse.data);
        } catch (error) {
            console.log('❌ User service health check failed');
            console.log('   Error:', error.code || error.message);
            if (error.code === 'ECONNREFUSED') {
                console.log('   💡 User service may not be running on port 3001');
            }
        }
        console.log();

        // Test 2: Test service-to-service authentication
        console.log('2️⃣ Testing: Service Authentication');
        try {
            const authTestResponse = await axios.get(`${USER_SERVICE_URL}/users`, {
                headers: {
                    'Authorization': `Bearer ${SERVICE_SECRET}`,
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });
            console.log('✅ Service authentication working');
            console.log('   Status:', authTestResponse.status);
            console.log('   Users found:', authTestResponse.data?.data?.length || 'Unknown');
        } catch (error) {
            console.log('❌ Service authentication failed');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data?.message || error.message);
            if (error.response?.status === 401) {
                console.log('   💡 Check SERVICE_SECRET configuration');
            }
        }
        console.log();

        // Test 3: Test batch-details endpoint (correct internal endpoint)
        console.log('3️⃣ Testing: Batch Details Endpoint (Internal)');
        const testUserId = '65d2b0344a7e2b9efbf6205d'; // The user ID from your test

        try {
            const userResponse = await axios.post(`${USER_SERVICE_URL}/users/internal/batch-details`,
                { userIds: [testUserId] },
                {
                    headers: {
                        'Authorization': `Bearer ${SERVICE_SECRET}`,
                        'X-Service-Name': 'payment-service',
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );
            console.log('✅ User found successfully via batch-details');
            console.log('   Status:', userResponse.status);
            const users = userResponse.data?.data;
            if (users && users.length > 0) {
                const user = users[0];
                console.log('   User ID:', user._id);
                console.log('   User Name:', user.name);
                console.log('   User Email:', user.email);
                console.log('   User Balance:', user.balance);
                console.log('   Momo Number:', user.momoNumber);
                console.log('   Momo Operator:', user.momoOperator);
            } else {
                console.log('   ⚠️  No users returned in response');
            }
        } catch (error) {
            console.log('❌ Batch-details lookup failed');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data?.message || error.message);

            if (error.response?.status === 404) {
                console.log('   💡 Endpoint may not exist - check user service routes');
            } else if (error.response?.status === 401) {
                console.log('   💡 Authentication issue - check SERVICE_SECRET');
            }
        }
        console.log();

        // Test 3b: Test balance endpoint
        console.log('3️⃣b Testing: Balance Endpoint (Internal)');
        try {
            const balanceResponse = await axios.get(`${USER_SERVICE_URL}/users/internal/${testUserId}/balance`, {
                headers: {
                    'Authorization': `Bearer ${SERVICE_SECRET}`,
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });
            console.log('✅ User balance retrieved successfully');
            console.log('   Status:', balanceResponse.status);
            console.log('   Balance:', balanceResponse.data?.data?.balance || balanceResponse.data?.balance);
        } catch (error) {
            console.log('❌ Balance lookup failed');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data?.message || error.message);
        }
        console.log();

        // Test 4: Test alternative endpoints
        console.log('4️⃣ Testing: Alternative User Endpoints');

        const alternativeEndpoints = [
            `${USER_SERVICE_URL}/user/${testUserId}`,
            `${USER_SERVICE_URL}/internal/users/${testUserId}`,
            `${USER_SERVICE_URL}/api/users/${testUserId}`
        ];

        for (const endpoint of alternativeEndpoints) {
            try {
                const response = await axios.get(endpoint, {
                    headers: {
                        'Authorization': `Bearer ${SERVICE_SECRET}`,
                        'X-Service-Name': 'payment-service'
                    },
                    timeout: 3000
                });
                console.log(`✅ Alternative endpoint works: ${endpoint}`);
                console.log('   Status:', response.status);
                break;
            } catch (error) {
                console.log(`❌ ${endpoint} - ${error.response?.status || error.code}`);
            }
        }
        console.log();

        // Test 5: List available endpoints
        console.log('5️⃣ Testing: Available Endpoints Discovery');
        try {
            const rootResponse = await axios.get(USER_SERVICE_URL, {
                headers: {
                    'Authorization': `Bearer ${SERVICE_SECRET}`,
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });
            console.log('✅ Root endpoint accessible');
            console.log('   Response:', JSON.stringify(rootResponse.data, null, 2));
        } catch (error) {
            console.log('❌ Root endpoint failed');
            console.log('   Status:', error.response?.status);
            console.log('   Error:', error.response?.data || error.message);
        }

    } catch (error) {
        console.error('💥 Debug failed:', error.message);
    }

    console.log('\n📋 Troubleshooting Steps:');
    console.log('1. Ensure user service is running: npm start (in user-service directory)');
    console.log('2. Check user service is on port 3001');
    console.log('3. Verify SERVICE_SECRET matches between services');
    console.log('4. Confirm user ID exists in database');
    console.log('5. Check user service API endpoint structure');
}

// Test user service endpoint variations
function testEndpointVariations() {
    console.log('\n🔍 Common User Service Endpoint Patterns:\n');

    const patterns = [
        '/api/users/:id',
        '/users/:id',
        '/user/:id',
        '/internal/users/:id',
        '/v1/users/:id'
    ];

    patterns.forEach(pattern => {
        console.log(`   ${pattern.replace(':id', testUserId)}`);
    });

    console.log('\n💡 If none work, check the user service documentation or routes file.');
}

// Run debug
if (require.main === module) {
    const testUserId = '65d2b0344a7e2b9efbf6205d';
    debugUserService()
        .then(() => {
            testEndpointVariations();
        })
        .catch(console.error);
}

module.exports = { debugUserService };
