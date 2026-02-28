import * as nodemailer from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';
import { Attachment } from 'nodemailer/lib/mailer';
import { BounceHandlerService } from './bounceHandler.service';
import { spamChecker, SpamCheckResult } from '../utils/spam-checker';

// Create a component-specific logger
const log = logger.getLogger('EmailService');

// Interface for email options
interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
    attachments?: Attachment[];
}

interface CommissionEmailData {
    email: string;
    amount: number | string;
    level: string | number;
    name: string;
    username: string;
    debt?: number | string;
    currency: string; // Added missing currency field
}

interface TransactionSuccessEmailData {
    email: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string; // Or Date object, format in function
    productOrServiceName?: string;
}

interface TransactionFailureEmailData {
    email: string;
    name: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
    reason?: string;
    transactionType: string;
    productOrServiceName?: string;
}

class EmailService {
    private transporter!: nodemailer.Transporter;
    private isInitialized: boolean = false;
    private bounceHandler: BounceHandlerService;

    constructor() {
        this.bounceHandler = new BounceHandlerService();
        this.initializeTransporter();
    }

    /**
     * Initialize the email transporter
     */
    private initializeTransporter(): void {
        try {
            // Only initialize if email config is available
            if (config.email.service && config.email.user && config.email.password) {
                let transportConfig: nodemailer.TransportOptions;

                // Check if the service is SendGrid (case-insensitive)
                if (config.email.service.toLowerCase() === 'sendgrid') {
                    transportConfig = {
                        service: 'SendGrid',
                        auth: {
                            user: config.email.user, // Should be 'apikey' for SendGrid API key
                            pass: config.email.password,
                        }
                    } as nodemailer.TransportOptions; // Cast to assure TypeScript
                } else {
                    // For other services, or generic SMTP
                    transportConfig = {
                        host: config.email.service, // Assuming service name can be host if not 'sendgrid'
                        port: 465,
                        secure: true, // true for 465, false for other ports
                        auth: {
                            user: config.email.user,
                            pass: config.email.password,
                        }
                    } as nodemailer.TransportOptions; // Cast to assure TypeScript
                }

                this.transporter = nodemailer.createTransport(transportConfig);
                this.isInitialized = true;
                log.info('Email transporter initialized successfully');
            } else {
                log.warn('Email configuration missing, email sending will be disabled');
                this.isInitialized = false;
            }
        } catch (error) {
            log.error('Failed to initialize transporter', { error });
            this.isInitialized = false;
        }
    }

    /**
     * Enhanced email sending with bounce checking and spam detection
     */
    async sendEmail(options: EmailOptions): Promise<boolean> {
        // Validate email address format
        const emailValidation = spamChecker.validateEmailAddress(options.to);
        if (!emailValidation.isValid) {
            log.warn('Email not sent - invalid email address', {
                email: options.to,
                warnings: emailValidation.warnings
            });
            return false;
        }

        // Log any email address warnings (disposable domains, typos)
        if (emailValidation.warnings.length > 0) {
            log.warn('Email address warnings detected', {
                email: options.to,
                warnings: emailValidation.warnings
            });
        }

        // Check content for spam patterns
        const spamCheck = spamChecker.checkContent(
            options.subject,
            options.html,
            options.text
        );

        if (spamCheck.isSpam) {
            log.warn('Email blocked - spam content detected', {
                email: options.to,
                subject: options.subject,
                spamScore: spamCheck.score,
                reasons: spamCheck.reasons
            });
            return false;
        }

        // Log moderate spam scores for monitoring
        if (spamCheck.score > 25) {
            log.info('Email passed spam check with elevated score', {
                email: options.to,
                subject: options.subject,
                spamScore: spamCheck.score,
                reasons: spamCheck.reasons
            });
        }

        // Check if email is blacklisted before sending
        if (this.bounceHandler.isBlacklisted(options.to)) {
            log.warn('Email not sent - recipient is blacklisted', {
                email: options.to,
                reputation: this.bounceHandler.getEmailReputation(options.to)
            });
            return false;
        }

        // Check email reputation
        const reputation = this.bounceHandler.getEmailReputation(options.to);
        if (reputation === 'poor') {
            log.warn('Sending to email with poor reputation', {
                email: options.to,
                reputation
            });
        }

        if (!this.isInitialized) {
            if (config.nodeEnv === 'development') {
                // In development, just log the email instead of sending
                log.info('----- DEV MODE EMAIL (Not sent due to uninitialized service) -----');
                log.info(`To: ${options.to}`);
                log.info(`Subject: ${options.subject}`);
                log.info(`Body: ${options.text || options.html}`);
                if (options.attachments && options.attachments.length > 0) {
                    log.info(`Attachments: ${options.attachments.map(a => a.filename).join(', ')}`);
                }
                log.info('--------------------------');
                return true;
            } else {
                log.error('Email service not initialized, cannot send email in production.');
                throw new Error('Email service not initialized');
            }
        }

        try {
            // Configure email options with enhanced headers for better deliverability
            const mailOptions: any = {
                from: options.from || config.email.from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
                attachments: options.attachments,
                // Add headers for better deliverability
                headers: {
                    'X-Mailer': 'SBC-Notification-System',
                    'List-Unsubscribe': '<mailto:unsubscribe@sniperbuisnesscenter.com>',
                    'X-Entity-Ref-ID': `sbc-${Date.now()}`, // Unique reference for tracking
                },
                // Enable SendGrid tracking (open and click tracking)
                trackingSettings: {
                    clickTracking: {
                        enable: true,
                        enableText: false
                    },
                    openTracking: {
                        enable: true
                    }
                }
            };

            // Send email
            const info = await this.transporter.sendMail(mailOptions);

            log.info(`Email sent successfully to ${options.to}`, {
                messageId: info.messageId,
                reputation: reputation
            });

            return true;
        } catch (error: any) {
            log.error(`Failed to send email to ${options.to}`, {
                error: error.message,
                reputation: reputation
            });

            // Handle specific bounce scenarios immediately
            if (error.message.includes('Domain not found') ||
                error.message.includes('Sender address rejected')) {
                await this.bounceHandler.handleBounce({
                    email: options.to,
                    timestamp: new Date(),
                    reason: error.message,
                    bounceType: 'block',
                    severity: 'high',
                    retryCount: 0
                });
            }

            throw error;
        }
    }

