/**
 * Script to send apology emails to users affected by the double balance deduction bug
 *
 * Run with: npx ts-node src/scripts/send-apology-emails.ts
 */

import * as nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Config values
const APP_LOGO_URL = process.env.APP_LOGO_URL || 'https://sniperbuisnesscenter.com/logo.png';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sniperbuisnesscenter.com';

// Affected users with their corrected balances
const affectedUsers = [
    { email: 'mlaganiromain@gmail.com', name: 'Romainsimple', newBalance: 1000.87 }
];

// Email template matching the app's style (from email.service.ts createBaseTemplate)
function getEmailHtml(name: string, newBalance: number): string {
    const content = `
        <div style="text-align: center;">
            <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); border-radius: 50%; margin: 0 auto 25px; box-shadow: 0 8px 25px rgba(255, 152, 0, 0.3); border-collapse: collapse;" cellpadding="0" cellspacing="0">
                <tr>
                    <td style="text-align: center; vertical-align: middle;">
                        <span style="color: white; font-size: 32px; line-height: 1;">⚠️</span>
                    </td>
                </tr>
            </table>
        </div>

        <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
            Information Importante
        </h2>

        <p style="font-size: 18px; margin-bottom: 15px;">
            Bonjour <strong style="color: #004d7a;">${name}</strong>,
        </p>

        <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
            Nous vous contactons pour vous informer d'un problème technique que nous avons identifié et corrigé sur notre plateforme.
        </p>

        <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); border-left: 5px solid #ff9800; padding: 20px; margin: 25px 0; border-radius: 8px;">
            <h3 style="color: #e65100; margin-bottom: 15px; font-size: 18px;">
                🔍 Ce qui s'est passé
            </h3>
            <p style="color: #333; margin: 0; line-height: 1.6;">
                Suite à un problème technique temporaire, votre dernier retrait a été déduit <strong>deux fois</strong> de votre solde, ce qui a entraîné un solde négatif sur votre compte.
            </p>
        </div>

        <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-left: 5px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 8px;">
            <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 18px;">
                ✅ Ce que nous avons fait
            </h3>
            <p style="color: #333; margin: 0 0 15px 0; line-height: 1.6;">
                Nous avons immédiatement corrigé ce problème. Votre solde a été rétabli.
            </p>
            <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; border: 2px dashed #4caf50;">
                <p style="color: #666; font-size: 14px; margin: 0 0 5px 0;">Votre nouveau solde</p>
                <p style="color: #2e7d32; font-size: 32px; font-weight: 700; margin: 0;">
                    ${newBalance.toFixed(2)} XAF
                </p>
            </div>
        </div>

        <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 30px 0;">
            <p style="font-size: 16px; color: #555; margin: 0; line-height: 1.6;">
                <strong style="color: #004d7a;">✨ Bonne nouvelle :</strong> Vous pouvez continuer à utiliser votre compte normalement. Le problème technique a été résolu et ne se reproduira plus.
            </p>
        </div>

        <p style="font-size: 16px; color: #555; margin: 25px 0; line-height: 1.6;">
            Nous vous présentons nos <strong>sincères excuses</strong> pour tout désagrément que cette situation a pu vous causer. La satisfaction et la confiance de nos utilisateurs sont notre priorité absolue.
        </p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/wallet" style="display: inline-block; background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; box-shadow: 0 5px 15px rgba(17, 92, 246, 0.3);">
                Voir mon solde
            </a>
        </div>

        <p style="font-size: 16px; color: #555; margin: 25px 0;">
            Si vous avez des questions ou des préoccupations, n'hésitez pas à contacter notre équipe de support.
        </p>

        <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500; margin-top: 30px;">
            Merci de votre confiance ! 🙏
        </p>
    `;

    return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="format-detection" content="telephone=no">
        <meta name="x-apple-disable-message-reformatting">
        <title>Information importante concernant votre compte SBC</title>
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        body {
            font-family: 'Inter', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f7fa;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header img {
            max-width: 100%;
            height: auto;
        }
        .content {
            padding: 40px 30px;
        }
        .footer {
            background-color: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #6c757d;
            font-size: 14px;
        }
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 10px;
                border-radius: 8px;
            }
            .content {
                padding: 20px;
            }
            .header {
                padding: 20px;
            }
        }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f7fa;">
        <div class="email-container">
            <div class="header">
                <img src="${APP_LOGO_URL}" alt="Sniper Business Center" style="height: 60px; width: auto; object-fit: contain; margin-bottom: 10px;" />
                <p style="margin: 0;">Votre plateforme de confiance</p>
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <img src="${APP_LOGO_URL}" alt="Sniper Business Center" style="height: 40px; width: auto; object-fit: contain; margin-bottom: 10px;" />
                <p><strong>Sniper Business Center</strong></p>
                <p>Développé par Simbtech © ${new Date().getFullYear()}</p>
                <p>Cameroun - Yaoundé</p>
                <p style="margin-top: 15px; color: #495057;">Votre satisfaction est notre priorité.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

async function sendApologyEmails() {
    console.log('=== Sending Apology Emails to Affected Users ===\n');
    console.log('Date:', new Date().toISOString());
    console.log('Total users:', affectedUsers.length);
    console.log('');

    // Initialize email transporter
    const emailService = process.env.EMAIL_SERVICE || '';
    const emailUser = process.env.EMAIL_USER || '';
    const emailPassword = process.env.EMAIL_PASSWORD || '';
    const emailFrom = process.env.EMAIL_FROM || 'SBC <noreply@sniperbusinesscenter.com>';

    if (!emailService || !emailUser || !emailPassword) {
        console.error('ERROR: Email configuration missing!');
        console.error('Please ensure EMAIL_SERVICE, EMAIL_USER, and EMAIL_PASSWORD are set in .env');
        process.exit(1);
    }

    let transportConfig: nodemailer.TransportOptions;

    if (emailService.toLowerCase() === 'sendgrid') {
        transportConfig = {
            service: 'SendGrid',
            auth: {
                user: emailUser,
                pass: emailPassword,
            }
        } as nodemailer.TransportOptions;
    } else {
        transportConfig = {
            host: emailService,
            port: 465,
            secure: true,
            auth: {
                user: emailUser,
                pass: emailPassword,
            }
        } as nodemailer.TransportOptions;
    }

    const transporter = nodemailer.createTransport(transportConfig);

    // Verify connection
    try {
        await transporter.verify();
        console.log('Email transporter verified successfully.\n');
    } catch (error) {
        console.error('Failed to verify email transporter:', error);
        process.exit(1);
    }

    let successCount = 0;
    let failCount = 0;

    for (const user of affectedUsers) {
        try {
            const result = await transporter.sendMail({
                from: emailFrom,
                to: user.email,
                subject: '🔔 Information importante concernant votre compte SBC',
                html: getEmailHtml(user.name, user.newBalance)
            });

            console.log(`✓ Sent to ${user.email} - Message ID: ${result.messageId}`);
            successCount++;
        } catch (error: any) {
            console.error(`✗ Failed to send to ${user.email}: ${error.message}`);
            failCount++;
        }

        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Successfully sent: ${successCount}`);
    console.log(`Failed: ${failCount}`);
}

// Run the script
sendApologyEmails().catch(console.error);
