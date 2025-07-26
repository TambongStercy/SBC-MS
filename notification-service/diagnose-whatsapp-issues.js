const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Comprehensive WhatsApp Cloud API diagnostic script
class WhatsAppDiagnostic {
    constructor() {
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;

        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async runFullDiagnostic() {
        console.log('🔍 WhatsApp Cloud API Comprehensive Diagnostic\n');
        console.log('='.repeat(60));

        try {
            await this.checkConfiguration();
            await this.checkPhoneNumber();
            await this.checkBusinessAccount();
            await this.checkTemplates();
            await this.checkPhoneNumberQuality();
            await this.checkRecentActivity();
            await this.testSimpleMessage();

            console.log('\n' + '='.repeat(60));
            console.log('🎯 RECOMMENDATIONS:');
            await this.generateRecommendations();

        } catch (error) {
            console.error('❌ Diagnostic failed:', error.message);
        }
    }

    async checkConfiguration() {
        console.log('\n📋 1. Configuration Check');
        console.log('-'.repeat(30));

        const checks = [
            { name: 'Access Token', value: this.accessToken, required: true },
            { name: 'Phone Number ID', value: this.phoneNumberId, required: true },
            { name: 'Business Account ID', value: this.businessAccountId, required: true },
            { name: 'API Version', value: this.apiVersion, required: false }
        ];

        checks.forEach(check => {
            if (check.required && !check.value) {
                console.log(`❌ ${check.name}: Missing`);
            } else if (check.value) {
                const displayValue = check.name === 'Access Token'
                    ? check.value.substring(0, 20) + '...'
                    : check.value;
                console.log(`✅ ${check.name}: ${displayValue}`);
            } else {
                console.log(`⚠️  ${check.name}: Not set (optional)`);
            }
        });
    }

    async checkPhoneNumber() {
        console.log('\n📱 2. Phone Number Status');
        console.log('-'.repeat(30));

        try {
            const response = await this.httpClient.get(`/${this.phoneNumberId}`);
            const phoneData = response.data;

            console.log(`✅ Phone Number: ${phoneData.display_phone_number}`);
            console.log(`✅ Status: ${phoneData.verified_name}`);
            console.log(`✅ Quality Rating: ${phoneData.quality_rating || 'Not available'}`);
            console.log(`✅ Name Status: ${phoneData.name_status || 'Not available'}`);

            if (phoneData.quality_rating && phoneData.quality_rating !== 'GREEN') {
                console.log(`⚠️  WARNING: Quality rating is ${phoneData.quality_rating}. This may affect delivery.`);
            }

        } catch (error) {
            console.log(`❌ Failed to check phone number: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async checkBusinessAccount() {
        console.log('\n🏢 3. Business Account Status');
        console.log('-'.repeat(30));

        try {
            const response = await this.httpClient.get(`/${this.businessAccountId}`);
            const businessData = response.data;

            console.log(`✅ Business Name: ${businessData.name}`);
            console.log(`✅ Business ID: ${businessData.id}`);
            console.log(`✅ Business Status: ${businessData.business_status || 'Active'}`);

        } catch (error) {
            console.log(`❌ Failed to check business account: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async checkTemplates() {
        console.log('\n📄 4. Template Status Check');
        console.log('-'.repeat(30));

        try {
            const response = await this.httpClient.get(`/${this.businessAccountId}/message_templates`);
            const templates = response.data.data;

            const targetTemplates = ['connexion', 'connexionfr'];

            targetTemplates.forEach(templateName => {
                const template = templates.find(t => t.name === templateName);
                if (template) {
                    console.log(`✅ Template "${templateName}": ${template.status}`);
                    console.log(`   Language: ${template.language}`);
                    console.log(`   Category: ${template.category}`);

                    if (template.status !== 'APPROVED') {
                        console.log(`   ⚠️  WARNING: Template is ${template.status}, not APPROVED`);
                    }

                    // Check template components
                    if (template.components) {
                        console.log(`   Components: ${template.components.length} found`);
                        template.components.forEach((comp, index) => {
                            console.log(`     ${index + 1}. ${comp.type} - ${comp.text || 'Dynamic content'}`);
                        });
                    }
                } else {
                    console.log(`❌ Template "${templateName}": NOT FOUND`);
                }
            });

            console.log(`\n📊 Total templates found: ${templates.length}`);

        } catch (error) {
            console.log(`❌ Failed to check templates: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async checkPhoneNumberQuality() {
        console.log('\n🌟 5. Phone Number Quality Rating');
        console.log('-'.repeat(30));

        try {
            const response = await this.httpClient.get(`/${this.phoneNumberId}/message_delivery_metrics`);
            const metrics = response.data.data;

            if (metrics && metrics.length > 0) {
                const latestMetric = metrics[0];
                console.log(`✅ Delivery Rate: ${latestMetric.delivered || 'N/A'}`);
                console.log(`✅ Read Rate: ${latestMetric.read || 'N/A'}`);
                console.log(`✅ Sent Count: ${latestMetric.sent || 'N/A'}`);
            } else {
                console.log(`⚠️  No delivery metrics available`);
            }

        } catch (error) {
            console.log(`⚠️  Could not retrieve delivery metrics: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async checkRecentActivity() {
        console.log('\n📈 6. Recent Message Activity');
        console.log('-'.repeat(30));

        try {
            // This endpoint might not be available for all accounts
            const response = await this.httpClient.get(`/${this.phoneNumberId}/analytics`);
            console.log(`✅ Analytics data available`);

        } catch (error) {
            console.log(`⚠️  Analytics not available: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async testSimpleMessage() {
        console.log('\n🧪 7. Test Message Send');
        console.log('-'.repeat(30));

        const testMessage = {
            messaging_product: 'whatsapp',
            to: '237675080477', // Test number
            type: 'template',
            template: {
                name: 'connexion',
                language: {
                    code: 'en_US'
                },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            {
                                type: 'text',
                                text: 'TEST123'
                            }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            {
                                type: 'text',
                                text: 'TEST123'
                            }
                        ]
                    }
                ]
            }
        };

        try {
            console.log('🚀 Sending test template message...');
            const response = await this.httpClient.post(`/${this.phoneNumberId}/messages`, testMessage);

            if (response.data.messages && response.data.messages.length > 0) {
                console.log(`✅ Test message sent successfully!`);
                console.log(`   Message ID: ${response.data.messages[0].id}`);
                console.log(`   WhatsApp ID: ${response.data.contacts[0].wa_id}`);
            }

        } catch (error) {
            console.log(`❌ Test message failed: ${error.response?.data?.error?.message || error.message}`);
            if (error.response?.data?.error?.error_data) {
                console.log(`   Error details: ${JSON.stringify(error.response.data.error.error_data, null, 2)}`);
            }
        }
    }

    async generateRecommendations() {
        console.log('\n🔧 Check these common issues:');
        console.log('1. Templates must be APPROVED by Meta (not just PENDING)');
        console.log('2. Phone number must have GREEN quality rating');
        console.log('3. Business account must be verified');
        console.log('4. Template parameters must match exactly with approved template');
        console.log('5. Recipient phone numbers must be valid international format');
        console.log('6. Check if your WhatsApp Business account has any restrictions');
        console.log('\n💡 Next steps:');
        console.log('- If templates are PENDING, wait for Meta approval (can take 24-48 hours)');
        console.log('- If quality rating is not GREEN, review message sending practices');
        console.log('- Test with a different phone number to isolate issues');
        console.log('- Check Meta Business Manager for any account restrictions');
    }
}

// Run the diagnostic
const diagnostic = new WhatsAppDiagnostic();
diagnostic.runFullDiagnostic().catch(console.error); 