    /**
     * Send email with message ID tracking (for relance emails)
     * Returns the SendGrid message ID for tracking open/click events
     */
    async sendEmailWithTracking(options: EmailOptions): Promise<{ success: boolean; messageId?: string }> {
        try {
            // Reuse the same logic but capture and return the message ID
            const emailValidation = spamChecker.validateEmailAddress(options.to);
            if (!emailValidation.isValid) {
                log.warn('Email not sent - invalid email address', {
                    email: options.to,
                    warnings: emailValidation.warnings
                });
                return { success: false };
            }

            if (emailValidation.warnings.length > 0) {
                log.warn('Email address warnings detected', {
                    email: options.to,
                    warnings: emailValidation.warnings
                });
            }

            const spamCheck = spamChecker.checkContent(
                options.subject,
                options.html,
                options.text
            );

            if (spamCheck.isSpam) {
                log.warn('Email blocked - spam content detected', {
                    email: options.to,
                    subject: options.subject,
                    spamScore: spamCheck.score,
                    reasons: spamCheck.reasons
                });
                return { success: false };
            }

            if (this.bounceHandler.isBlacklisted(options.to)) {
                log.warn('Email not sent - recipient is blacklisted', {
                    email: options.to
                });
                return { success: false };
            }

            if (!this.isInitialized) {
                if (config.nodeEnv === 'development') {
                    log.info('[DEV MODE] Email would be sent with tracking');
                    return { success: true, messageId: `dev-${Date.now()}` };
                } else {
                    throw new Error('Email service not initialized');
                }
            }

            const mailOptions: any = {
                from: options.from || config.email.from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
                attachments: options.attachments,
                headers: {
                    'X-Mailer': 'SBC-Notification-System',
                    'List-Unsubscribe': '<mailto:unsubscribe@sniperbuisnesscenter.com>',
                    'X-Entity-Ref-ID': `sbc-${Date.now()}`,
                },
                trackingSettings: {
                    clickTracking: {
                        enable: true,
                        enableText: false
                    },
                    openTracking: {
                        enable: true
                    }
                }
            };

            const info = await this.transporter.sendMail(mailOptions);

            log.info(`Email sent with tracking to ${options.to}`, {
                messageId: info.messageId
            });

            return { success: true, messageId: info.messageId };

        } catch (error: any) {
            log.error(`Failed to send tracked email to ${options.to}`, {
                error: error.message
            });
            return { success: false };
        }
    }

