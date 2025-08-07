/**
 * Simple Email Testing Script
 * Direct implementation without TypeScript dependencies
 * Tests email delivery to verify which users are receiving emails
 */

const readline = require('readline');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Setup readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Test counter and results tracking
let testCount = 0;
const testResults = [];

// Email transporter (will be initialized based on config)
let transporter = null;
let isEmailConfigured = false;

// Email validation function
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Initialize email transporter
function initializeEmailTransporter() {
    try {
        const emailService = process.env.EMAIL_SERVICE;
        const emailUser = process.env.EMAIL_USER;
        const emailPassword = process.env.EMAIL_PASSWORD;

        if (!emailService || !emailUser || !emailPassword) {
            console.log('⚠️  Email configuration incomplete. Will run in development mode.');
            isEmailConfigured = false;
            return;
        }

        let transportConfig;

        // Check if the service is SendGrid
        if (emailService.toLowerCase() === 'sendgrid') {
            transportConfig = {
                service: 'SendGrid',
                auth: {
                    user: emailUser, // Should be 'apikey' for SendGrid
                    pass: emailPassword,
                }
            };
        } else if (emailService.toLowerCase() === 'gmail') {
            transportConfig = {
                service: 'gmail',
                auth: {
                    user: emailUser,
                    pass: emailPassword,
                }
            };
        } else {
            // Generic SMTP
            transportConfig = {
                host: emailService,
                port: 465,
                secure: true,
                auth: {
                    user: emailUser,
                    pass: emailPassword,
                }
            };
        }

        transporter = nodemailer.createTransporter(transportConfig);
        isEmailConfigured = true;
        console.log('✅ Email transporter initialized successfully');

    } catch (error) {
        console.log('❌ Failed to initialize email transporter:', error.message);
        isEmailConfigured = false;
    }
}

// Function to send test email
async function sendTestEmail(email) {
    const timestamp = new Date().toISOString();

    // If not configured, simulate sending in dev mode
    if (!isEmailConfigured) {
        console.log('\n📧 DEV MODE - Email would be sent with these details:');
        console.log(`To: ${email}`);
        console.log(`Subject: 🧪 SBC Email Delivery Test #${testCount}`);
        console.log(`Timestamp: ${new Date().toLocaleString()}`);
        console.log('Body: Test email to verify delivery...');
        console.log('✅ Simulated send successful (development mode)\n');

        return {
            success: true,
            timestamp: timestamp,
            mode: 'development'
        };
    }

    try {
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'Sniper Business Center <noreply@sniperbuisnesscenter.com>',
            to: email,
            subject: `🧪 SBC Email Delivery Test #${testCount}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #2c3e50; text-align: center; margin-bottom: 30px;">
                            🧪 Email Delivery Test
                        </h2>
                        
                        <div style="background-color: #e8f4fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #2980b9; margin: 0 0 10px 0;">Test Details:</h3>
                            <p style="margin: 5px 0;"><strong>Test Number:</strong> #${testCount}</p>
                            <p style="margin: 5px 0;"><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                            <p style="margin: 5px 0;"><strong>Email Service:</strong> SBC Notification System</p>
                            <p style="margin: 5px 0;"><strong>Recipient:</strong> ${email}</p>
                        </div>
                        
                        <div style="background-color: #d5f4e6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #27ae60; margin: 0 0 10px 0;">✅ Success!</h3>
                            <p style="margin: 0; color: #2c3e50;">
                                If you're reading this email, it means the SBC email delivery system is working correctly for your email address.
                            </p>
                        </div>
                        
                        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #f39c12; margin: 0 0 10px 0;">📝 Next Steps</h3>
                            <p style="margin: 0; color: #2c3e50;">
                                Please confirm receipt of this email to help verify email delivery reliability.
                                You can also check if this email went to your spam/junk folder.
                            </p>
                        </div>
                        
                        <div style="background-color: #ffeaa7; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                            <h4 style="color: #e17055; margin: 0 0 10px 0;">🔍 For Troubleshooting:</h4>
                            <ul style="margin: 10px 0; padding-left: 20px; color: #2c3e50;">
                                <li>Check your spam/junk folder</li>
                                <li>Add our email address to your safe senders list</li>
                                <li>Verify this email address is correct: ${email}</li>
                                <li>Some email providers have stricter filtering</li>
                            </ul>
                        </div>
                        
                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                        
                        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
                            <p><strong>Sniper Business Center</strong></p>
                            <p>Email Delivery Verification System</p>
                            <p>This is an automated test message</p>
                            <p>Time: ${new Date().toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            `,
            text: `
SBC Email Delivery Test #${testCount}

Test Details:
- Test Number: #${testCount}
- Timestamp: ${new Date().toLocaleString()}
- Email Service: SBC Notification System
- Recipient: ${email}

✅ Success!
If you're reading this email, it means the SBC email delivery system is working correctly for your email address.

📝 Next Steps
Please confirm receipt of this email to help verify email delivery reliability.
You can also check if this email went to your spam/junk folder.

🔍 For Troubleshooting:
• Check your spam/junk folder
• Add our email address to your safe senders list
• Verify this email address is correct: ${email}
• Some email providers have stricter filtering

---
Sniper Business Center
Email Delivery Verification System
This is an automated test message
Time: ${new Date().toLocaleString()}
            `
        };

        const info = await transporter.sendMail(mailOptions);

        return {
            success: true,
            timestamp: timestamp,
            messageId: info.messageId,
            mode: 'production'
        };

    } catch (error) {
        return {
            success: false,
            timestamp: timestamp,
            error: error.message,
            mode: 'production'
        };
    }
}

