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
 * CTA Button for relance emails
 */
interface RelanceButton {
    label: string;
    url: string;
    color?: string; // Hex color, default orange #F59E0B
}

/**
 * Email Relance Service
 * Handles sending follow-up (relance) emails to referrals
 * Uses SBC brand colors: Blue (#115CF6), Green (#10B981), Orange (#F59E0B)
 */
class EmailRelanceService {

    /**
     * Create HTML template for relance email
     * Public so it can be used for preview
     */
    createRelanceTemplate(
        messageText: string,
        dayNumber: number,
        referralName: string,
        referrerName: string,
        mediaUrls?: RelanceMedia[],
        buttons?: RelanceButton[],
        subject?: string
    ): string {
        const formattedMessage = messageText.replace(/\n/g, '<br>');
        const frontendUrl = config.app.frontendUrl || 'https://sniperbuisnesscenter.com';
        const logoUrl = config.app.appLogoUrl;

        // Header title: use custom subject if provided, otherwise default
        const headerTitle = subject || this.getSubjectForDay(dayNumber, referrerName);

        // Build media section
        let mediaSection = '';
        if (mediaUrls && mediaUrls.length > 0) {
            mediaSection = `
                <div style="margin: 25px 0; padding: 20px; background: #f8fafb; border-radius: 12px; border: 1px solid #e8eef3;">
                    <h4 style="color: #115CF6; margin: 0 0 15px 0; font-size: 15px; font-weight: 600;">Documents joints</h4>
                    ${mediaUrls.map(media => {
                        if (media.type === 'image') {
                            return `
                                <div style="margin: 12px 0;">
                                    <img src="${media.url}" alt="Image" style="max-width: 100%; height: auto; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);" />
                                </div>
                            `;
                        } else if (media.type === 'video') {
                            return `
                                <div style="margin: 12px 0; text-align: center;">
                                    <a href="${media.url}" style="display: inline-block; background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                                        ▶ Voir la vidéo
                                    </a>
                                </div>
                            `;
                        } else if (media.type === 'pdf') {
                            return `
                                <div style="margin: 12px 0; text-align: center;">
                                    <a href="${media.url}" style="display: inline-block; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                                        Télécharger le PDF
                                    </a>
                                </div>
                            `;
                        }
                        return '';
                    }).join('')}
                </div>
            `;
        }

        // Build custom buttons section
        let buttonsSection = '';
        if (buttons && buttons.length > 0) {
            buttonsSection = `
                <div style="text-align: center; margin: 28px 0;">
                    ${buttons.map(btn => {
                        const btnColor = btn.color || '#F59E0B';
                        return `
                            <a href="${btn.url}" style="display: inline-block; background-color: ${btnColor}; color: white; padding: 14px 32px; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 15px; margin: 6px 8px;">
                                ${btn.label}
                            </a>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // Day progress dots (using table for email client compatibility)
        const progressDots = Array.from({ length: 7 }, (_, i) => {
            const dayNum = i + 1;
            if (dayNum < dayNumber) {
                return `<td style="padding: 0 4px;"><div style="width: 10px; height: 10px; border-radius: 50%; background-color: #10B981;"></div></td>`;
            } else if (dayNum === dayNumber) {
                return `<td style="padding: 0 4px;"><div style="width: 14px; height: 14px; border-radius: 50%; background-color: #F59E0B; border: 2px solid #ffffff;"></div></td>`;
            } else {
                return `<td style="padding: 0 4px;"><div style="width: 10px; height: 10px; border-radius: 50%; background-color: rgba(255,255,255,0.25);"></div></td>`;
            }
        }).join('');

        return `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${headerTitle}</title>
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.7; color: #333333; margin: 0; padding: 0; background-color: #f0f4f8;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);">

                <!-- Header -->
                <div style="background: linear-gradient(135deg, #0D4FD6 0%, #115CF6 40%, #0E9F6E 100%); color: white; text-align: center;">
                    <!-- Circular Logo -->
                    <div style="padding: 28px 30px 12px 30px;">
                        ${logoUrl
                            ? `<img src="${logoUrl}" alt="SBC" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 3px solid rgba(255,255,255,0.3); display: inline-block;" />`
                            : `<div style="width: 64px; height: 64px; border-radius: 50%; background-color: rgba(255,255,255,0.2); border: 3px solid rgba(255,255,255,0.3); display: inline-block; line-height: 64px; font-size: 22px; font-weight: 700;">SBC</div>`
                        }
                    </div>

                    <!-- Subject / Title -->
                    <div style="padding: 0 30px 10px 30px;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px; line-height: 1.3;">${headerTitle}</h2>
                    </div>

                    <!-- Day badge on orange pill -->
                    <div style="padding: 6px 30px 12px 30px;">
                        <div style="display: inline-block; background-color: #F59E0B; color: #ffffff; padding: 6px 22px; border-radius: 24px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px;">
                            JOUR ${dayNumber} SUR 7
                        </div>
                    </div>

                    <!-- Progress dots -->
                    <div style="padding: 0 30px 22px 30px;">
                        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto;">
                            <tr>
                                ${progressDots}
                            </tr>
                        </table>
                    </div>
                </div>

                <!-- Accent bar -->
                <div style="height: 4px; background: linear-gradient(90deg, #F59E0B 0%, #F59E0B 33%, #10B981 66%, #115CF6 100%);"></div>

                <!-- Content -->
                <div style="padding: 36px 30px;">
                    <p style="font-size: 17px; margin: 0 0 22px 0; color: #374151;">
                        Bonjour <strong style="color: #115CF6;">${referralName}</strong>,
                    </p>

                    <!-- Message Box -->
                    <div style="background-color: #f8fafb; border-left: 4px solid #10B981; padding: 22px 24px; border-radius: 0 12px 12px 0; margin: 20px 0; font-size: 15px; line-height: 1.8; color: #374151;">
                        ${formattedMessage}
                    </div>

                    ${mediaSection}

                    ${buttonsSection}

                    <!-- Referrer Info -->
                    <div style="background-color: #f0fdf4; border-radius: 12px; padding: 18px 22px; margin: 25px 0; text-align: center; border: 1px solid #d1fae5;">
                        <p style="margin: 0; color: #059669; font-size: 14px; font-weight: 500;">
                            Ce message vous est envoyé par <strong style="color: #047857;">${referrerName}</strong>
                        </p>
                        <p style="margin: 6px 0 0 0; color: #6b7280; font-size: 13px;">
                            Votre parrain sur Sniper Business Center
                        </p>
                    </div>

                    <!-- Main CTA -->
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}" style="display: inline-block; background-color: #115CF6; color: #ffffff; padding: 14px 36px; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 15px; letter-spacing: 0.3px;">
                            Visiter Sniper Business Center
                        </a>
                    </div>