    /**
     * Create a beautiful base email template
     */
    private createBaseTemplate(title: string, content: string, footerText?: string): string {
        return `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="format-detection" content="telephone=no">
            <meta name="x-apple-disable-message-reformatting">
            <!-- Mobile OTP detection meta tags -->
            <meta name="apple-mobile-web-app-capable" content="yes">
            <meta name="mobile-web-app-capable" content="yes">
            <title>${title}</title>
            <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            /* Add structured data for OTP detection */
            [data-testid="otp-code"] {
                -webkit-user-select: all;
                -moz-user-select: all;
                -ms-user-select: all;
                user-select: all;
                -webkit-touch-callout: default;
                -webkit-tap-highlight-color: rgba(0,0,0,0.1);
            }
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
            .footer img { 
                max-width: 100%; 
                height: auto; 
            }
            .button { 
                display: inline-block; 
                background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%); 
                color: white; 
                padding: 15px 30px; 
                text-decoration: none; 
                border-radius: 8px; 
                font-weight: 600; 
                box-shadow: 0 5px 15px rgba(17, 92, 246, 0.3); 
                transition: all 0.3s ease;
            }
            .button:hover { 
                transform: translateY(-2px); 
                box-shadow: 0 8px 25px rgba(17, 92, 246, 0.4); 
            }
            .highlight-box { 
                background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); 
                border-left: 5px solid #115CF6; 
                padding: 20px; 
                margin: 20px 0; 
                border-radius: 8px; 
            }
            .success-icon, .error-icon { 
                width: 60px; 
                height: 60px; 
                border-radius: 50%; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                margin: 0 auto 20px; 
                font-size: 24px; 
            }
            .success-icon { 
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); 
                box-shadow: 0 8px 25px rgba(34, 197, 94, 0.3); 
            }
            .error-icon { 
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); 
                box-shadow: 0 8px 25px rgba(239, 68, 68, 0.3); 
            }
            .amount { 
                font-size: 28px; 
                font-weight: 700; 
                color: #115CF6; 
                margin: 10px 0; 
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
                .amount { 
                    font-size: 24px; 
                }
            }
        </style>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f5f7fa;">
            <div class="email-container">
                <div class="header">
                    <img src="${config.app.appLogoUrl}" alt="Sniper Business Center" style="height: 60px; width: auto; object-fit: contain; margin-bottom: 10px;" />
                    <p>Votre plateforme de confiance</p>
                </div>
                <div class="content">
                    ${content}
                </div>
                <div class="footer">
                    <img src="${config.app.appLogoUrl}" alt="Sniper Business Center" style="height: 40px; width: auto; object-fit: contain; margin-bottom: 10px;" />
                    <p><strong>Sniper Business Center</strong></p>
                    <p>Développé par Simbtech © ${new Date().getFullYear()}</p>
                    <p>Cameroun - Yaoundé</p>
                    ${footerText ? `<p style="margin-top: 15px; color: #495057;">${footerText}</p>` : ''}
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Send Commission Earned Email - Updated with beautiful template
     */
    async sendCommissionEarnedEmail(data: CommissionEmailData): Promise<boolean> {
        // Validate that data is provided
        if (!data.email || !data.name || data.amount === undefined || !data.currency) {
            log.error('Missing required data for commission earned email:', { data });
            return false;
        }

        const content = `
            <div style="text-align: center;">
                <div class="success-icon">
                    <span style="color: white; font-size: 24px;">🎉</span>
                </div>
            </div>
            
            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
                Commission Reçue !
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #004d7a;">${data.name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Excellente nouvelle ! Vous avez reçu une commission de parrainage qui vient d'être créditée sur votre compte.
            </p>
            
            <div class="highlight-box">
                <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    💰 Commission Reçue
                </h3>
                <div class="amount" style="text-align: center;">
                    ${data.amount} ${data.currency}
                </div>
                <p style="text-align: center; color: #666; font-size: 16px;">
                    Niveau de parrainage: <strong>${data.level}</strong>
                </p>
                ${data.debt ? `<p style="text-align: center; color: #666; font-size: 14px; margin-top: 10px;">
                    Solde restant: ${data.debt} ${data.currency}
                </p>` : ''}
            </div>
            
            <p style="font-size: 16px; color: #555; margin: 25px 0;">
                Cette commission a été automatiquement ajoutée à votre solde SBC. Vous pouvez maintenant l'utiliser pour vos achats ou la retirer.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/wallet" class="button">
                    Voir mon solde
                </a>
        </div>
            
            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Continuez à parrainer pour gagner plus de commissions ! 🚀
            </p>
        `;

        const emailHtml = this.createBaseTemplate(
            'Commission Reçue - Sniper Business Center',
            content,
            'Merci de faire partie de la famille Sniper Business Center!'
        );

        try {
            const result = await this.sendEmail({
                to: data.email,
                subject: `🎉 Commission reçue: ${data.amount} ${data.currency}`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`Commission email sent successfully to ${data.email}`);
            return result;
        } catch (error) {
            log.error(`Failed to send commission email to ${data.email}:`, error);
            return false;
        }
    }

    /**
     * Send Transaction Success Email - Updated with beautiful template
     */
    async sendTransactionSuccessEmail(data: TransactionSuccessEmailData): Promise<boolean> {
        const content = `
            <div style="text-align: center;">
                <div class="success-icon">
                    <span style="color: white; font-size: 24px;">✅</span>
                </div>
            </div>
            
            <h2 style="color: #4caf50; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
                Transaction Réussie
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #4caf50;">${data.name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Votre transaction a été traitée avec succès.
            </p>
            
            <div class="highlight-box">
                <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    💰 Détails de la Transaction
                </h3>
                <p style="margin: 5px 0;">Type: <strong>${data.transactionType}</strong></p>
                <p style="margin: 5px 0;">Montant: <strong>${data.amount} ${data.currency}</strong></p>
                <p style="margin: 5px 0;">ID: <strong>${data.transactionId}</strong></p>
                <p style="margin: 5px 0;">Date: <strong>${new Date().toLocaleString('fr-FR')}</strong></p>
            </div>
            
            <p style="font-size: 16px; color: #555; margin: 25px 0;">
                Merci de faire confiance à Sniper Business Center pour vos transactions.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/wallet" class="button">
                    Voir mes transactions
                </a>
            </div>
            
            <p style="font-size: 16px; color: #4caf50; text-align: center; font-weight: 500;">
                Continuez vos achats et parrainage ! 🚀
            </p>
        `;

        const emailHtml = this.createBaseTemplate(
            'Confirmation de transaction - Sniper Business Center',
            content,
            'Votre satisfaction est notre priorité.'
        );

        try {
            const result = await this.sendEmail({
                to: data.email,
                subject: `✅ Confirmation de transaction: ${data.transactionType}`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`Transaction successful email sent successfully to ${data.email}`);
            return result;
        } catch (error) {
            log.error(`Failed to send transaction successful email to ${data.email}:`, error);
            return false;
        }
    }

    /**
     * Send Transaction Failure Email - Updated with beautiful template
     */
    async sendTransactionFailureEmail(data: TransactionFailureEmailData): Promise<boolean> {
        const content = `
            <div style="text-align: center;">
                <div class="error-icon">
                    <span style="color: white; font-size: 24px;">❌</span>
                </div>
            </div>
            
            <h2 style="color: #f44336; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
                Transaction Échouée
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #f44336;">${data.name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Nous vous informons malheureusement qu'une transaction a échoué. Voici les détails :
            </p>
            
            <div style="background: linear-gradient(135deg, #ffebee 0%, #fce4ec 100%); border-left: 5px solid #f44336; padding: 20px; margin: 25px 0; border-radius: 8px;">
                <h3 style="color: #c62828; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    ⚠️ Détails de la Transaction
                </h3>
                <p style="margin: 8px 0; font-size: 16px;"><strong>Type:</strong> ${data.transactionType}</p>
                <p style="margin: 8px 0; font-size: 16px;"><strong>Montant:</strong> ${data.amount} ${data.currency}</p>
                <p style="margin: 8px 0; font-size: 16px;"><strong>ID Transaction:</strong> ${data.transactionId}</p>
                <p style="margin: 8px 0; font-size: 16px;"><strong>Date:</strong> ${data.date}</p>
                ${data.reason ? `<p style="margin: 8px 0; font-size: 16px;"><strong>Raison:</strong> ${data.reason}</p>` : ''}
                ${data.productOrServiceName ? `<p style="margin: 8px 0; font-size: 16px;"><strong>Service:</strong> ${data.productOrServiceName}</p>` : ''}
            </div>
            
            <p style="font-size: 16px; color: #555; margin: 25px 0;">
                Si vous pensez qu'il s'agit d'une erreur ou si vous avez des questions, n'hésitez pas à contacter notre équipe de support.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.supportUrl || 'https://www.whatsapp.com/channel/0029Vav3mvCElah05C8QuT03'}/" class="button" style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);">
                    Contacter le Support
                </a>
        </div>
            
            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Nous nous excusons pour ce désagrément et restons à votre disposition.
            </p>
        `;

        const emailHtml = this.createBaseTemplate(
            'Échec de Transaction - Sniper Business Center',
            content,
            'Notre équipe support est disponible 24h/7j pour vous aider.'
        );

        try {
            const result = await this.sendEmail({
                to: data.email,
                subject: `❌ Échec de transaction: ${data.transactionType}`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`Transaction failure email sent successfully to ${data.email}`);
            return result;
        } catch (error: any) {
            log.error(`Failed to send transaction failure email to ${data.email}:`, error);
            return false;
        }
    }

    /**
     * Send OTP Email for Authentication
     */
    async sendOTPEmail(email: string, name: string, otpCode: string, purpose: string = 'verification'): Promise<boolean> {
        const purposeTexts = {
            'verification': 'Vérification de votre compte',
            'login': 'Connexion à votre compte',
            'register': 'Création de votre compte',
            'forgotPassword': 'Réinitialisation de mot de passe',
            'changeEmail': 'Changement d\'adresse email'
        };

        const purposeText = purposeTexts[purpose as keyof typeof purposeTexts] || 'Vérification';

        const content = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); border-radius: 50%; margin: 0 auto 25px; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 32px; line-height: 1;">🔐</span>
                        </td>
                    </tr>
                </table>
            </div>
            
            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
                Code de Vérification
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #004d7a;">${name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Voici votre code de vérification pour <strong>${purposeText.toLowerCase()}</strong> :
            </p>
            
            <div style="background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%); border-left: 5px solid #004d7a; padding: 30px; margin: 25px 0; border-radius: 12px; text-align: center;">
                <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 20px;">
                    🔑 Votre Code OTP
                </h3>
                <!-- Mobile-friendly OTP code with structured data -->
                <div style="font-size: 36px; font-weight: 700; color: #004d7a; letter-spacing: 8px; font-family: 'Courier New', monospace; background: white; padding: 20px; border-radius: 8px; border: 2px dashed #004d7a;" id="otp-code" data-testid="otp-code">
                    ${otpCode}
                </div>
                <!-- Additional mobile-friendly format for better detection -->
                <div style="display: none;">Your verification code is ${otpCode}</div>
                <div style="display: none;">OTP: ${otpCode}</div>
                <div style="display: none;">Code: ${otpCode}</div>
                <div style="display: none;">${otpCode} is your verification code</div>
                <p style="margin: 15px 0 0 0; color: #666; font-size: 14px;">
                    Ce code expire dans <strong>10 minutes</strong>
                </p>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 25px 0;">
                <p style="margin: 0; color: #856404; font-size: 15px;">
                    <strong>⚠️ Important :</strong> Ne partagez jamais ce code avec qui que ce soit. L'équipe SBC ne vous demandera jamais votre code OTP.
                </p>
            </div>
            
            <p style="font-size: 16px; color: #555; margin: 25px 0;">
                Si vous n'avez pas demandé ce code, ignorez cet email ou contactez notre support si vous avez des préoccupations.
            </p>
            
            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Merci de votre confiance ! 🚀
            </p>
        `;

