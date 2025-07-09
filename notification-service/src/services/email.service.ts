import * as nodemailer from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';
import { Attachment } from 'nodemailer/lib/mailer';
import { BounceHandlerService } from './bounceHandler.service';

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
     * Enhanced email sending with bounce checking
     */
    async sendEmail(options: EmailOptions): Promise<boolean> {
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
            const mailOptions = {
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
     * Create a beautiful base email template
     */
    private createBaseTemplate(title: string, content: string, footerText?: string): string {
        return `
        <!DOCTYPE html>
        <html lang="fr" style="margin: 0; padding: 0;">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Inter', 'Segoe UI', 'Roboto', sans-serif; line-height: 1.6; color: #333; }
                .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; }
                .header { background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); padding: 30px 20px; text-align: center; }
                .header h1 { color: #ffffff; font-size: 28px; font-weight: 600; margin-bottom: 8px; }
                .header p { color: #e1f5fe; font-size: 16px; font-weight: 300; }
                .content { padding: 40px 30px; background: #ffffff; }
                .highlight-box { background: linear-gradient(135deg, #e8f5e8 0%, #f1f8e9 100%); border-left: 5px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 8px; }
                .amount { font-size: 24px; font-weight: 700; color: #2e7d32; margin: 10px 0; }
                .button { display: inline-block; background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); color: #ffffff !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; transition: all 0.3s ease; }
                .footer { background: #f8f9fa; padding: 25px 20px; text-align: center; border-top: 1px solid #e9ecef; }
                .footer p { color: #6c757d; font-size: 14px; margin: 5px 0; }
                .success-icon { width: 60px; height: 60px; background: #4caf50; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }
                .warning-icon { width: 60px; height: 60px; background: #ff9800; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }
                .error-icon { width: 60px; height: 60px; background: #f44336; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }
                @media (max-width: 600px) {
                    .content { padding: 20px 15px; }
                    .header { padding: 20px 15px; }
                    .header h1 { font-size: 24px; }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f5f7fa;">
            <div class="email-container">
                <div class="header">
                    <h1>Sniper Business Center</h1>
                    <p>Votre plateforme de confiance</p>
                </div>
                <div class="content">
                    ${content}
                </div>
                <div class="footer">
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
                <a href="${config.app.frontendUrl || 'https://sniperbuisnesscenter.com'}/" class="button">
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
                <a href="${config.app.frontendUrl || 'https://app.sniperbuisnesscenter.com'}/dashboard" class="button">
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
                <a href="${config.app.frontendUrl || 'https://app.sniperbuisnesscenter.com'}/support" class="button" style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);">
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
                <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #004d7a 0%, #006ba8 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center;">
                    <span style="color: white; font-size: 32px;">🔐</span>
                </div>
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
                <div style="font-size: 36px; font-weight: 700; color: #004d7a; letter-spacing: 8px; font-family: 'Courier New', monospace; background: white; padding: 20px; border-radius: 8px; border: 2px dashed #004d7a;">
                    ${otpCode}
                </div>
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
                subject: `🔐 Code de vérification SBC: ${otpCode}`,
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
    async sendWelcomeEmail(email: string, name: string, referralCode?: string): Promise<boolean> {
        const content = `
            <div style="text-align: center;">
                <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center;">
                    <span style="color: white; font-size: 32px;">🎉</span>
                </div>
            </div>
            
            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 32px; font-weight: 700;">
                Bienvenue dans la famille SBC !
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #004d7a;">${name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Félicitations ! Votre compte <strong>Sniper Business Center</strong> a été créé avec succès. 
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
                    🚀 Prochaines Étapes
                </h3>
                <div style="text-align: left;">
                    <p style="margin: 10px 0; font-size: 16px;">✅ <strong>Complétez votre profil</strong> pour une meilleure expérience</p>
                    <p style="margin: 10px 0; font-size: 16px;">🛍️ <strong>Explorez nos produits</strong> et services exclusifs</p>
                    <p style="margin: 10px 0; font-size: 16px;">👥 <strong>Invitez vos amis</strong> et gagnez des commissions</p>
                    <p style="margin: 10px 0; font-size: 16px;">💰 <strong>Commencez à gagner</strong> dès aujourd'hui</p>
                </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://app.sniperbuisnesscenter.com'}/dashboard" class="button">
                    Accéder à mon tableau de bord
                </a>
            </div>
            
            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Prêt à commencer votre aventure entrepreneuriale ? 🌟
            </p>
        `;

        const emailHtml = this.createBaseTemplate(
            'Bienvenue chez Sniper Business Center',
            content,
            'Ensemble, construisons votre succès entrepreneurial !'
        );

        try {
            const result = await this.sendEmail({
                to: email,
                subject: `🎉 Bienvenue chez SBC, ${name} !`,
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
                <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #2196f3 0%, #42a5f5 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center;">
                    <span style="color: white; font-size: 32px;">📁</span>
                </div>
            </div>
            
            <h2 style="color: #004d7a; text-align: center; margin-bottom: 20px; font-size: 28px; font-weight: 600;">
                Export de Contacts Terminé
            </h2>
            
            <p style="font-size: 18px; margin-bottom: 15px;">
                Bonjour <strong style="color: #004d7a;">${name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #555; margin-bottom: 25px;">
                Votre demande d'export de contacts a été traitée avec succès. Vous trouverez en pièce jointe le fichier VCF contenant vos contacts.
            </p>
            
            <div style="background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%); border-left: 5px solid #2196f3; padding: 20px; margin: 25px 0; border-radius: 8px;">
                <h3 style="color: #1976d2; margin-bottom: 15px; font-size: 20px; text-align: center;">
                    📋 Détails de l'Export
                </h3>
                <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Fichier:</strong> ${fileName}</p>
                <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Format:</strong> VCF (vCard)</p>
                <p style="margin: 8px 0; font-size: 16px; text-align: center;"><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 25px 0;">
                <p style="margin: 0; color: #856404; font-size: 15px;">
                    <strong>💡 Astuce :</strong> Vous pouvez importer ce fichier VCF directement dans votre carnet d'adresses, Outlook, Gmail ou votre téléphone.
                </p>
            </div>
            
            <p style="font-size: 16px; color: #555; margin: 25px 0;">
                Si vous avez des questions sur l'utilisation du fichier VCF ou si vous rencontrez des problèmes, n'hésitez pas à contacter notre support.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${config.app.frontendUrl || 'https://app.sniperbuisnesscenter.com'}/contacts" class="button">
                    Retour aux Contacts
                </a>
            </div>
            
            <p style="font-size: 16px; color: #004d7a; text-align: center; font-weight: 500;">
                Merci d'utiliser nos services ! 📞
            </p>
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
}

// Export service instance
export const emailService = new EmailService(); 