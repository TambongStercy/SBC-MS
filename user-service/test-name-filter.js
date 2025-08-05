// Test script to check for users with null/undefined names
const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/sbc_user_dev');

const referralSchema = new mongoose.Schema({
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referralLevel: Number,
    archived: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phoneNumber: String,
    deleted: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false }
});

const Referral = mongoose.model('Referral', referralSchema);
const User = mongoose.model('User', userSchema);

async function testNameFilter() {
    try {
        console.log('=== TESTING NAME FILTER ISSUE ===\n');

        const referrerId = new mongoose.Types.ObjectId('65d07017411f423f597c8ee5');
        
        // Test the exact logic from the service
        console.log('Testing with the exact service logic...\n');

        // Simulate the repository call
        const referralResponse = await Referral.find({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        })
        .populate('referredUser')
        .skip(0) // Page 1
        .limit(10);

        console.log(`Raw referrals fetched: ${referralResponse.length}`);

        // Map the data exactly like the service does
        const referredUsersData = referralResponse.map((ref) => {
            const user = ref.referredUser;
            return {
                _id: user._id,
                name: user?.name ?? 'N/A',
                email: user?.email ?? 'N/A',
                phoneNumber: user?.phoneNumber?.toString() ?? '',
                referralLevel: ref.referralLevel,
                avatar: user?.avatar ?? '',
                avatarId: user?.avatarId ?? '',
                createdAt: ref.createdAt,
            };
        });

        console.log(`After mapping: ${referredUsersData.length}`);

        // Show the mapped data
        console.log('\nMapped data:');
        referredUsersData.forEach((user, index) => {
            console.log(`  ${index + 1}. Name: "${user.name}", Email: "${user.email}"`);
        });

        // Apply the filter like the service does
        const filteredData = referredUsersData.filter((info) => info.name !== 'N/A');
        
        console.log(`\nAfter filtering (name !== 'N/A'): ${filteredData.length}`);

        if (filteredData.length !== referredUsersData.length) {
            console.log('\n🚨 FOUND THE ISSUE! Some users have null/undefined names!');
            
            const removedUsers = referredUsersData.filter((info) => info.name === 'N/A');
            console.log(`Users removed by filter: ${removedUsers.length}`);
            
            console.log('\nUsers that were filtered out:');
            removedUsers.forEach((user, index) => {
                console.log(`  ${index + 1}. ID: ${user._id}, Email: "${user.email}"`);
            });
        } else {
            console.log('\n✅ No users filtered out by name filter');
        }

        // Test page 2 to see if it has different results
        console.log('\n--- Testing Page 2 ---');
        const page2Response = await Referral.find({
            referrer: referrerId,
            referralLevel: 1,
            archived: { $ne: true }
        })
        .populate('referredUser')
        .skip(10) // Page 2
        .limit(10);

        const page2Data = page2Response.map((ref) => {
            const user = ref.referredUser;
            return {
                _id: user._id,
                name: user?.name ?? 'N/A',
                email: user?.email ?? 'N/A',
                phoneNumber: user?.phoneNumber?.toString() ?? '',
                referralLevel: ref.referralLevel,
                avatar: user?.avatar ?? '',
                avatarId: user?.avatarId ?? '',
                createdAt: ref.createdAt,
            };
        }).filter((info) => info.name !== 'N/A');

        console.log(`Page 2 results after filtering: ${page2Data.length}`);

        if (page2Data.length > 0) {
            console.log('\nPage 2 sample data:');
            page2Data.slice(0, 3).forEach((user, index) => {
                console.log(`  ${index + 1}. Name: "${user.name}", Email: "${user.email}"`);
            });
        }

    } catch (error) {
        console.error('Error testing name filter:', error);
    } finally {
        mongoose.connection.close();
    }
}

testNameFilter();