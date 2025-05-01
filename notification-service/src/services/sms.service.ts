import { Twilio } from 'twilio';
import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SmsService');

interface SmsOptions {
    to: string;
    body: string;
    from?: string; // Optional, used by Twilio
}

type SmsProvider = 'twilio' | 'queensms' | 'none';

class SmsService {
    private twilioClient: Twilio | null = null;
    private queenSmsApiKey: string | null = null;
    private queenSmsSenderId: string | null = null;
    private queenSmsApiUrl: string | null = null;
    private activeProvider: SmsProvider = 'none';
    private isInitialized: boolean = false;

    constructor() {
        this.initializeProvider();
    }

    private initializeProvider(): void {
        const provider = (config.sms?.provider?.toLowerCase() as SmsProvider) || 'none';
        log.info(`Attempting to initialize SMS provider: ${provider}`);

        if (provider === 'twilio') {
            try {
                const accountSid = config.sms?.twilioAccountSid;
                const authToken = config.sms?.twilioAuthToken;
                if (accountSid && authToken) {
                    this.twilioClient = new Twilio(accountSid, authToken);
                    this.activeProvider = 'twilio';
                    this.isInitialized = true;
                    log.info('SMS Service initialized successfully with Twilio provider.');
                } else {
                    log.warn('Twilio configuration (AccountSid/AuthToken) missing. Cannot use Twilio provider.');
                    this.activeProvider = 'none';
                }
            } catch (error) {
                log.error('Failed to initialize Twilio client', { error });
                this.activeProvider = 'none';
            }
        } else if (provider === 'queensms') {
            this.queenSmsApiKey = config.sms?.queenSmsApiKey || null;
            this.queenSmsSenderId = config.sms?.queenSmsSenderId || null;
            this.queenSmsApiUrl = config.sms?.queenSmsApiUrl || 'https://api.queensms.com/send';

            if (this.queenSmsApiKey && this.queenSmsSenderId && this.queenSmsApiUrl) {
                this.activeProvider = 'queensms';
                this.isInitialized = true;
                log.info('SMS Service initialized successfully with Queen SMS provider.');
            } else {
                log.warn('Queen SMS configuration (API Key, Sender ID, or API URL) missing. Cannot use Queen SMS provider.');
                this.activeProvider = 'none';
            }
        } else {
            log.warn(`No valid SMS provider configured or provider is 'none'. SMS sending disabled.`);
            this.activeProvider = 'none';
        }

        this.isInitialized = this.activeProvider !== 'none';

        if (!this.isInitialized) {
            if (config.nodeEnv === 'development') {
                log.warn('SMS sending is disabled due to configuration, but messages will be logged in development mode.');
            } else {
                log.error('SMS sending is disabled due to missing or invalid configuration.');
            }
        }
    }

    async sendSms(options: SmsOptions): Promise<boolean> {
        if (!this.isInitialized) {
            if (config.nodeEnv === 'development') {
                log.info('----- DEV MODE SMS LOG (Service Not Initialized) -----');
                log.info(`To: ${options.to}`);
                log.info(`From: ${options.from || this.queenSmsSenderId || config.sms?.twilioPhoneNumber || 'Default'}`);
                log.info(`Body: ${options.body}`);
                log.info('-----------------------------------------------------');
                return true;
            } else {
                log.error('Cannot send SMS: SMS service is not initialized or configured correctly.');
                return false;
            }
        }

        log.info(`Attempting to send SMS via provider: ${this.activeProvider} to ${options.to}`);
        switch (this.activeProvider) {
            case 'twilio':
                return this._sendWithTwilio(options);
            case 'queensms':
                return this._sendWithQueenSms(options.to, options.body);
            case 'none':
            default:
                log.error('Cannot send SMS: No active SMS provider determined despite service being marked initialized.');
                return false;
        }
    }

    private async _sendWithTwilio(options: SmsOptions): Promise<boolean> {
        if (!this.twilioClient) {
            log.error('Twilio client not available for sending SMS.');
            return false;
        }
        try {
            const formattedNumber = options.to.startsWith('+') ? options.to : `+${options.to}`;
            const fromNumber = options.from || config.sms?.twilioPhoneNumber;
            if (!fromNumber) {
                log.error('Twilio \'from\' number is required but missing in config (TWILIO_PHONE_NUMBER).');
                return false;
            }
            const message = await this.twilioClient.messages.create({
                body: options.body,
                from: fromNumber,
                to: formattedNumber,
            });
            log.info(`SMS sent successfully via Twilio to ${options.to}. SID: ${message.sid}`);
            return true;
        } catch (error: any) {
            log.error(`Failed to send SMS via Twilio to ${options.to}`, { error: error.message || error });
            return false;
        }
    }

    private async _sendWithQueenSms(to: string, message: string): Promise<boolean> {
        if (!this.queenSmsApiKey || !this.queenSmsSenderId || !this.queenSmsApiUrl) {
            log.error('Cannot send SMS via Queen SMS: Configuration (API Key, Sender ID, or API URL) is incomplete.');
            return false;
        }
        if (!/^\+[1-9]\d{1,14}$/.test(to)) {
            log.error(`Invalid phone number format for Queen SMS: ${to}. Must start with + and country code.`);
            return false;
        }
        const requestBody = {
            apiKey: this.queenSmsApiKey,
            senderId: this.queenSmsSenderId,
            recipient: to,
            message: message,
        };
        log.info(`Sending SMS via Queen SMS to: ${to}`);
        try {
            const response = await axios.post<any>(this.queenSmsApiUrl, requestBody, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000,
            });
            log.debug('Queen SMS raw response:', response.data);

            const isSuccess = response.status >= 200 && response.status < 300;

            if (isSuccess) {
                log.info(`Successfully sent SMS via Queen SMS to: ${to}`);
                return true;
            } else {
                log.error(`Failed to send SMS via Queen SMS to: ${to}. Status: ${response.status}, Response: ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error sending SMS via Queen SMS to ${to}:`, error.response?.data || error.message);
            return false;
        }
    }

    async verifyConnection(): Promise<boolean> {
        log.info(`Verifying connection for active provider: ${this.activeProvider}`);
        if (!this.isInitialized) return false;

        if (this.activeProvider === 'twilio' && this.twilioClient) {
            try {
                const accountSid = config.sms?.twilioAccountSid;
                if (!accountSid) {
                    log.warn('Cannot verify Twilio connection: Account SID missing in config.');
                    return false;
                }
                await this.twilioClient.api.accounts(accountSid).fetch();
                log.info('Twilio connection verified successfully.');
                return true;
            } catch (error) {
                log.error('Twilio connection verification failed', { error });
                return false;
            }
        } else if (this.activeProvider === 'queensms') {
            log.info('QueenSMS connection verification not implemented. Returning initialization status.');
            return this.isInitialized;
        }
        log.warn('Cannot verify connection: No supported active provider.')
        return false;
    }
}

export const smsService = new SmsService(); 