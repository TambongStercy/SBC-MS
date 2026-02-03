const mongoose = require('mongoose');

async function checkUserCampaign() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_notifications?authSource=admin');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }), 'campaigns');

    // Get user from sbc_users database
    const userConn = mongoose.createConnection('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_users?authSource=admin');
    const UserModel = userConn.model('User', new mongoose.Schema({}, { strict: false }), 'users');

    const user = await UserModel.findOne({ email: 'rufusherma@gmail.com' });
    if (!user) {
        console.log('User not found');
        await userConn.close();
        await mongoose.disconnect();
        return;
    }

    console.log('User found:', user._id.toString(), user.name);

    // Find recent campaigns for this user
    const campaigns = await Campaign.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

    console.log(`\n=== Recent Campaigns (${campaigns.length}) ===\n`);

    campaigns.forEach((campaign, i) => {
        console.log(`${i+1}. Campaign: ${campaign.name}`);
        console.log(`   Status: ${campaign.status}`);
        console.log(`   Type: ${campaign.type}`);
        console.log(`   Created: ${campaign.createdAt}`);
        console.log(`   Estimated targets: ${campaign.estimatedTargetCount}`);
        console.log(`   Actual targets: ${campaign.actualTargetCount}`);
        console.log(`   Targets enrolled: ${campaign.targetsEnrolled}`);

        if (campaign.targetFilter) {
            console.log('   Filter:');
            console.log(`     - Countries: ${campaign.targetFilter.countries?.join(', ') || 'all'}`);
            console.log(`     - Date range: ${campaign.targetFilter.registrationDateFrom ? new Date(campaign.targetFilter.registrationDateFrom).toISOString().split('T')[0] : 'none'} to ${campaign.targetFilter.registrationDateTo ? new Date(campaign.targetFilter.registrationDateTo).toISOString().split('T')[0] : 'none'}`);
            console.log(`     - Subscription status: ${campaign.targetFilter.subscriptionStatus || 'all'}`);
            console.log(`     - Gender: ${campaign.targetFilter.gender || 'all'}`);
            console.log(`     - Professions: ${campaign.targetFilter.professions?.join(', ') || 'all'}`);
            console.log(`     - Age range: ${campaign.targetFilter.minAge || 'none'} - ${campaign.targetFilter.maxAge || 'none'}`);
            console.log(`     - Exclude current targets: ${campaign.targetFilter.excludeCurrentTargets || false}`);
        }
        console.log('');
    });

    await userConn.close();
    await mongoose.disconnect();
}

checkUserCampaign().catch(console.error);