        const emailHtml = this.createBaseTemplate(
            `Code OTP - ${purposeText}`,
            content,
            'Votre sécurité est notre priorité absolue.'
        );

        try {
            const result = await this.sendEmail({
                to: email,
                subject: `${otpCode} is your SBC verification code`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`OTP email sent successfully to ${email} for ${purpose}`);
            return result;
        } catch (error: any) {
            log.error(`Failed to send OTP email to ${email}:`, error);
            return false;
        }
    }

    /**
     * Send Welcome Email for New Users
     */
    async sendWelcomeEmail(data: {
        email: string;
        name: string;
        referralCode?: string;
        referrerName?: string;
        language?: 'fr' | 'en';
    }): Promise<boolean> {
        const { email, name, referralCode, referrerName, language = 'fr' } = data;
        const isFrench = language === 'fr';
        const frontendUrl = config.app.frontendUrl || 'https://sniperbuisnesscenter.com';

        const frenchContent = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); border-radius: 50%; margin: 0 auto 25px; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 32px; line-height: 1;">🎉</span>
                        </td>
                    </tr>
                </table>
            </div>

            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 32px; font-weight: 700;">
                Bienvenue dans la famille SBC !
            </h2>

            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #004d7a;">${name}</strong>,
            </p>

            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Félicitations ! Votre compte <strong>Sniper Business Center</strong> a été créé avec succès.
                ${referrerName ? `Vous avez été invité(e) par <strong style="color: #004d7a;">${referrerName}</strong>.` : ''}
                Vous faites maintenant partie d'une communauté dynamique d'entrepreneurs et d'affiliés.
            </p>

