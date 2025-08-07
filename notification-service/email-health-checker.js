/**
 * Email Health Checker
 * Helps identify users with email delivery issues and guide them to fix it
 */

const { emailService } = require('./dist/services/email.service');

class EmailHealthChecker {
    constructor() {
        this.testResults = new Map();
    }

    /**
     * Send a health check email to a user
     */
    async sendHealthCheckEmail(email, userName = 'User') {
        try {
            const healthCheckResult = await emailService.sendEmail({
                to: email,
                subject: '📧 SBC Email Health Check - Action Required',
                html: this.createHealthCheckHtml(email, userName),
                text: this.createHealthCheckText(email, userName)
            });

            this.testResults.set(email, {
                timestamp: new Date(),
                sent: healthCheckResult,
                type: 'health_check'
            });

            return healthCheckResult;
        } catch (error) {
            this.testResults.set(email, {
                timestamp: new Date(),
                sent: false,
                error: error.message,
                type: 'health_check'
            });
            throw error;
        }
    }

    /**
     * Create HTML for health check email
     */
    createHealthCheckHtml(email, userName) {
        return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h2 style="color: #e74c3c; text-align: center; margin-bottom: 30px;">
                    ⚠️ Email Delivery Issue Detected
                </h2>
                
                <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f39c12;">
                    <h3 style="color: #856404; margin: 0 0 10px 0;">Hi ${userName},</h3>
                    <p style="margin: 0; color: #856404;">
                        We've detected that your email address <strong>${email}</strong> might have delivery issues. 
                        This could affect important notifications from Sniper Business Center.
                    </p>
                </div>
                
                <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #dc3545;">
                    <h3 style="color: #721c24; margin: 0 0 10px 0;">🚨 Common Issues:</h3>
                    <ul style="margin: 10px 0; padding-left: 20px; color: #721c24;">
                        <li><strong>Mailbox Full:</strong> Your email storage is at capacity</li>
                        <li><strong>Spam Folder:</strong> Our emails might be going to spam</li>
                        <li><strong>Inactive Account:</strong> Email account not being monitored</li>
                        <li><strong>Provider Blocking:</strong> Your email provider is blocking business emails</li>
                    </ul>
                </div>
                
                <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #17a2b8;">
                    <h3 style="color: #0c5460; margin: 0 0 10px 0;">✅ How to Fix:</h3>
                    <ol style="margin: 10px 0; padding-left: 20px; color: #0c5460;">
                        <li><strong>Clean Your Mailbox:</strong> Delete old emails to free up space</li>
                        <li><strong>Check Spam Folder:</strong> Look for SBC emails and mark as "Not Spam"</li>
                        <li><strong>Add to Safe Senders:</strong> Add noreply@sniperbuisnesscenter.com to your contacts</li>
                        <li><strong>Update Email Address:</strong> Provide a more reliable email in your SBC profile</li>
                        <li><strong>Use WhatsApp:</strong> Enable WhatsApp notifications as a backup</li>
                    </ol>
                </div>
                
                <div style="background-color: #d5f4e6; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #27ae60;">
                    <h3 style="color: #155724; margin: 0 0 10px 0;">📱 Alternative: WhatsApp Notifications</h3>
                    <p style="margin: 0; color: #155724;">
                        To ensure you never miss important notifications, consider enabling WhatsApp notifications 
                        in your SBC account settings. WhatsApp delivery is more reliable than email.
                    </p>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="#" style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                        Update My Notification Settings
                    </a>
                </div>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
                <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
                    <p><strong>Sniper Business Center</strong></p>
                    <p>Email Health Check System</p>
                    <p>If you received this email, your email is working - please follow the steps above to improve reliability.</p>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Create text version for health check email
     */
    createHealthCheckText(email, userName) {
        return `
⚠️ EMAIL DELIVERY ISSUE DETECTED

Hi ${userName},

We've detected that your email address ${email} might have delivery issues. This could affect important notifications from Sniper Business Center.

🚨 COMMON ISSUES:
• Mailbox Full: Your email storage is at capacity
• Spam Folder: Our emails might be going to spam
• Inactive Account: Email account not being monitored
• Provider Blocking: Your email provider is blocking business emails

✅ HOW TO FIX:
1. Clean Your Mailbox: Delete old emails to free up space
2. Check Spam Folder: Look for SBC emails and mark as "Not Spam"
3. Add to Safe Senders: Add noreply@sniperbuisnesscenter.com to your contacts
4. Update Email Address: Provide a more reliable email in your SBC profile
5. Use WhatsApp: Enable WhatsApp notifications as a backup

📱 ALTERNATIVE: WHATSAPP NOTIFICATIONS
To ensure you never miss important notifications, consider enabling WhatsApp notifications in your SBC account settings. WhatsApp delivery is more reliable than email.

---
Sniper Business Center
Email Health Check System
If you received this email, your email is working - please follow the steps above to improve reliability.
        `;
    }

    /**
     * Get health check results
     */
    getResults() {
        return Array.from(this.testResults.entries()).map(([email, result]) => ({
            email,
            ...result
        }));
    }

    /**
     * Bulk health check for multiple users
     */
    async bulkHealthCheck(users) {
        const results = [];

        for (const user of users) {
            try {
                console.log(`Checking email health for ${user.email}...`);
                const result = await this.sendHealthCheckEmail(user.email, user.name);
                results.push({
                    email: user.email,
                    name: user.name,
                    success: result,
                    timestamp: new Date()
                });

                // Add delay to avoid overwhelming email service
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                results.push({
                    email: user.email,
                    name: user.name,
                    success: false,
                    error: error.message,
                    timestamp: new Date()
                });
            }
        }

        return results;
    }
}

module.exports = EmailHealthChecker;