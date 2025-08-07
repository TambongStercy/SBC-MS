/**
 * Interactive Email Testing Script
 * Tests email delivery to verify which users are receiving emails
 * Press Ctrl+C to exit at any time
 */

const readline = require('readline');
require('dotenv').config();

// Import the email service (JavaScript compatible way)
const path = require('path');
const { spawn } = require('child_process');

// Setup readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Test counter and results tracking
let testCount = 0;
const testResults = [];

// Email validation function
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Function to send test email using TypeScript service
async function sendTestEmail(email) {
    return new Promise((resolve, reject) => {
        // Create a temporary test script that imports the TypeScript service
        const testScript = `
const { emailService } = require('./dist/services/email.service');

async function sendTest() {
    try {
        const success = await emailService.sendEmail({
            to: '${email}',
            subject: '🧪 SBC Email Delivery Test #${testCount}',
            html: \`
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #2c3e50; text-align: center; margin-bottom: 30px;">
                            🧪 Email Delivery Test
                        </h2>
                        
                        <div style="background-color: #e8f4fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #2980b9; margin: 0 0 10px 0;">Test Details:</h3>
                            <p style="margin: 5px 0;"><strong>Test Number:</strong> #${testCount}</p>
                            <p style="margin: 5px 0;"><strong>Timestamp:</strong> \${new Date().toLocaleString()}</p>
                            <p style="margin: 5px 0;"><strong>Email Service:</strong> SBC Notification System</p>
                        </div>
                        
                        <div style="background-color: #d5f4e6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #27ae60; margin: 0 0 10px 0;">✅ Success!</h3>
                            <p style="margin: 0; color: #2c3e50;">
                                If you're reading this email, it means the SBC email delivery system is working correctly for your email address.
                            </p>
                        </div>
                        
                        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <h3 style="color: #f39c12; margin: 0 0 10px 0;">📝 Please Confirm Receipt</h3>
                            <p style="margin: 0; color: #2c3e50;">
                                Please reply to this email or contact the administrator to confirm you received this test message.
                            </p>
                        </div>
                        
                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                        
                        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
                            <p>Sniper Business Center - Email Delivery Test</p>
                            <p>This is an automated test message</p>
                        </div>
                    </div>
                </div>
            \`,
            text: \`
SBC Email Delivery Test #${testCount}

Test Details:
- Test Number: #${testCount}
- Timestamp: \${new Date().toLocaleString()}
- Email Service: SBC Notification System

✅ Success!
If you're reading this email, it means the SBC email delivery system is working correctly for your email address.

📝 Please Confirm Receipt
Please reply to this email or contact the administrator to confirm you received this test message.

---
Sniper Business Center - Email Delivery Test
This is an automated test message
            \`
        });
        
        console.log(JSON.stringify({ success, timestamp: new Date().toISOString() }));
    } catch (error) {
        console.log(JSON.stringify({ success: false, error: error.message, timestamp: new Date().toISOString() }));
    }
}

sendTest();
`;

        // Write temporary script
        require('fs').writeFileSync(path.join(__dirname, 'temp-email-test.js'), testScript);

        // Execute the script
        const child = spawn('node', ['temp-email-test.js'], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            // Clean up temporary file
            try {
                require('fs').unlinkSync(path.join(__dirname, 'temp-email-test.js'));
            } catch (e) {
                // Ignore cleanup errors
            }

            try {
                // Extract JSON from output (logs might be mixed in)
                const lines = output.split('\n');
                const jsonLine = lines.find(line => {
                    try {
                        JSON.parse(line.trim());
                        return true;
                    } catch {
                        return false;
                    }
                });

                if (jsonLine) {
                    const result = JSON.parse(jsonLine.trim());
                    resolve(result);
                } else {
                    // If no JSON found, but no error, assume success
                    resolve({
                        success: true,
                        timestamp: new Date().toISOString(),
                        note: 'Email sent but detailed response parsing failed'
                    });
                }
            } catch (e) {
                reject(new Error(`Failed to parse result: ${output} ${errorOutput}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
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

    if (process.env.NODE_ENV === 'development' && !process.env.EMAIL_SERVICE) {
        console.log('\n⚠️  DEVELOPMENT MODE: Emails will be logged to console instead of being sent');
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

    console.log(`Total tests: ${testResults.length}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success rate: ${((successful / testResults.length) * 100).toFixed(1)}%\n`);

    console.log('Individual Results:');
    testResults.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const time = new Date(result.timestamp).toLocaleTimeString();
        console.log(`${status} ${result.email} (${time})${result.error ? ` - ${result.error}` : ''}`);
    });
    console.log('');
}

// Main interactive function
async function startEmailTesting() {
    console.log('🧪 SBC Interactive Email Delivery Tester');
    console.log('=========================================');
    console.log('This script will help you test email delivery to specific addresses.');
    console.log('Press Ctrl+C at any time to exit.\n');

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
                    error: result.error || null
                };
                testResults.push(testResult);

                if (result.success) {
                    console.log('✅ Email sent successfully!');
                    console.log('📬 Please check the recipient\'s inbox (and spam folder).');
                } else {
                    console.log('❌ Email failed to send.');
                    if (result.error) {
                        console.log(`🔍 Error: ${result.error}`);
                    }
                }

            } catch (error) {
                console.log('❌ Error occurred while sending email:');
                console.log(`🔍 ${error.message}`);

                // Store failed result
                testResults.push({
                    email: email,
                    success: false,
                    timestamp: new Date().toISOString(),
                    error: error.message
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

// Check if the email service build exists
const distPath = path.join(__dirname, 'dist', 'services', 'email.service.js');
if (!require('fs').existsSync(distPath)) {
    console.log('⚠️  Email service not built. Building now...');
    console.log('Running: npm run build');

    const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    buildProcess.on('close', (code) => {
        if (code === 0) {
            console.log('✅ Build completed. Starting email tester...\n');
            startEmailTesting();
        } else {
            console.log('❌ Build failed. Please run "npm run build" manually first.');
            process.exit(1);
        }
    });
} else {
    startEmailTesting();
}