            ${referralCode ? `
            <div style="background: linear-gradient(135deg, #e8f5e8 0%, #f1f8e9 100%); border-left: 5px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 8px;">
                <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    🎁 Votre Code de Parrainage
                </h3>
                <div style="font-size: 24px; font-weight: 700; color: #2e7d32; text-align: center; font-family: 'Courier New', monospace; background: white; padding: 15px; border-radius: 8px; border: 2px dashed #4caf50;">
                    ${referralCode}
                </div>
                <p style="text-align: center; color: #666; font-size: 14px; margin: 10px 0 0 0;">
                    Partagez ce code pour gagner des commissions !
                </p>
            </div>
            ` : ''}

            <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 30px 0;">
                <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 22px; text-align: center;">
                    🚀 Comment bien démarrer
                </h3>
                <div style="text-align: left;">
                    <p style="margin: 12px 0; font-size: 16px;"><strong>1.</strong> 💳 <strong>Activez votre compte</strong> en souscrivant à un abonnement (Classique ou Ciblé)</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>2.</strong> 📱 <strong>Rejoignez nos canaux</strong> WhatsApp et Telegram pour les formations</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>3.</strong> 👥 <strong>Parrainez vos proches</strong> avec votre code et gagnez des commissions</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>4.</strong> 💰 <strong>Développez votre réseau</strong> et augmentez vos revenus</p>
                </div>
            </div>

            <!-- WhatsApp Channel -->
            <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📱 Rejoins la chaîne WhatsApp de la SBC
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Pour être informé de toutes les mises à jour et nouveautés en temps réel
                </p>
                <div style="text-align: center;">
                    <a href="https://whatsapp.com/channel/0029Vav3mvCElah05C8QuT03"
                       style="display: inline-block; background: white; color: #25D366; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        📲 Suivre la chaîne SBC sur WhatsApp
                    </a>
                </div>
            </div>

            <!-- Telegram - Platform Guide -->
            <div style="background: linear-gradient(135deg, #0088cc 0%, #0077b5 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📚 Canal de prise en main de l'application
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Apprends comment utiliser la plateforme SBC
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/sniperbusinesscenterafrica"
                       style="display: inline-block; background: white; color: #0088cc; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🎓 J'apprends à utiliser la plateforme SBC
                    </a>
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="${frontendUrl}/" class="button">
                    Accéder à mon tableau de bord
                </a>
            </div>

            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Prêt à commencer votre aventure entrepreneuriale ? 🌟
            </p>
        `;

        const englishContent = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); border-radius: 50%; margin: 0 auto 25px; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 32px; line-height: 1;">🎉</span>
                        </td>
                    </tr>
                </table>
            </div>

            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 32px; font-weight: 700;">
                Welcome to the SBC family!
            </h2>

            <p style="font-size: 18px; margin-bottom: 15px;">
                Hello <strong style="color: #004d7a;">${name}</strong>,
            </p>

            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Congratulations! Your <strong>Sniper Business Center</strong> account has been created successfully.
                ${referrerName ? `You were invited by <strong style="color: #004d7a;">${referrerName}</strong>.` : ''}
                You are now part of a dynamic community of entrepreneurs and affiliates.
            </p>

            ${referralCode ? `
            <div style="background: linear-gradient(135deg, #e8f5e8 0%, #f1f8e9 100%); border-left: 5px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 8px;">
                <h3 style="color: #2e7d32; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    🎁 Your Referral Code
                </h3>
                <div style="font-size: 24px; font-weight: 700; color: #2e7d32; text-align: center; font-family: 'Courier New', monospace; background: white; padding: 15px; border-radius: 8px; border: 2px dashed #4caf50;">
                    ${referralCode}
                </div>
                <p style="text-align: center; color: #666; font-size: 14px; margin: 10px 0 0 0;">
                    Share this code to earn commissions!
                </p>
            </div>
            ` : ''}

            <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin: 30px 0;">
                <h3 style="color: #004d7a; margin-bottom: 20px; font-size: 22px; text-align: center;">
                    🚀 How to Get Started
                </h3>
                <div style="text-align: left;">
                    <p style="margin: 12px 0; font-size: 16px;"><strong>1.</strong> 💳 <strong>Activate your account</strong> by subscribing (Classic or Targeted)</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>2.</strong> 📱 <strong>Join our channels</strong> on WhatsApp and Telegram for training</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>3.</strong> 👥 <strong>Refer your friends</strong> with your code and earn commissions</p>
                    <p style="margin: 12px 0; font-size: 16px;"><strong>4.</strong> 💰 <strong>Build your network</strong> and increase your income</p>
                </div>
            </div>

            <!-- WhatsApp Channel -->
            <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📱 Join the SBC WhatsApp Channel
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Stay informed about all updates and news in real time
                </p>
                <div style="text-align: center;">
                    <a href="https://whatsapp.com/channel/0029Vav3mvCElah05C8QuT03"
                       style="display: inline-block; background: white; color: #25D366; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        📲 Follow SBC on WhatsApp
                    </a>
                </div>
            </div>

            <!-- Telegram - Platform Guide -->
            <div style="background: linear-gradient(135deg, #0088cc 0%, #0077b5 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📚 Platform Guide Channel
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Learn how to use the SBC platform
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/sniperbusinesscenterafrica"
                       style="display: inline-block; background: white; color: #0088cc; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🎓 Learn to use the SBC platform
                    </a>
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="${frontendUrl}/" class="button">
                    Access my dashboard
                </a>
            </div>

            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Ready to start your entrepreneurial adventure? 🌟
            </p>
        `;

