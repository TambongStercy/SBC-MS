import { emailService } from './email.service';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('EmailRelanceService');

/**
 * Media attachment for relance emails
 */
interface RelanceMedia {
    url: string;
    type: 'image' | 'video' | 'pdf';
    filename?: string;
}

/**
 * Email Relance Service
 * Handles sending follow-up (relance) emails to referrals
 * Replaces WhatsApp-based relance due to platform restrictions
 */
class EmailRelanceService {

    /**
     * Create HTML template for relance email
     */
    private createRelanceTemplate(
        messageText: string,
        dayNumber: number,
        referralName: string,
        referrerName: string,
        mediaUrls?: RelanceMedia[]
    ): string {
        // Convert message text line breaks to HTML
        const formattedMessage = messageText.replace(/\n/g, '<br>');

        // Build media section if media URLs provided
        let mediaSection = '';
        if (mediaUrls && mediaUrls.length > 0) {
            mediaSection = `
                <div style="margin: 25px 0; padding: 20px; background: #f8f9fa; border-radius: 12px;">
                    <h4 style="color: #115CF6; margin-bottom: 15px; font-size: 16px;">Documents joints:</h4>
                    ${mediaUrls.map(media => {
                        if (media.type === 'image') {
                            return `
                                <div style="margin: 10px 0;">
                                    <img src="${media.url}" alt="Image" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" />
                                </div>
                            `;
                        } else if (media.type === 'video') {
                            return `
                                <div style="margin: 10px 0;">
                                    <a href="${media.url}" style="display: inline-block; background: #115CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                        Voir la video
                                    </a>
                                </div>
                            `;
                        } else if (media.type === 'pdf') {
                            return `
                                <div style="margin: 10px 0;">
                                    <a href="${media.url}" style="display: inline-block; background: #dc3545; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                        Telecharger le PDF
                                    </a>
                                </div>
                            `;
                        }
                        return '';
                    }).join('')}
                </div>
            `;
        }

        return `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Message de ${referrerName} - Jour ${dayNumber}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                body {
                    font-family: 'Inter', Arial, sans-serif;
                    line-height: 1.7;
                    color: #333;
                    margin: 0;
                    padding: 0;
                    background-color: #f5f7fa;
                }
                .email-container {
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: #ffffff;
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
                }
                .header {
                    background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%);
                    color: white;
                    padding: 30px;
                    text-align: center;
                }
                .day-badge {
                    display: inline-block;
                    background: rgba(255,255,255,0.2);
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 14px;
                    margin-bottom: 15px;
                }
                .content {
                    padding: 40px 30px;
                }
                .message-box {
                    background: linear-gradient(135deg, #f8faff 0%, #eff6ff 100%);
                    border-left: 4px solid #115CF6;
                    padding: 25px;
                    border-radius: 12px;
                    margin: 20px 0;
                    font-size: 16px;
                    line-height: 1.8;
                }
                .footer {
                    background-color: #f8f9fa;
                    padding: 25px 30px;
                    text-align: center;
                    color: #6c757d;
                    font-size: 13px;
                }
                .cta-button {
                    display: inline-block;
                    background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%);
                    color: white;
                    padding: 15px 35px;
                    text-decoration: none;
                    border-radius: 50px;
                    font-weight: 600;
                    font-size: 16px;
                    box-shadow: 0 8px 25px rgba(17, 92, 246, 0.3);
                    margin: 20px 0;
                }
                .referrer-info {
                    background: #e8f5e9;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 25px 0;
                    text-align: center;
                }
                @media only screen and (max-width: 600px) {
                    .email-container { margin: 10px; border-radius: 12px; }
                    .content { padding: 25px 20px; }
                    .header { padding: 25px 20px; }
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="header">
                    <img src="${config.app.appLogoUrl}" alt="Sniper Business Center" style="height: 50px; width: auto; margin-bottom: 15px;" />
                    <div class="day-badge">Jour ${dayNumber} sur 7</div>
                    <h2 style="margin: 0; font-size: 24px; font-weight: 600;">Message de suivi</h2>
                </div>

                <div class="content">
                    <p style="font-size: 18px; margin-bottom: 20px;">
                        Bonjour <strong style="color: #115CF6;">${referralName}</strong>,
                    </p>

                    <div class="message-box">
                        ${formattedMessage}
                    </div>

                    ${mediaSection}

                    <div class="referrer-info">
                        <p style="margin: 0; color: #2e7d32; font-size: 15px;">
                            Ce message vous est envoye par <strong>${referrerName}</strong>
                        </p>
                        <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">
                            Votre parrain sur Sniper Business Center
                        </p>
                    </div>

                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}" class="cta-button">
                            Visiter Sniper Business Center
                        </a>
                    </div>

                    <p style="font-size: 14px; color: #888; text-align: center; margin-top: 30px;">
                        Vous recevez ce message car vous etes un membre SBC.
                        <br>Jour ${dayNumber} de votre programme de suivi personnalise.
                    </p>
                </div>

                <div class="footer">
                    <img src="${config.app.appLogoUrl}" alt="SBC" style="height: 35px; width: auto; margin-bottom: 10px;" />
                    <p><strong>Sniper Business Center</strong></p>
                    <p>Developpe par Simbtech &copy; ${new Date().getFullYear()}</p>
                    <p style="margin-top: 15px; font-size: 12px;">
                        <a href="${config.app.frontendUrl}/unsubscribe" style="color: #888;">Se desabonner</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Send relance email to a referral
     */
    async sendRelanceEmail(
        recipientEmail: string,
        recipientName: string,
        referrerName: string,
        messageText: string,
        dayNumber: number,
        mediaUrls?: RelanceMedia[]
    ): Promise<{ success: boolean; error?: string }> {
        try {
            if (!recipientEmail) {
                log.error('[EmailRelance] No recipient email provided');
                return { success: false, error: 'No recipient email provided' };
            }

            log.info(`[EmailRelance] Sending day ${dayNumber} email to ${recipientEmail}`);

            const htmlContent = this.createRelanceTemplate(
                messageText,
                dayNumber,
                recipientName,
                referrerName,
                mediaUrls
            );

            const subject = this.getSubjectForDay(dayNumber, referrerName);

            const result = await emailService.sendEmail({
                to: recipientEmail,
                subject: subject,
                html: htmlContent,
                from: config.email.from
            });

            if (result) {
                log.info(`[EmailRelance] Successfully sent day ${dayNumber} email to ${recipientEmail}`);
                return { success: true };
            } else {
                log.error(`[EmailRelance] Failed to send email to ${recipientEmail}`);
                return { success: false, error: 'Email sending failed' };
            }

        } catch (error: any) {
            log.error(`[EmailRelance] Error sending relance email:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate subject line based on day number
     */
    private getSubjectForDay(dayNumber: number, referrerName: string): string {
        const subjects: { [key: number]: string } = {
            1: `Bienvenue chez SBC - Message de ${referrerName}`,
            2: `Jour 2: Decouvrez les opportunites SBC`,
            3: `Jour 3: Comment maximiser vos gains`,
            4: `Jour 4: Temoignages de nos membres`,
            5: `Jour 5: Votre potentiel avec SBC`,
            6: `Jour 6: Questions frequentes`,
            7: `Jour 7: Dernier message - Passez a l'action !`
        };

        return subjects[dayNumber] || `Message de suivi - Jour ${dayNumber}`;
    }
}

// Export singleton instance
export const emailRelanceService = new EmailRelanceService();
