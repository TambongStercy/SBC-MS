const mongoose = require('mongoose');

async function checkAllCampaigns() {
    await mongoose.connect('mongodb://stercytambong:w23N0S5Qb6kMUwTi@localhost:27018/sbc_notifications?authSource=admin');

    const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, { strict: false }), 'campaigns');
    const RelanceTarget = mongoose.model('RelanceTarget', new mongoose.Schema({}, { strict: false }), 'relancetargets');

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

    console.log('User ID:', user._id.toString());

    // Count all campaigns
    const totalCampaigns = await Campaign.countDocuments();
    console.log(`\nTotal campaigns in database: ${totalCampaigns}`);

    // Find campaigns for this specific user
    const userCampaigns = await Campaign.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean();
    console.log(`Campaigns for this user: ${userCampaigns.length}`);

    if (userCampaigns.length > 0) {
        console.log('\n=== User Campaigns ===');
        userCampaigns.forEach((c, i) => {
            console.log(`\n${i+1}. ${c.name} (${c.status})`);
            console.log(`   Created: ${c.createdAt}`);
            console.log(`   Estimated: ${c.estimatedTargetCount}, Enrolled: ${c.targetsEnrolled}`);
            if (c.targetFilter) {
                console.log(`   Filter: ${JSON.stringify(c.targetFilter, null, 2)}`);
            }
        });
    }

    // Check relance targets for this user
    const targets = await RelanceTarget.find({ referrerUserId: user._id }).limit(10).lean();
    console.log(`\n\nRelance targets for this user: ${targets.length}`);

    if (targets.length > 0) {
        console.log('\n=== Sample Relance Targets ===');
        targets.slice(0, 5).forEach((t, i) => {
            console.log(`${i+1}. Status: ${t.status}, Campaign: ${t.campaignId || 'default'}, Day: ${t.currentDay}/${t.totalDays}`);
        });
    }

    // Count targets by campaign
    const targetsByCampaign = await RelanceTarget.aggregate([
        { $match: { referrerUserId: user._id } },
        { $group: { _id: '$campaignId', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]);

    console.log('\n=== Targets by Campaign ===');
    targetsByCampaign.forEach(g => {
        console.log(`Campaign ${g._id || 'default'}: ${g.count} targets`);
    });

    await userConn.close();
    await mongoose.disconnect();
}

checkAllCampaigns().catch(console.error);