        const content = isFrench ? frenchContent : englishContent;

        const emailHtml = this.createBaseTemplate(
            isFrench ? 'Bienvenue chez Sniper Business Center' : 'Welcome to Sniper Business Center',
            content,
            isFrench ? 'Ensemble, construisons votre succès entrepreneurial !' : 'Together, let\'s build your entrepreneurial success!'
        );

        try {
            const result = await this.sendEmail({
                to: email,
                subject: isFrench
                    ? `🎉 Bienvenue chez SBC, ${name} !`
                    : `🎉 Welcome to SBC, ${name}!`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`Welcome email sent successfully to ${email}`);
            return result;
        } catch (error: any) {
            log.error(`Failed to send welcome email to ${email}:`, error);
            return false;
        }
    }

    /**
     * Send Contact Export Email with VCF attachment
     */
    async sendContactExportEmail(email: string, name: string, vcfContent: string, fileName: string = 'contacts.vcf'): Promise<boolean> {
        const content = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 90px; height: 90px; background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%); border-radius: 20px; margin: 0 auto 30px; box-shadow: 0 10px 30px rgba(17, 92, 246, 0.25); border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 36px; line-height: 1; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">📥</span>
                        </td>
                    </tr>
                </table>
            </div>
            
            <h1 style="color: #115CF6; text-align: center; margin-bottom: 25px; font-size: 32px; font-weight: 700; text-shadow: 0 2px 4px rgba(17, 92, 246, 0.1);">
                Export de Contacts Terminé ✨
            </h1>
            
            <p style="font-size: 18px; margin-bottom: 15px; color: #1a1a1a;">
                Bonjour <strong style="color: #115CF6; font-weight: 700;">${name}</strong> ! 👋
            </p>
            
            <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 30px; line-height: 1.6;">
                Excellente nouvelle ! Votre demande d'export de contacts a été <strong style="color: #22c55e;">traitée avec succès</strong>. 
                Vous trouverez en pièce jointe le fichier VCF contenant tous vos contacts exportés.
            </p>
            
            <div style="background: linear-gradient(135deg, #f8faff 0%, #eff6ff 100%); border: 2px solid #115CF6; border-radius: 16px; padding: 25px; margin: 30px 0; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -10px; right: -10px; width: 40px; height: 40px; background: #115CF6; border-radius: 50%; opacity: 0.1;"></div>
                <h3 style="color: #115CF6; margin-bottom: 20px; font-size: 22px; text-align: center; font-weight: 700;">
                    📊 Détails de l'Export
                </h3>
                <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(17, 92, 246, 0.08); border: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        <span style="font-weight: 600; color: #374151;">📎 Fichier:</span>
                        <span style="color: #115CF6; font-family: 'Courier New', monospace; font-weight: 600;">${fileName}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        <span style="font-weight: 600; color: #374151;">🗂️ Format:</span>
                        <span style="color: #22c55e; font-weight: 600;">VCF (vCard)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 8px 0;">
                        <span style="font-weight: 600; color: #374151;">📅 Date:</span>
                        <span style="color: #6b7280; font-weight: 500;">${new Date().toLocaleString('fr-FR')}</span>
                    </div>
                </div>
            </div>
            
            <div style="background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%); border: 2px solid #fb923c; border-radius: 16px; padding: 20px; margin: 30px 0;">
                <table role="presentation" style="width: 100%; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="width: 55px; vertical-align: top; padding-right: 15px;">
                            <table role="presentation" style="width: 40px; height: 40px; background: #fb923c; border-radius: 50%; box-shadow: 0 4px 10px rgba(251, 146, 60, 0.2); border-collapse: collapse;" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="text-align: center; vertical-align: middle;">
                                        <span style="color: white; font-size: 20px; font-weight: bold; line-height: 1;">💡</span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                        <td style="vertical-align: top;">
                        <h4 style="color: #ea580c; margin: 0 0 8px 0; font-size: 16px; font-weight: 700;">
                            Conseil Pro
                        </h4>
                        <p style="margin: 0; color: #c2410c; font-size: 15px; line-height: 1.5;">
                            Vous pouvez importer ce fichier VCF directement dans votre carnet d'adresses,
                            <strong>Outlook</strong>, <strong>Gmail</strong> ou votre <strong>téléphone mobile</strong> pour synchroniser tous vos contacts.
                        </p>
                        </td>
                    </tr>
                </table>
            </div>
            
            <div style="background: linear-gradient(135deg, #f8faff 0%, #eff6ff 100%); border-radius: 16px; padding: 25px; margin: 30px 0; text-align: center; border: 1px solid #dbeafe;">
                <h3 style="color: #115CF6; margin-bottom: 15px; font-size: 20px; font-weight: 700;">
                    📱 Comment utiliser votre fichier VCF ?
                </h3>
                <div style="text-align: left; max-width: 400px; margin: 0 auto;">
                    <p style="margin: 8px 0; font-size: 15px; color: #374151;">📧 <strong>Gmail:</strong> Importez via les Contacts Google</p>
                    <p style="margin: 8px 0; font-size: 15px; color: #374151;">📮 <strong>Outlook:</strong> Fichier → Importer et Exporter</p>
                    <p style="margin: 8px 0; font-size: 15px; color: #374151;">📱 <strong>iPhone:</strong> Partagez le fichier avec l’application contacts de votre iPhone</p>
                    <p style="margin: 8px 0; font-size: 15px; color: #374151;">🤖 <strong>Android:</strong> Ouvrez avec l'application Contacts</p>
                </div>
            </div>
            
