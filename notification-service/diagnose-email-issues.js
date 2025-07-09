#!/usr/bin/env node

/**
 * Email Notification Diagnostic Script
 * 
 * This script helps diagnose why some users are not receiving email notifications.
 * Run this to check the health of your notification infrastructure.
 */

const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);

// Simple config object for diagnostics
const config = {
    email: {
        service: process.env.EMAIL_SERVICE || '',
        user: process.env.EMAIL_USER || '',
        password: process.env.EMAIL_PASSWORD || '',
        bounceHandling: {
            maxRetries: parseInt(process.env.EMAIL_MAX_RETRIES || '3', 10),
            retryDelay: parseInt(process.env.EMAIL_RETRY_DELAY || '300000', 10),
        }
    }
};

class EmailDiagnostics {
    constructor() {
        this.issues = [];
        this.recommendations = [];
    }

    /**
     * Comprehensive email configuration diagnostics
     */
    async diagnoseEmailIssues() {
        console.log('🔍 Starting Email Diagnostics for SBC...\n');

        await this.checkDNSConfiguration();
        await this.checkSenderDomainReputation();
        await this.checkSPFRecords();
        await this.checkDKIMRecords();
        await this.checkDMARCRecords();
        await this.testEmailService();
        await this.checkBlacklistStatus();

        this.generateReport();
    }

    /**
     * Check DNS configuration for main domain and subdomains
     */
    async checkDNSConfiguration() {
        console.log('🌐 Checking DNS Configuration...');

        const domains = [
            'sniperbuisnesscenter.com',
            'em7228.sniperbuisnesscenter.com', // The problematic subdomain
            'mail.sniperbuisnesscenter.com'
        ];

        for (const domain of domains) {
            try {
                const mxRecords = await resolveMx(domain);
                console.log(`✅ MX Records for ${domain}:`, mxRecords);
            } catch (error) {
                console.log(`❌ No MX records found for ${domain}`);
                this.issues.push(`Missing MX records for ${domain}`);

                if (domain === 'em7228.sniperbuisnesscenter.com') {
                    this.recommendations.push('🔧 Configure DNS records for SendGrid subdomain');
                }
            }
        }
    }

    /**
     * Check SPF records for email authentication
     */
    async checkSPFRecords() {
        console.log('\n📧 Checking SPF Records...');

        try {
            const txtRecords = await resolveTxt('sniperbuisnesscenter.com');
            const spfRecord = txtRecords.find(record =>
                record.some(txt => txt.includes('v=spf1'))
            );

            if (spfRecord) {
                console.log('✅ SPF Record found:', spfRecord);

                // Check if SendGrid is included
                const spfText = spfRecord.join('');
                if (!spfText.includes('sendgrid.net')) {
                    this.issues.push('SPF record does not include SendGrid');
                    this.recommendations.push('🔧 Add "include:sendgrid.net" to SPF record');
                }
            } else {
                console.log('❌ No SPF record found');
                this.issues.push('Missing SPF record');
                this.recommendations.push('🔧 Create SPF record: "v=spf1 include:sendgrid.net ~all"');
            }
        } catch (error) {
            console.log('❌ Error checking SPF records:', error.message);
        }
    }

    /**
     * Check DKIM records
     */
    async checkDKIMRecords() {
        console.log('\n🔐 Checking DKIM Records...');

        const dkimSelectors = [
            's1._domainkey.sniperbuisnesscenter.com',
            's2._domainkey.sniperbuisnesscenter.com',
            'sg._domainkey.sniperbuisnesscenter.com'
        ];

        let dkimFound = false;
        for (const selector of dkimSelectors) {
            try {
                const txtRecords = await resolveTxt(selector);
                console.log(`✅ DKIM Record found for ${selector}:`, txtRecords);
                dkimFound = true;
            } catch (error) {
                console.log(`❌ No DKIM record for ${selector}`);
            }
        }

        if (!dkimFound) {
            this.issues.push('No DKIM records found');
            this.recommendations.push('🔧 Configure DKIM records for email authentication');
        }
    }