                    <p style="font-size: 13px; color: #9ca3af; text-align: center; margin-top: 28px; line-height: 1.6;">
                        Vous recevez ce message car vous êtes un membre SBC.
                        <br>Jour ${dayNumber} de votre programme de suivi personnalisé.
                    </p>
                </div>

                <!-- Footer -->
                <div style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                    ${logoUrl ? `<img src="${logoUrl}" alt="SBC" style="height: 28px; width: auto; margin-bottom: 10px; opacity: 0.6;" />` : ''}
                    <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: 500;">Sniper Business Center</p>
                    <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 12px;">Développé par Simbtech &copy; ${new Date().getFullYear()}</p>
                    <p style="margin: 14px 0 0 0;">
                        <a href="${frontendUrl}/unsubscribe" style="color: #94a3b8; font-size: 12px; text-decoration: underline;">Se désabonner</a>
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
        mediaUrls?: RelanceMedia[],
        buttons?: RelanceButton[],
        customSubject?: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            if (!recipientEmail) {
                log.error('[EmailRelance] No recipient email provided');
                return { success: false, error: 'No recipient email provided' };
            }

            log.info(`[EmailRelance] Sending day ${dayNumber} email to ${recipientEmail}`);

            const subject = customSubject || this.getSubjectForDay(dayNumber, referrerName);

            const htmlContent = this.createRelanceTemplate(
                messageText,
                dayNumber,
                recipientName,
                referrerName,
                mediaUrls,
                buttons,
                subject
            );

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
    getSubjectForDay(dayNumber: number, referrerName: string): string {
        const subjects: { [key: number]: string } = {
            1: `Bienvenue chez SBC - Message de ${referrerName}`,
            2: `Jour 2: Découvrez les opportunités SBC`,
            3: `Jour 3: Comment maximiser vos gains`,
            4: `Jour 4: Témoignages de nos membres`,
            5: `Jour 5: Votre potentiel avec SBC`,
            6: `Jour 6: Questions fréquentes`,
            7: `Jour 7: Dernier message - Passez à l'action !`
        };

        return subjects[dayNumber] || `Message de suivi - Jour ${dayNumber}`;
    }
}

// Export singleton instance
export const emailRelanceService = new EmailRelanceService();