            <p style="font-size: 16px; color: #6b7280; margin: 30px 0; text-align: center; line-height: 1.6;">
                Si vous avez des questions sur l'utilisation du fichier VCF ou si vous rencontrez des problèmes, 
                n'hésitez pas à <strong style="color: #115CF6;">contacter notre support</strong>. Nous sommes là pour vous aider ! 🤝
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/contacts" 
                   style="background: linear-gradient(135deg, #115CF6 0%, #2C7BE5 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 16px; box-shadow: 0 10px 30px rgba(17, 92, 246, 0.25); transition: all 0.3s ease; display: inline-block; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    📞 Retour aux Contacts
                </a>
            </div>
            
            <div style="text-align: center; margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #f8faff 0%, #eff6ff 100%); border-radius: 12px; border: 1px solid #dbeafe;">
                <p style="font-size: 16px; color: #115CF6; font-weight: 700; margin: 0;">
                    Votre réseau est votre richesse - exploitez-le au maximum ! 🚀✨
                </p>
            </div>
        `;

        const emailHtml = this.createBaseTemplate(
            'Export de Contacts - Sniper Business Center',
            content,
            'Votre réuseau est votre richesse - exploitez-le au maximum !'
        );

        try {
            const result = await this.sendEmail({
                to: email,
                subject: `📁 Export de contacts terminé - ${fileName}`,
                html: emailHtml,
                from: config.email.from,
                attachments: [
                    {
                        filename: fileName,
                        content: vcfContent,
                        contentType: 'text/vcard'
                    }
                ]
            });

            log.info(`Contact export email sent successfully to ${email}`);
            return result;
        } catch (error: any) {
            log.error(`Failed to send contact export email to ${email}:`, error);
            return false;
        }
    }

    /**
     * Send Account Activation Email - Sent when user's subscription is activated
     */
    async sendAccountActivationEmail(data: {
        email: string;
        name: string;
        subscriptionType: 'CLASSIQUE' | 'CIBLE' | 'UPGRADE';
        sponsorName?: string; // If sponsored by someone
        language?: 'fr' | 'en'; // Language preference
    }): Promise<boolean> {
        const { email, name, subscriptionType, sponsorName, language = 'fr' } = data;

        const isFrench = language === 'fr';

        // Determine subscription display name
        const subscriptionInfo = {
            CLASSIQUE: {
                displayName: isFrench ? 'Pack Classique' : 'Classic Pack',
                color: '#115CF6',
                icon: '🎯',
            },
            CIBLE: {
                displayName: isFrench ? 'Pack Ciblé' : 'Targeted Pack',
                color: '#22c55e',
                icon: '🚀',
            },
            UPGRADE: {
                displayName: isFrench ? 'Pack Ciblé' : 'Targeted Pack',
                color: '#22c55e',
                icon: '⬆️',
            }
        };

        const info = subscriptionInfo[subscriptionType];
        const isUpgrade = subscriptionType === 'UPGRADE';

        // French content
        const frenchContent = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, ${info.color} 0%, ${info.color}dd 100%); border-radius: 50%; margin: 0 auto 25px; box-shadow: 0 10px 30px ${info.color}40; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 36px; line-height: 1;">🎉</span>
                        </td>
                    </tr>
                </table>
            </div>

            <h2 style="color: ${info.color}; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 700;">
                Bienvenue ${name} !
            </h2>

            <p style="font-size: 18px; color: #555; margin-bottom: 25px; text-align: center;">
                ${sponsorName
                    ? `<strong>${sponsorName}</strong> a ${isUpgrade ? 'mis à niveau' : 'activé'} votre compte avec le <strong>${info.displayName}</strong>.`
                    : `Votre ${isUpgrade ? 'mise à niveau vers le' : 'activation du'} <strong>${info.displayName}</strong> a été effectuée avec succès.`
                }
            </p>

            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 16px; padding: 25px; margin: 25px 0; text-align: center;">
                <p style="font-size: 18px; color: #1e40af; margin: 0; font-weight: 600;">
                    🌟 Bienvenue à la Sniper Business Center, cette communauté qui t'apprend à gagner de l'argent sur internet !
                </p>
            </div>

            ${sponsorName ? `
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                <p style="color: #92400e; font-size: 16px; margin: 0;">
                    <strong>🙏 Remerciez ${sponsorName}</strong> pour ce cadeau !
                </p>
            </div>
            ` : ''}

            <!-- WhatsApp Channel -->
            <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📱 Rejoins la chaîne WhatsApp de la SBC
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Pour être informé de toutes les mises à jour et nouveautés en temps réel
                </p>
                <div style="text-align: center;">
                    <a href="https://whatsapp.com/channel/0029Vav3mvCElah05C8QuT03"
                       style="display: inline-block; background: white; color: #25D366; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        📲 Suivre la chaîne SNIPER BUSINESS CENTER sur WhatsApp
                    </a>
                </div>
            </div>

            <!-- Telegram - Platform Guide -->
            <div style="background: linear-gradient(135deg, #0088cc 0%, #0077b5 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📚 Canal de prise en main de l'application
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Apprends comment utiliser la plateforme SBC
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/sniperbusinesscenterafrica"
                       style="display: inline-block; background: white; color: #0088cc; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🎓 J'apprends à utiliser la plateforme SBC
                    </a>
                </div>
            </div>

            <!-- Telegram - Digital Products Training -->
            <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    💰 Formation Revente des Produits Digitaux
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Apprends comment générer entre 5 000 et 10 000 FCFA/jour !
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/+XswAxOO1fT1iZTU0"
                       style="display: inline-block; background: white; color: #d97706; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🚀 Rejoindre la formation en revente des produits digitaux
                    </a>
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/" class="button">
                    Accéder à mon compte
                </a>
            </div>

            <p style="font-size: 16px; color: ${info.color}; text-align: center; font-weight: 500;">
                Bienvenue dans la famille SBC ! Commencez à développer votre réseau dès maintenant. 🌟
            </p>
        `;

