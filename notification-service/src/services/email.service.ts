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