const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Script to check WhatsApp messaging limits and current usage
async function checkMessagingLimits() {
    console.log('📊 WhatsApp Messaging Limits Checker\n');
    console.log('='.repeat(60));

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !phoneNumberId || !businessAccountId) {
        console.log('❌ Missing environment variables:');
        console.log('  WHATSAPP_ACCESS_TOKEN:', accessToken ? '✅ Set' : '❌ Missing');
        console.log('  WHATSAPP_PHONE_NUMBER_ID:', phoneNumberId ? '✅ Set' : '❌ Missing');
        console.log('  WHATSAPP_BUSINESS_ACCOUNT_ID:', businessAccountId ? '✅ Set' : '❌ Missing');
        return;
    }

    try {
        // 1. Check phone number messaging limit
        console.log('1️⃣  CHECKING PHONE NUMBER MESSAGING LIMIT');
        console.log('─'.repeat(50));

        const phoneResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${phoneNumberId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    fields: 'id,display_phone_number,verified_name,quality_rating,messaging_limit,name_status,status'
                }
            }
        );

        console.log('📱 Phone Number Details:');
        console.log(`   Number: ${phoneResponse.data.display_phone_number}`);
        console.log(`   Status: ${phoneResponse.data.status}`);
        console.log(`   Quality Rating: ${phoneResponse.data.quality_rating}`);
        console.log(`   Messaging Limit: ${phoneResponse.data.messaging_limit || 'Not specified in response'}`);
        console.log(`   Name Status: ${phoneResponse.data.name_status}`);
        console.log('');

        // 2. Check business account details  
        console.log('2️⃣  CHECKING BUSINESS ACCOUNT DETAILS');
        console.log('─'.repeat(50));

        const businessResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${businessAccountId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    fields: 'id,name,account_review_status,business_verification_status,messaging_api_rate_limit'
                }
            }
        );

        console.log('🏢 Business Account Details:');
        console.log(`   Account ID: ${businessResponse.data.id}`);
        console.log(`   Name: ${businessResponse.data.name}`);
        console.log(`   Review Status: ${businessResponse.data.account_review_status}`);
        console.log(`   Verification Status: ${businessResponse.data.business_verification_status}`);
        console.log('');

        // 3. Get analytics to understand current usage
        console.log('3️⃣  CHECKING RECENT ANALYTICS');
        console.log('─'.repeat(50));

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7); // Last 7 days

        try {
            const analyticsResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${businessAccountId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    params: {
                        fields: `analytics.start(${Math.floor(startDate.getTime() / 1000)}).end(${Math.floor(endDate.getTime() / 1000)}).granularity(DAY)`
                    }
                }
            );

            console.log('📈 Recent Analytics:');
            if (analyticsResponse.data.analytics && analyticsResponse.data.analytics.data) {
                analyticsResponse.data.analytics.data.forEach(day => {
                    console.log(`   ${new Date(day.start * 1000).toLocaleDateString()}: ${JSON.stringify(day.data_points)}`);
                });
            } else {
                console.log('   No analytics data available');
            }
        } catch (analyticsError) {
            console.log('   ⚠️  Analytics not available:', analyticsError.response?.data?.error?.message || analyticsError.message);
        }

        console.log('');

        // 4. Messaging limit analysis
        console.log('4️⃣  MESSAGING LIMIT ANALYSIS');
        console.log('─'.repeat(50));

        const qualityRating = phoneResponse.data.quality_rating;
        const messagingLimit = phoneResponse.data.messaging_limit;

        console.log('📋 Current Status:');
        if (messagingLimit) {
            console.log(`   ✅ Current Limit: ${messagingLimit} messages/day to unique numbers`);
        } else {
            console.log('   ⚠️  Messaging limit not returned in API response');
            console.log('   💡 Default for new numbers: 250 messages/day');
        }

        console.log(`   📊 Quality Rating: ${qualityRating}`);

        if (qualityRating === 'HIGH') {
            console.log('   ✅ High quality - eligible for limit increases');
        } else if (qualityRating === 'MEDIUM') {
            console.log('   ⚠️  Medium quality - may limit scaling');
        } else if (qualityRating === 'LOW') {
            console.log('   ❌ Low quality - limit may be reduced');
        }

        console.log('');
        console.log('5️⃣  LIMIT UPGRADE PATH');
        console.log('─'.repeat(50));
        console.log('To increase messaging limits:');
        console.log('   1. Maintain HIGH or MEDIUM quality rating');
        console.log('   2. Send messages to 50% of current limit in 7 days');
        console.log('   3. Business verification can help');
        console.log('   4. Send high-quality, opt-in messages only');
        console.log('');

        // 5. Recommendations based on findings
        console.log('6️⃣  RECOMMENDATIONS');
        console.log('─'.repeat(50));

        if (qualityRating === 'LOW') {
            console.log('🚨 URGENT: Low quality rating detected!');
            console.log('   • Reduce message frequency immediately');
            console.log('   • Only send to users who explicitly opted in');
            console.log('   • Avoid promotional content temporarily');
            console.log('   • Focus on utility messages (OTPs, confirmations)');
        } else {
            console.log('✅ Quality rating looks good');
            console.log('   • Continue sending high-quality messages');
            console.log('   • Focus on user engagement');
            console.log('   • Ensure proper opt-ins');
        }

        if (!messagingLimit || messagingLimit <= 250) {
            console.log('');
            console.log('📈 TO INCREASE LIMITS:');
            console.log('   • Complete business verification');
            console.log('   • Send messages to 125+ unique numbers in 7 days (50% of 250)');
            console.log('   • Maintain message quality');
            console.log('   • Ensure users engage positively');
        }

    } catch (error) {
        console.log('❌ Error checking messaging limits:', error.response?.data || error.message);
        console.log('');
        console.log('💡 Manual Check Options:');
        console.log('1. WhatsApp Manager → Account Tools → Phone Numbers');
        console.log('2. WhatsApp Manager → Overview → Limits');
        console.log('3. Check for "messaging limit" notifications');
    }

    // 6. Daily usage tracking recommendations
    console.log('');
    console.log('7️⃣  DAILY USAGE TRACKING');
    console.log('─'.repeat(50));
    console.log('Monitor your daily template message usage:');
    console.log('• Track unique recipients (not total messages)');
    console.log('• Only template messages outside service windows count');
    console.log('• Service conversations (customer-initiated) are FREE');
    console.log('• Multiple messages to same user = 1 count');
    console.log('');
    console.log('🔍 Signs you hit the limit:');
    console.log('• Messages get queued/delayed');
    console.log('• Error responses about messaging limits');
    console.log('• Users report not receiving messages');
    console.log('• API returns limit-related errors');
}

// Helper function to check recent message sends
async function checkRecentMessageActivity() {
    console.log('\n📱 RECENT MESSAGE ACTIVITY CHECK');
    console.log('='.repeat(60));
    console.log('Check your application logs for:');
    console.log('');
    console.log('1. Number of unique recipients today:');
    console.log('   grep "$(date +%Y-%m-%d)" logs/whatsapp.log | grep "template.*sent" | cut -d"to" -f2 | sort -u | wc -l');
    console.log('');
    console.log('2. Total template messages sent today:');
    console.log('   grep "$(date +%Y-%m-%d)" logs/whatsapp.log | grep "template.*sent" | wc -l');
    console.log('');
    console.log('3. Look for rate limit errors:');
    console.log('   grep "rate limit\\|messaging limit\\|limit exceeded" logs/whatsapp.log');
    console.log('');
    console.log('4. Check message failures:');
    console.log('   grep "$(date +%Y-%m-%d)" logs/whatsapp.log | grep "failed\\|error" | tail -10');
}

if (require.main === module) {
    checkMessagingLimits().then(() => {
        checkRecentMessageActivity();
    }).catch(console.error);
}

module.exports = { checkMessagingLimits, checkRecentMessageActivity }; 