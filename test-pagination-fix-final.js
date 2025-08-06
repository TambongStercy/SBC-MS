// Final test to verify the pagination fix
// This simulates the exact API call that was problematic

const axios = require('axios');

async function testPaginationFix() {
    const baseUrl = 'http://localhost:3001/api'; // Adjust port as needed
    
    console.log('=== TESTING PAGINATION FIX ===\n');
    
    try {
        // Test the problematic scenario: subType=none with pagination
        console.log('Testing: GET /users/get-refered-users?type=direct&page=1&limit=10&subType=none');
        
        const response1 = await axios.get(`${baseUrl}/users/get-refered-users`, {
            params: {
                type: 'direct',
                page: 1,
                limit: 10,
                subType: 'none'
            },
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN' // Replace with actual token
            }
        });
        
        console.log('Page 1 Results:');
        console.log(`- Success: ${response1.data.success}`);
        console.log(`- Total Count: ${response1.data.data.totalCount}`);
        console.log(`- Total Pages: ${response1.data.data.totalPages}`);
        console.log(`- Current Page: ${response1.data.data.page}`);
        console.log(`- Users Returned: ${response1.data.data.referredUsers.length}`);
        
        if (response1.data.data.referredUsers.length > 0) {
            console.log('✅ SUCCESS: Page 1 now returns data!');
            console.log('Sample users:');
            response1.data.data.referredUsers.slice(0, 3).forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.name} (${user.email})`);
            });
        } else if (response1.data.data.totalCount === 0) {
            console.log('✅ SUCCESS: No users match the filter criteria (this is valid)');
        } else {
            console.log('❌ ISSUE: totalCount > 0 but no users returned');
        }
        
        // Test page 2 for comparison
        console.log('\n--- Testing Page 2 ---');
        const response2 = await axios.get(`${baseUrl}/users/get-refered-users`, {
            params: {
                type: 'direct',
                page: 2,
                limit: 10,
                subType: 'none'
            },
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN' // Replace with actual token
            }
        });
        
        console.log(`Page 2 - Total Count: ${response2.data.data.totalCount}`);
        console.log(`Page 2 - Users Returned: ${response2.data.data.referredUsers.length}`);
        
        // Verify consistency
        const countConsistent = response1.data.data.totalCount === response2.data.data.totalCount;
        console.log(`\nCount consistency between pages: ${countConsistent ? '✅ YES' : '❌ NO'}`);
        
    } catch (error) {
        if (error.response) {
            console.error('API Error:', error.response.status, error.response.data);
        } else if (error.code === 'ECONNREFUSED') {
            console.log('⚠️  Service not running. Please start the user service first.');
            console.log('Run: npm run dev (in user-service directory)');
        } else {
            console.error('Error:', error.message);
        }
    }
}

// Also test without subType filter for comparison
async function testWithoutSubType() {
    const baseUrl = 'http://localhost:3001/api';
    
    try {
        console.log('\n--- Testing without subType filter ---');
        const response = await axios.get(`${baseUrl}/users/get-refered-users`, {
            params: {
                type: 'direct',
                page: 1,
                limit: 10
            },
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN' // Replace with actual token
            }
        });
        
        console.log(`Without filter - Total Count: ${response.data.data.totalCount}`);
        console.log(`Without filter - Users Returned: ${response.data.data.referredUsers.length}`);
        
    } catch (error) {
        console.log('Could not test without subType filter:', error.message);
    }
}

console.log('🔧 PAGINATION FIX TEST');
console.log('This test verifies that the subType=none pagination issue is resolved.\n');

testPaginationFix().then(() => {
    return testWithoutSubType();
}).then(() => {
    console.log('\n=== TEST COMPLETE ===');
    console.log('If you see "SUCCESS" messages above, the pagination fix is working!');
}).catch(console.error);