    /**
     * Check DMARC policy
     */
    async checkDMARCRecords() {
        console.log('\n🛡️ Checking DMARC Records...');

        try {
            const txtRecords = await resolveTxt('_dmarc.sniperbuisnesscenter.com');
            const dmarcRecord = txtRecords.find(record =>
                record.some(txt => txt.includes('v=DMARC1'))
            );

            if (dmarcRecord) {
                console.log('✅ DMARC Record found:', dmarcRecord);
            } else {
                console.log('❌ No DMARC record found');
                this.issues.push('Missing DMARC record');
                this.recommendations.push('🔧 Create DMARC record for email policy');
            }
        } catch (error) {
            console.log('❌ Error checking DMARC records:', error.message);
        }
    }

    /**
     * Test email service connection
     */
    async testEmailService() {
        console.log('\n📤 Testing Email Service Connection...');

        try {
            let transportConfig;

            if (config.email.service.toLowerCase() === 'sendgrid') {
                transportConfig = {
                    service: 'SendGrid',
                    auth: {
                        user: config.email.user,
                        pass: config.email.password,
                    }
                };
            } else {
                transportConfig = {
                    host: config.email.service,
                    port: 465,
                    secure: true,
                    auth: {
                        user: config.email.user,
                        pass: config.email.password,
                    }
                };
            }

            const transporter = nodemailer.createTransporter(transportConfig);
            await transporter.verify();
            console.log('✅ Email service connection successful');
        } catch (error) {
            console.log('❌ Email service connection failed:', error.message);
            this.issues.push('Email service authentication failed');
            this.recommendations.push('🔧 Verify email service credentials');
        }
    }

    /**
     * Check sender domain reputation
     */
    async checkSenderDomainReputation() {
        console.log('\n🎯 Checking Sender Domain Reputation...');

        // This would typically involve checking against various blacklist APIs
        console.log('ℹ️ Manual check required: Visit https://mxtoolbox.com/blacklists.aspx');
        console.log('   Check these domains:');
        console.log('   - sniperbuisnesscenter.com');
        console.log('   - em7228.sniperbuisnesscenter.com');

        this.recommendations.push('🔍 Check domain reputation on major blacklists');
    }

    /**
     * Check blacklist status
     */
    async checkBlacklistStatus() {
        console.log('\n🚫 Checking Blacklist Status...');

        console.log('ℹ️ Recommended tools for blacklist checking:');
        console.log('   - MXToolbox: https://mxtoolbox.com/blacklists.aspx');
        console.log('   - Sender Score: https://www.senderscore.org/');
        console.log('   - BarracudaCentral: https://www.barracudacentral.org/lookups');

        this.recommendations.push('🔍 Regular blacklist monitoring recommended');
    }

    /**
     * Generate comprehensive report and solutions
     */
    generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📋 EMAIL DIAGNOSTICS REPORT');
        console.log('='.repeat(60));

        console.log('\n🚨 ISSUES FOUND:');
        if (this.issues.length === 0) {
            console.log('✅ No major issues detected');
        } else {
            this.issues.forEach((issue, index) => {
                console.log(`${index + 1}. ${issue}`);
            });
        }

        console.log('\n💡 RECOMMENDATIONS:');
        this.recommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec}`);
        });

        console.log('\n🛠️ IMMEDIATE ACTIONS FOR BOUNCE ISSUES:');
        this.generateImmediateActions();

        console.log('\n📧 RECOMMENDED DNS RECORDS:');
        this.generateDNSRecommendations();
    }

    /**
     * Generate immediate actions for current bounce issues
     */
    generateImmediateActions() {
        console.log(`
1. 🔧 CONFIGURE SENDGRID SUBDOMAIN:
   - Log into SendGrid dashboard
   - Navigate to Settings > Sender Authentication
   - Set up domain authentication for sniperbuisnesscenter.com
   - This will create proper DNS records for em7228.sniperbuisnesscenter.com

