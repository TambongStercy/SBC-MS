const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Script to test VPS-hosted notification service
async function testVpsService() {
    console.log('🌐 VPS Notification Service Test\n');
    console.log('='.repeat(60));

    // VPS service URLs to try (replace with your actual VPS URL)
    const vpsUrls = [
        'http://your-vps-domain.com:3002',
        'https://your-vps-domain.com:3002',
        'http://your-vps-ip:3002',
        'https://your-vps-ip:3002',
        // Add your actual VPS URLs here
        'http://localhost:3002' // Local fallback for testing
    ];

    console.log('🔍 Testing VPS service endpoints...');

    let workingUrl = null;

    for (const url of vpsUrls) {
        try {
            console.log(`\n🌐 Testing: ${url}`);

            // Test health endpoint
            const healthResponse = await axios.get(`${url}/api/health`, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'VPS-Test-Script'
                }
            });

            console.log(`✅ Health check OK: ${healthResponse.status}`);
            workingUrl = url;
            break;

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.log(`❌ Connection refused`);
            } else if (error.code === 'ENOTFOUND') {
                console.log(`❌ Host not found`);
            } else if (error.code === 'ETIMEDOUT') {
                console.log(`❌ Connection timeout`);
            } else {
                console.log(`❌ Error: ${error.message}`);
            }
        }
    }

    if (!workingUrl) {
        console.log('\n🚨 ISSUE FOUND: Cannot connect to VPS notification service');
        console.log('\n💡 Troubleshooting steps:');
        console.log('1. Check if PM2 process is running: pm2 list');
        console.log('2. Check service logs: pm2 logs notification-service');
        console.log('3. Verify port 3002 is open on VPS firewall');
        console.log('4. Check if service is bound to localhost only');
        console.log('5. Verify VPS IP/domain is correct');
        return;
    }

    // Test WhatsApp status endpoint
    console.log('\n📱 Testing WhatsApp status...');
    try {
        const statusResponse = await axios.get(`${workingUrl}/api/whatsapp/status`, {
            timeout: 5000
        });
        console.log(`✅ WhatsApp status: ${JSON.stringify(statusResponse.data)}`);
    } catch (error) {
        console.log(`❌ WhatsApp status failed: ${error.message}`);
    }

    // Test OTP endpoint with detailed tracking
    console.log('\n🧪 Testing OTP sending with tracking...');
    try {
        const testOtpPayload = {
            userId: "507f1f77bcf86cd799439011",
            recipient: "237675080477", // Your test number
            channel: "whatsapp",
            code: "VPS001",
            expireMinutes: 10,
            userName: "VPS Test"
        };

        console.log('📤 Sending OTP request...');
        const otpResponse = await axios.post(`${workingUrl}/api/notifications/otp`, testOtpPayload, {
            headers: {
                'Authorization': `Bearer ${process.env.SERVICE_SECRET || 'test-token'}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        console.log(`✅ OTP Response: ${JSON.stringify(otpResponse.data)}`);

        if (otpResponse.data.success) {
            console.log('✅ OTP request accepted by VPS service');
            console.log('📋 Check your logs on VPS to see if message was sent');
            console.log('📱 Check if you received the WhatsApp message');
        }

    } catch (error) {
        console.log(`❌ OTP test failed: ${error.response?.data?.message || error.message}`);
        if (error.response?.data) {
            console.log(`   Full response: ${JSON.stringify(error.response.data)}`);
        }
    }

    // Test webhook endpoint
    console.log('\n🔗 Testing webhook endpoint...');
    try {
        const webhookResponse = await axios.get(`${workingUrl}/api/whatsapp/webhook`, {
            params: {
                'hub.mode': 'subscribe',
                'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'test',
                'hub.challenge': 'vps-test-challenge'
            },
            timeout: 5000
        });
        console.log(`✅ Webhook verification: ${webhookResponse.data}`);
    } catch (error) {
        console.log(`❌ Webhook test failed: ${error.message}`);
        console.log('   This could explain why delivery confirmations aren\'t working');
    }

    // Test direct WhatsApp API connectivity from VPS
    console.log('\n🌍 Testing WhatsApp API connectivity from VPS...');
    try {
        const directApiTest = {
            messaging_product: 'whatsapp',
            to: '237675080477',
            type: 'template',
            template: {
                name: 'connexion',
                language: { code: 'en_US' },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: "VPSAPI" }]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: "VPSAPI" }]
                    }
                ]
            }
        };

        // This would need to be called from VPS, not locally
        console.log('⚠️  Note: Direct API test should be run from VPS server');
        console.log('   Command to run on VPS:');
        console.log(`   curl -X POST "https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages" \\`);
        console.log(`        -H "Authorization: Bearer ${process.env.WHATSAPP_ACCESS_TOKEN?.substring(0, 20)}..." \\`);
        console.log(`        -H "Content-Type: application/json" \\`);
        console.log(`        -d '${JSON.stringify(directApiTest)}'`);

    } catch (error) {
        console.log(`❌ API connectivity test error: ${error.message}`);
    }

    // Generate VPS-specific recommendations
    console.log('\n🎯 VPS-Specific Diagnosis');
    console.log('='.repeat(60));

    console.log('📋 Check these on your VPS:');
    console.log('1. PM2 process status: pm2 list');
    console.log('2. Service logs: pm2 logs notification-service');
    console.log('3. Memory/CPU usage: pm2 monit');
    console.log('4. Firewall settings for port 3002');
    console.log('5. Network connectivity to WhatsApp API');

    console.log('\n🔧 Common VPS issues:');
    console.log('• Service bound to localhost only (not accessible externally)');
    console.log('• Firewall blocking WhatsApp API requests');
    console.log('• Memory limits causing PM2 restarts');
    console.log('• Environment variables not set correctly');
    console.log('• Webhook URL not accessible from internet');

    console.log('\n💡 Next steps:');
    console.log('1. SSH to your VPS and run: pm2 logs notification-service | grep WhatsApp');
    console.log('2. Check if retry logic fix was deployed to VPS');
    console.log('3. Verify webhook URL is publicly accessible');
    console.log('4. Test direct WhatsApp API connectivity from VPS');
}

// Helper function to generate VPS diagnostic commands
function generateVpsCommands() {
    console.log('\n📝 VPS Diagnostic Commands');
    console.log('='.repeat(40));
    console.log('# Check PM2 status');
    console.log('pm2 list');
    console.log('');
    console.log('# Check service logs');
    console.log('pm2 logs notification-service --lines 50');
    console.log('');
    console.log('# Check for WhatsApp activity');
    console.log('pm2 logs notification-service | grep "WhatsApp\\|template\\|message ID"');
    console.log('');
    console.log('# Check memory usage');
    console.log('pm2 monit');
    console.log('');
    console.log('# Test WhatsApp API from VPS');
    console.log('curl -s "https://graph.facebook.com/v18.0/me" -H "Authorization: Bearer YOUR_TOKEN"');
    console.log('');
    console.log('# Check webhook accessibility');
    console.log('curl -s "http://localhost:3002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test"');
}

// Run the test
if (require.main === module) {
    testVpsService().then(() => {
        generateVpsCommands();
    }).catch(console.error);
}

module.exports = { testVpsService, generateVpsCommands }; 