        // English content
        const englishContent = `
            <div style="text-align: center;">
                <table role="presentation" style="width: 80px; height: 80px; background: linear-gradient(135deg, ${info.color} 0%, ${info.color}dd 100%); border-radius: 50%; margin: 0 auto 25px; box-shadow: 0 10px 30px ${info.color}40; border-collapse: collapse;" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="text-align: center; vertical-align: middle;">
                            <span style="color: white; font-size: 36px; line-height: 1;">🎉</span>
                        </td>
                    </tr>
                </table>
            </div>

            <h2 style="color: ${info.color}; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 700;">
                Welcome ${name}!
            </h2>

            <p style="font-size: 18px; color: #555; margin-bottom: 25px; text-align: center;">
                ${sponsorName
                    ? `<strong>${sponsorName}</strong> has ${isUpgrade ? 'upgraded' : 'activated'} your account with the <strong>${info.displayName}</strong>.`
                    : `Your ${isUpgrade ? 'upgrade to' : 'activation of'} the <strong>${info.displayName}</strong> has been completed successfully.`
                }
            </p>

            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 16px; padding: 25px; margin: 25px 0; text-align: center;">
                <p style="font-size: 18px; color: #1e40af; margin: 0; font-weight: 600;">
                    🌟 Welcome to Sniper Business Center, the community that teaches you how to make money online!
                </p>
            </div>

            ${sponsorName ? `
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                <p style="color: #92400e; font-size: 16px; margin: 0;">
                    <strong>🙏 Thank ${sponsorName}</strong> for this gift!
                </p>
            </div>
            ` : ''}

            <!-- WhatsApp Channel -->
            <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📱 Join the SBC WhatsApp Channel
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Stay informed about all updates and news in real time
                </p>
                <div style="text-align: center;">
                    <a href="https://whatsapp.com/channel/0029Vav3mvCElah05C8QuT03"
                       style="display: inline-block; background: white; color: #25D366; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        📲 Follow SNIPER BUSINESS CENTER on WhatsApp
                    </a>
                </div>
            </div>

            <!-- Telegram - Platform Guide -->
            <div style="background: linear-gradient(135deg, #0088cc 0%, #0077b5 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    📚 Platform Guide Channel
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Learn how to use the SBC platform
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/sniperbusinesscenterafrica"
                       style="display: inline-block; background: white; color: #0088cc; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🎓 Learn to use the SBC platform
                    </a>
                </div>
            </div>

            <!-- Telegram - Digital Products Training -->
            <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; padding: 25px; margin: 25px 0;">
                <h3 style="color: white; margin-bottom: 15px; font-size: 18px; text-align: center;">
                    💰 Digital Products Resale Training
                </h3>
                <p style="color: rgba(255,255,255,0.9); font-size: 14px; text-align: center; margin-bottom: 20px;">
                    Learn how to generate between $8 and $16 per day!
                </p>
                <div style="text-align: center;">
                    <a href="https://t.me/+XswAxOO1fT1iZTU0"
                       style="display: inline-block; background: white; color: #d97706; padding: 14px 28px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                        🚀 Join the digital products resale training
                    </a>
                </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/" class="button">
                    Access my account
                </a>
            </div>

            <p style="font-size: 16px; color: ${info.color}; text-align: center; font-weight: 500;">
                Welcome to the SBC family! Start building your network now. 🌟
            </p>
        `;

        const content = isFrench ? frenchContent : englishContent;

        const emailHtml = this.createBaseTemplate(
            isFrench
                ? (isUpgrade ? 'Compte Mis à Niveau - Sniper Business Center' : 'Compte Activé - Sniper Business Center')
                : (isUpgrade ? 'Account Upgraded - Sniper Business Center' : 'Account Activated - Sniper Business Center'),
            content,
            isFrench ? 'Votre succès est notre priorité !' : 'Your success is our priority!'
        );

        try {
            const result = await this.sendEmail({
                to: email,
                subject: isFrench
                    ? `${info.icon} Bienvenue ${name} ! ${isUpgrade ? 'Compte mis à niveau' : 'Compte activé'} - ${info.displayName}`
                    : `${info.icon} Welcome ${name}! ${isUpgrade ? 'Account upgraded' : 'Account activated'} - ${info.displayName}`,
                html: emailHtml,
                from: config.email.from
            });

            log.info(`Account activation email sent successfully to ${email}`);
            return result;
        } catch (error: any) {
            log.error(`Failed to send account activation email to ${email}:`, error);
            return false;
        }
    }
}

// Export service instance
export const emailService = new EmailService(); 