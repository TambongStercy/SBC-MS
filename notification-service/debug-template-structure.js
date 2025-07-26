const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Script to check exact template structure from WhatsApp API
async function checkTemplateStructure() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';

    const httpClient = axios.create({
        baseURL: `https://graph.facebook.com/${apiVersion}`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    try {
        console.log('🔍 Checking template structure for OTP templates...\n');

        const response = await httpClient.get(`/${businessAccountId}/message_templates`);
        const templates = response.data.data;

        const targetTemplates = ['connexion', 'connexionfr'];

        targetTemplates.forEach(templateName => {
            const template = templates.find(t => t.name === templateName);
            if (template) {
                console.log(`📄 Template: ${templateName}`);
                console.log(`Status: ${template.status}`);
                console.log(`Language: ${template.language}`);
                console.log(`Category: ${template.category}`);
                console.log('\n🔧 Components:');

                template.components.forEach((component, index) => {
                    console.log(`${index + 1}. Type: ${component.type}`);
                    if (component.text) {
                        console.log(`   Text: "${component.text}"`);
                    }
                    if (component.example && component.example.body_text) {
                        console.log(`   Example: ${JSON.stringify(component.example.body_text)}`);
                    }
                    if (component.buttons) {
                        console.log(`   Buttons: ${component.buttons.length} found`);
                        component.buttons.forEach((button, btnIndex) => {
                            console.log(`     ${btnIndex + 1}. Type: ${button.type}`);
                            console.log(`        Text: "${button.text}"`);
                            if (button.url) {
                                console.log(`        URL: "${button.url}"`);
                            }
                            if (button.example) {
                                console.log(`        Example: ${JSON.stringify(button.example)}`);
                            }
                        });
                    }
                    console.log('');
                });

                console.log('='.repeat(50));
                console.log('\n📋 Correct Component Structure for Code:');

                // Generate the correct component structure based on template
                const correctComponents = [];

                template.components.forEach(component => {
                    if (component.type === 'BODY') {
                        correctComponents.push({
                            type: "body",
                            parameters: [
                                {
                                    type: "text",
                                    text: "123456" // Example OTP
                                }
                            ]
                        });
                    }

                    if (component.type === 'BUTTONS' && component.buttons) {
                        component.buttons.forEach((button, index) => {
                            if (button.type === 'URL') {
                                correctComponents.push({
                                    type: "button",
                                    sub_type: "url",
                                    index: index.toString(),
                                    parameters: [
                                        {
                                            type: "text",
                                            text: "123456" // OTP code for URL
                                        }
                                    ]
                                });
                            }
                        });
                    }
                });

                console.log(JSON.stringify(correctComponents, null, 2));
                console.log('\n' + '='.repeat(50) + '\n');
            }
        });

    } catch (error) {
        console.error('❌ Failed to check template structure:', error.response?.data?.error?.message || error.message);
    }
}

checkTemplateStructure().catch(console.error); 