// Function to display current email configuration
function displayEmailConfig() {
    console.log('\n📧 Current Email Configuration:');
    console.log('================================');
    console.log(`Service: ${process.env.EMAIL_SERVICE || 'Not configured'}`);
    console.log(`User: ${process.env.EMAIL_USER || 'Not configured'}`);
    console.log(`From: ${process.env.EMAIL_FROM || 'Default SBC address'}`);
    console.log(`Password: ${process.env.EMAIL_PASSWORD ? '***configured***' : 'Not configured'}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Configured: ${isEmailConfigured ? '✅ Yes' : '❌ No'}`);

    if (!isEmailConfigured) {
        console.log('\n⚠️  EMAIL NOT CONFIGURED: Running in development mode');
        console.log('   Emails will be logged instead of actually sent');
        console.log('   Configure EMAIL_SERVICE, EMAIL_USER, and EMAIL_PASSWORD in .env');
    }

    console.log('');
}

// Function to display test results summary
function displayResults() {
    if (testResults.length === 0) {
        console.log('\n📊 No tests performed yet.\n');
        return;
    }

    console.log('\n📊 Test Results Summary:');
    console.log('========================');

    const successful = testResults.filter(r => r.success).length;
    const failed = testResults.length - successful;
    const devMode = testResults.filter(r => r.mode === 'development').length;

    console.log(`Total tests: ${testResults.length}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🔧 Dev mode: ${devMode}`);
    if (testResults.length > 0) {
        console.log(`📈 Success rate: ${((successful / testResults.length) * 100).toFixed(1)}%`);
    }
    console.log('');

    console.log('Individual Results:');
    testResults.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const mode = result.mode === 'development' ? ' (dev)' : '';
        const time = new Date(result.timestamp).toLocaleTimeString();
        console.log(`${status} ${result.email} (${time})${mode}${result.error ? ` - ${result.error}` : ''}`);
    });
    console.log('');
}

// Main interactive function
async function startEmailTesting() {
    console.log('🧪 SBC Simple Email Delivery Tester');
    console.log('====================================');
    console.log('This script will help you test email delivery to specific addresses.');
    console.log('Press Ctrl+C at any time to exit.\n');

    // Initialize email transporter
    initializeEmailTransporter();
    displayEmailConfig();

    console.log('Available commands:');
    console.log('• Enter an email address to send a test email');
    console.log('• Type "results" to see test summary');
    console.log('• Type "config" to see email configuration');
    console.log('• Type "exit" or press Ctrl+C to quit\n');

    // Main interaction loop
    const askForEmail = () => {
        rl.question('📧 Enter email address (or command): ', async (input) => {
            const trimmedInput = input.trim().toLowerCase();

            // Handle special commands
            if (trimmedInput === 'exit' || trimmedInput === 'quit') {
                console.log('\n👋 Goodbye! Email testing session ended.');
                displayResults();
                rl.close();
                return;
            }

            if (trimmedInput === 'results') {
                displayResults();
                askForEmail();
                return;
            }

            if (trimmedInput === 'config') {
                displayEmailConfig();
                askForEmail();
                return;
            }

            if (trimmedInput === 'help') {
                console.log('\nAvailable commands:');
                console.log('• Enter an email address to send a test email');
                console.log('• Type "results" to see test summary');
                console.log('• Type "config" to see email configuration');
                console.log('• Type "exit" or press Ctrl+C to quit\n');
                askForEmail();
                return;
            }

            // Validate email address
            if (!isValidEmail(input.trim())) {
                console.log('❌ Invalid email format. Please enter a valid email address.\n');
                askForEmail();
                return;
            }

            const email = input.trim();
            testCount++;

            console.log(`\n🚀 Sending test email #${testCount} to: ${email}`);
            console.log('⏳ Please wait...');

            try {
                const result = await sendTestEmail(email);

                // Store result
                const testResult = {
                    email: email,
                    success: result.success,
                    timestamp: result.timestamp,
                    error: result.error || null,
                    mode: result.mode || 'unknown',
                    messageId: result.messageId || null
                };
                testResults.push(testResult);

                if (result.success) {
                    if (result.mode === 'development') {
                        console.log('✅ Email simulation completed (development mode)!');
                        console.log('📝 In production, this would be sent to the recipient.');
                    } else {
                        console.log('✅ Email sent successfully!');
                        console.log('📬 Please check the recipient\'s inbox (and spam folder).');
                        if (result.messageId) {
                            console.log(`📧 Message ID: ${result.messageId}`);
                        }
                    }
                } else {
                    console.log('❌ Email failed to send.');
                    if (result.error) {
                        console.log(`🔍 Error: ${result.error}`);
                    }
                }

            } catch (error) {
                console.log('❌ Unexpected error occurred:');
                console.log(`🔍 ${error.message}`);

                // Store failed result
                testResults.push({
                    email: email,
                    success: false,
                    timestamp: new Date().toISOString(),
                    error: error.message,
                    mode: 'unknown'
                });
            }

            console.log('\n' + '='.repeat(50));
            askForEmail();
        });
    };

    askForEmail();
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n\n👋 Email testing session ended.');
    displayResults();
    process.exit(0);
});

// Start the testing
startEmailTesting();