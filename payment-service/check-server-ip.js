#!/usr/bin/env node

/**
 * Script to check server's public IP address for FeexPay whitelisting
 * Run this script on your server to get the IP that needs to be whitelisted
 */

const https = require('https');
const http = require('http');

console.log('🔍 Checking server public IP addresses for FeexPay whitelisting...\n');

// Multiple IP detection services for reliability
const ipServices = [
    { name: 'ipify', url: 'https://api.ipify.org?format=json', parse: (data) => JSON.parse(data).ip },
    { name: 'ipinfo', url: 'https://ipinfo.io/ip', parse: (data) => data.trim() },
    { name: 'httpbin', url: 'https://httpbin.org/ip', parse: (data) => JSON.parse(data).origin },
    { name: 'ifconfig.me', url: 'https://ifconfig.me/ip', parse: (data) => data.trim() }
];

async function checkIP(service) {
    return new Promise((resolve) => {
        const client = service.url.startsWith('https') ? https : http;
        const request = client.get(service.url, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                try {
                    const ip = service.parse(data);
                    resolve({ service: service.name, ip, success: true });
                } catch (error) {
                    resolve({ service: service.name, error: error.message, success: false });
                }
            });
        });
        
        request.on('error', (error) => {
            resolve({ service: service.name, error: error.message, success: false });
        });
        
        request.setTimeout(5000, () => {
            request.abort();
            resolve({ service: service.name, error: 'Timeout', success: false });
        });
    });
}

async function main() {
    console.log('📡 Detecting public IP addresses...\n');
    
    const results = await Promise.all(ipServices.map(checkIP));
    const successfulResults = results.filter(r => r.success);
    const uniqueIPs = [...new Set(successfulResults.map(r => r.ip))];
    
    // Display results
    results.forEach(result => {
        if (result.success) {
            console.log(`✅ ${result.service.padEnd(12)}: ${result.ip}`);
        } else {
            console.log(`❌ ${result.service.padEnd(12)}: ${result.error}`);
        }
    });
    
    console.log('\n📋 SUMMARY:');
    console.log('==========================================');
    
    if (uniqueIPs.length === 0) {
        console.log('❌ Could not detect any public IP addresses');
        console.log('💡 Try running this script directly on your server');
        return;
    }
    
    if (uniqueIPs.length === 1) {
        console.log(`✅ Server Public IP: ${uniqueIPs[0]}`);
    } else {
        console.log('⚠️  Multiple IPs detected (possible load balancer/proxy):');
        uniqueIPs.forEach((ip, index) => {
            console.log(`   ${index + 1}. ${ip}`);
        });
    }
    
    console.log('\n🔧 NEXT STEPS:');
    console.log('==========================================');
    console.log('1. Contact FeexPay support with these IP addresses:');
    console.log('   📧 Email: support@feexpay.me');
    console.log('   📞 WhatsApp: +228 XX XX XX XX (check their docs)');
    console.log('');
    console.log('2. Request to whitelist these IPs for your account:');
    uniqueIPs.forEach((ip, index) => {
        console.log(`   • ${ip}`);
    });
    console.log('');
    console.log('3. Include your FeexPay Shop ID in the request:');
    console.log(`   • Shop ID: ${process.env.FEEXPAY_SHOP_ID || '[Your FeexPay Shop ID]'}`);
    console.log('');
    console.log('4. Mention this is for payout API access');
    console.log('');
    
    // Check if running on common cloud platforms
    console.log('🌐 CLOUD PLATFORM NOTES:');
    console.log('==========================================');
    if (process.env.AWS_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        console.log('☁️  AWS detected - Consider using NAT Gateway for consistent IP');
    }
    if (process.env.GOOGLE_CLOUD_PROJECT) {
        console.log('☁️  Google Cloud detected - Consider using Cloud NAT');
    }
    if (process.env.AZURE_CLIENT_ID) {
        console.log('☁️  Azure detected - Consider using NAT Gateway');
    }
    if (process.env.HEROKU_APP_NAME) {
        console.log('☁️  Heroku detected - IP may change with dyno restarts');
        console.log('   💡 Consider upgrading to Static IP add-on');
    }
    if (process.env.VERCEL_ENV) {
        console.log('☁️  Vercel detected - Use Vercel Pro for static IP');
    }
    
    console.log('\n⏱️  IP addresses may change if using shared hosting or certain cloud services');
    console.log('💡 Consider setting up a static IP or NAT gateway for production');
}

main().catch(console.error); 