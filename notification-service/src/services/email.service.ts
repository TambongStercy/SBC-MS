import nodemailer from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';

// Create a component-specific logger
const log = logger.getLogger('EmailService');

// Interface for email options
interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
}

interface CommissionEmailData {
    email: string;
    amount: number | string;
    level: string | number;
    name: string;
    username: string;
    debt?: number | string;
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

class EmailService {
    private transporter!: nodemailer.Transporter;
    private isInitialized: boolean = false;

    constructor() {
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
                log.info('Transporter initialized successfully');
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
     * Send an email
     */
    async sendEmail(options: EmailOptions): Promise<boolean> {
        if (!this.isInitialized) {
            if (config.nodeEnv === 'development') {
                // In development, just log the email instead of sending
                log.info('----- DEV MODE EMAIL -----');
                log.info(`To: ${options.to}`);
                log.info(`Subject: ${options.subject}`);
                log.info(`Body: ${options.text || options.html}`);
                log.info('--------------------------');
                return true;
            } else {
                throw new Error('Email service not initialized');
            }
        }

        try {
            // Configure email options
            const mailOptions = {
                from: options.from || config.email.from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            };

            // Send email
            const info = await this.transporter.sendMail(mailOptions);
            log.info(`Email sent successfully to ${options.to}`, { messageId: info.messageId });

            return true;
        } catch (error: any) {
            log.error(`Failed to send email to ${options.to}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Send Commission Earned Email
     */
    async sendCommissionEarnedEmail(data: CommissionEmailData): Promise<boolean> {
        log.info('Attempting to send commission earned email', { recipient: data.email });
        const emailHtml = `
        <div style="font-family: Helvetica, Arial, sans-serif; min-width: 1000px; overflow: auto; line-height: 2;">
            <div style="margin: 50px auto; width: 70%; padding: 20px 0;">
                <div style="border-bottom: 1px solid #eee;">
                    <a href="https://sniperbuisnesscenter.com" style="font-size: 1.4em; color: #92b127; text-decoration: none; font-weight: 600;">
                        Sniper Business Center
                    </a>
                </div>
                <p style="font-size: 1.1em;">Bonjour/Bonsoir ${data.name},</p>
                <p>
                    Vous avez reçu une commission de 
                    <strong>${data.amount} FCFA</strong> de la part de <strong>${data.username}</strong> via une souscription de niveau ${data.level}.
                    ${data.debt && Number(data.debt) > 0 ? `Votre dette a été réduite. Votre dette était de ${data.debt} FCFA.` : ''}
                </p>
                <p>
                    Ce dépôt a été effectué avec succès et a été crédité sur votre compte.
                </p>
                <p style="font-size: 0.9em;">
                    Cordialement,<br />L\'équipe SBC
                </p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <div style="float: right; padding: 8px 0; color: #aaa; font-size: 0.8em; line-height: 1; font-weight: 300;">
                    <p>Sniper Business Center Inc</p>
                    <p>Développé par Simbtech,<br />© ${new Date().getFullYear()}</p>
                    <p>Cameroun - Yaoundé</p>
                </div>
            </div>
        </div>
        `;

        try {
            await this.sendEmail({
                to: data.email,
                subject: "Dépôt de commission reçu avec succès",
                html: emailHtml,
                from: '"Sniper Business Center" <info@sniperbuisnesscenter.com>'
            });
            log.info('Commission earned email sent successfully to:', { recipient: data.email });
            return true;
        } catch (error: any) {
            log.error('Error sending commission earned email:', {
                error: error.message,
                recipient: data.email,
                data
            });
            return false; // Or rethrow error to be handled by controller
        }
    }

    /**
     * Send Transaction Successful Email
     */
    async sendTransactionSuccessEmail(data: TransactionSuccessEmailData): Promise<boolean> {
        log.info('Attempting to send transaction successful email', { recipient: data.email });
        const formattedDate = new Date(data.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
        const emailHtml = `
        <div style="font-family: Helvetica, Arial, sans-serif; min-width: 1000px; overflow: auto; line-height: 2;">
            <div style="margin: 50px auto; width: 70%; padding: 20px 0;">
                <div style="border-bottom: 1px solid #eee;">
                    <a href="https://sniperbuisnesscenter.com" style="font-size: 1.4em; color: #92b127; text-decoration: none; font-weight: 600;">
                        Sniper Business Center
                    </a>
                </div>
                <p style="font-size: 1.1em;">Bonjour/Bonsoir ${data.name},</p>
                <p>
                    Votre transaction de type "<strong>${data.transactionType}</strong>" d\'un montant de 
                    <strong>${data.amount} ${data.currency}</strong>, effectuée le ${formattedDate}, a été complétée avec succès.
                </p>
                ${data.productOrServiceName ? `<p>Produit/Service: ${data.productOrServiceName}</p>` : ''}
                <p>Identifiant de la transaction: ${data.transactionId}</p>
                <p>
                    Merci d\'utiliser nos services.
                </p>
                <p style="font-size: 0.9em;">
                    Cordialement,<br />L\'équipe SBC
                </p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <div style="float: right; padding: 8px 0; color: #aaa; font-size: 0.8em; line-height: 1; font-weight: 300;">
                    <p>Sniper Business Center Inc</p>
                    <p>Développé par Simbtech,<br />© ${new Date().getFullYear()}</p>
                    <p>Cameroun - Yaoundé</p>
                </div>
            </div>
        </div>
        `;

        try {
            await this.sendEmail({
                to: data.email,
                subject: `Confirmation de transaction: ${data.transactionType} réussie`,
                html: emailHtml,
                from: '"Sniper Business Center" <info@sniperbuisnesscenter.com>'
            });
            log.info('Transaction successful email sent successfully to:', { recipient: data.email });
            return true;
        } catch (error: any) {
            log.error('Error sending transaction successful email:', {
                error: error.message,
                recipient: data.email,
                data
            });
            return false; // Or rethrow error
        }
    }

    /**
     * Verify email connection (for health checks)
     */
    async verifyConnection(): Promise<boolean> {
        if (!this.isInitialized) {
            return false;
        }

        try {
            await this.transporter.verify();
            log.info('Email service connection verified');
            return true;
        } catch (error) {
            log.error('Connection verification failed', { error });
            return false;
        }
    }
}

// Export service instance
export const emailService = new EmailService(); 