2. 📋 UPDATE DNS RECORDS:
   Add these TXT records to your DNS:
   
   Name: sniperbuisnesscenter.com
   Type: TXT
   Value: "v=spf1 include:sendgrid.net ~all"
   
   Name: _dmarc.sniperbuisnesscenter.com
   Type: TXT
   Value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@sniperbuisnesscenter.com"

3. 🎯 APPLE/ICLOUD SPECIFIC FIXES:
   - Ensure reverse DNS is properly configured
   - Use consistent From address (avoid frequent changes)
   - Implement proper unsubscribe headers
   - Monitor sender reputation closely

4. ⚡ IMMEDIATE WORKAROUND:
   - Switch to main domain for sending (noreply@sniperbuisnesscenter.com)
   - Avoid using subdomains until properly configured
        `);
    }

    /**
     * Generate DNS configuration recommendations
     */
    generateDNSRecommendations() {
        console.log(`
🌐 REQUIRED DNS RECORDS FOR EMAIL DELIVERY:

1. SPF Record:
   Name: sniperbuisnesscenter.com
   Type: TXT
   TTL: 3600
   Value: "v=spf1 include:sendgrid.net ~all"

2. DMARC Record:
   Name: _dmarc.sniperbuisnesscenter.com
   Type: TXT
   TTL: 3600
   Value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@sniperbuisnesscenter.com; ruf=mailto:dmarc@sniperbuisnesscenter.com; fo=1"

3. DKIM Records:
   (Generated by SendGrid - add to DNS when provided)

4. MX Record (if hosting email):
   Name: sniperbuisnesscenter.com
   Type: MX
   Priority: 10
   Value: mail.sniperbuisnesscenter.com

💡 Pro Tip: After DNS changes, wait 24-48 hours for propagation before testing.
        `);
    }
}

// Configuration fix for immediate relief
function generateConfigFix() {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 IMMEDIATE CONFIGURATION FIX');
    console.log('='.repeat(60));

    console.log(`
Update your .env file with this configuration:

# Use main domain instead of subdomain for immediate fix
EMAIL_FROM="Sniper Business Center <noreply@sniperbuisnesscenter.com>"

# Alternative safe sender addresses:
# EMAIL_FROM="SBC Team <support@sniperbuisnesscenter.com>"
# EMAIL_FROM="Sniper Business Center <admin@sniperbuisnesscenter.com>"

# Ensure SendGrid is properly configured
EMAIL_SERVICE=SendGrid
EMAIL_USER=apikey
EMAIL_PASSWORD=your_sendgrid_api_key_here

# Monitor bounce webhook (add this endpoint)
SENDGRID_WEBHOOK_SECRET=your_webhook_verification_secret
    `);
}

// Email deliverability best practices
function generateBestPractices() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 EMAIL DELIVERABILITY BEST PRACTICES');
    console.log('='.repeat(60));

    console.log(`
🎯 FOR APPLE/ICLOUD DELIVERABILITY:
1. Use consistent sender name and email
2. Implement proper authentication (SPF, DKIM, DMARC)
3. Monitor reputation with Apple's Postmaster tools
4. Avoid suspicious content and excessive links
5. Implement proper unsubscribe mechanisms

📧 GENERAL BEST PRACTICES:
1. Warm up new sending domains gradually
2. Monitor bounce rates (keep under 5%)
3. Implement feedback loops
4. Use double opt-in for subscriptions
5. Regular list cleaning and validation

🔍 MONITORING TOOLS:
1. SendGrid Analytics Dashboard
2. Google Postmaster Tools
3. Microsoft SNDS
4. Apple's Postmaster tools
5. Regular blacklist monitoring

⚡ IMMEDIATE ACTIONS:
1. Configure DNS records as shown above
2. Set up SendGrid domain authentication
3. Switch to main domain sending
4. Monitor bounce rates closely
5. Implement bounce handling webhook
    `);
}

// Run diagnostics
async function main() {
    const diagnostics = new EmailDiagnostics();
    await diagnostics.diagnoseEmailIssues();
    generateConfigFix();
    generateBestPractices();

    console.log('\n✅ Diagnostics complete! Follow the recommendations above to fix email delivery issues.');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = EmailDiagnostics; 