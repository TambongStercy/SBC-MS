#!/usr/bin/env node

/**
 * Email Notification Diagnostic Script
 * 
 * This script helps diagnose why some users are not receiving email notifications.
 * Run this to check the health of your notification infrastructure.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 SBC Email Notification Diagnostic Tool\n');

// Check 1: Environment Variables
console.log('📋 1. Checking Environment Variables...');
const requiredEnvVars = [
    'EMAIL_SERVICE',
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'EMAIL_FROM',
    'REDIS_HOST',
    'REDIS_PORT'
];

const envPath = path.join(__dirname, '.env');
let envVars = {};

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        if (line.includes('=') && !line.startsWith('#')) {
            const [key, value] = line.split('=');
            envVars[key.trim()] = value.trim();
        }
    });
    console.log('   ✅ .env file found');
} else {
    console.log('   ⚠️  .env file not found');
}

let envIssues = [];
requiredEnvVars.forEach(varName => {
    if (envVars[varName]) {
        console.log(`   ✅ ${varName}: ${varName.includes('PASSWORD') ? '***' : envVars[varName]}`);
    } else {
        console.log(`   ❌ ${varName}: Missing`);
        envIssues.push(varName);
    }
});

// Check 2: Redis Connection
console.log('\n🔴 2. Checking Redis Connection...');
try {
    const { exec } = require('child_process');
    exec('redis-cli ping', (error, stdout, stderr) => {
        if (error) {
            console.log('   ❌ Redis is not running or not accessible');
            console.log('   💡 Solution: Start Redis with `redis-server` or check Redis configuration');
        } else if (stdout.trim() === 'PONG') {
            console.log('   ✅ Redis is running and responding');
        } else {
            console.log('   ⚠️  Redis responded but with unexpected output:', stdout);
        }
        continueChecks();
    });
} catch (err) {
    console.log('   ⚠️  Could not check Redis (redis-cli not found)');
    continueChecks();
}

function continueChecks() {
    // Check 3: Node Dependencies
    console.log('\n📦 3. Checking Node Dependencies...');
    const packagePath = path.join(__dirname, 'package.json');
    if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        const requiredDeps = ['bull', 'redis', 'nodemailer'];

        requiredDeps.forEach(dep => {
            if (packageJson.dependencies[dep]) {
                console.log(`   ✅ ${dep}: ${packageJson.dependencies[dep]}`);
            } else {
                console.log(`   ❌ ${dep}: Missing`);
            }
        });
    }

    // Check 4: Service Health
    console.log('\n🏥 4. Checking Service Health...');

    const http = require('http');
    const port = envVars.PORT || 3002;

    const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/health',
        method: 'GET'
    }, (res) => {
        if (res.statusCode === 200) {
            console.log(`   ✅ Notification service is running on port ${port}`);
        } else {
            console.log(`   ⚠️  Service responded with status ${res.statusCode}`);
        }
        printSummary();
    });

    req.on('error', (err) => {
        console.log(`   ❌ Notification service is not running on port ${port}`);
        console.log('   💡 Solution: Start the service with `npm run dev` or `npm start`');
        printSummary();
    });

    req.end();
}

function printSummary() {
    console.log('\n📊 DIAGNOSTIC SUMMARY\n');

    if (envIssues.length > 0) {
        console.log('❌ CRITICAL ISSUES FOUND:');
        console.log('   Missing environment variables:', envIssues.join(', '));
        console.log('   💡 Add these to your .env file\n');
    }

    console.log('🔧 TROUBLESHOOTING STEPS:\n');

    console.log('1. If Redis issues:');
    console.log('   • Start Redis: `redis-server`');
    console.log('   • Or use Docker: `docker run -d -p 6379:6379 redis:alpine`\n');

    console.log('2. If email configuration issues:');
    console.log('   • For Gmail: Use App Password, not regular password');
    console.log('   • For other providers: Check SMTP settings');
    console.log('   • Test with: EMAIL_SERVICE=gmail EMAIL_USER=your@gmail.com\n');

    console.log('3. Check notification logs:');
    console.log('   • Look in notification-service/logs/ directory');
    console.log('   • Search for: "Failed to queue notification" or "Redis connection failed"\n');

    console.log('4. Monitor queue status:');
    console.log('   • GET /api/notifications/queue/stats');
    console.log('   • Check for stuck or failed jobs\n');

    console.log('5. Database check:');
    console.log('   • Query notifications collection for PENDING status');
    console.log('   • Look for notifications that never got processed\n');

    console.log('💡 If issues persist, check the server logs when users try "forgot password"');
} 