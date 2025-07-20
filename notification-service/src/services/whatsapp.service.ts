import makeWASocket, { DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import logger from '../utils/logger';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';

const log = logger.getLogger('WhatsAppService');

interface TransactionData {
    phoneNumber: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
}

class WhatsAppService extends EventEmitter {
    private sock: WASocket | null = null;
    private isReady: boolean = false;
    private latestQr: string | null = null; // base64 PNG
    private latestQrTimestamp: number = 0;
    private disconnectCallback: ((qrUrl: string | null) => void) | null = null;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 5000; // Start with 5 seconds
    private isInitializing: boolean = false;
    private connectionState: string = 'close';

    constructor() {
        super();
        this.init();
    }

    public getLatestQr(): { qr: string | null, timestamp: number } {
        return { qr: this.latestQr, timestamp: this.latestQrTimestamp };
    }

    public onDisconnect(cb: (qrUrl: string | null) => void) {
        this.disconnectCallback = cb;
    }

    public getConnectionStatus(): {
        isReady: boolean,
        hasQr: boolean,
        qrTimestamp: number | null,
        connectionState: string,
        reconnectAttempts: number,
        isInitializing: boolean
    } {
        return {
            isReady: this.isReady,
            hasQr: this.latestQr !== null,
            qrTimestamp: this.latestQr ? this.latestQrTimestamp : null,
            connectionState: this.isReady ? 'connected' : (this.latestQr ? 'waiting_for_scan' : this.connectionState),
            reconnectAttempts: this.reconnectAttempts,
            isInitializing: this.isInitializing
        };
    }

    public async logout(): Promise<{ success: boolean, message?: string }> {
        try {
            // Reset reconnection attempts and state
            this.reconnectAttempts = 0;
            this.isInitializing = false;

            if (this.sock) {
                try {
                    // Close the socket connection
                    await this.sock.logout();
                } catch (logoutError) {
                    log.warn('Error during socket logout (continuing with cleanup):', logoutError);
                }
            }

            this.sock = null;
            this.isReady = false;
            this.latestQr = null;
            this.latestQrTimestamp = 0;
            this.connectionState = 'close';

            // Clear authentication data
            const fs = require('fs');
            const authPath = './whatsapp_auth';

            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                log.info('WhatsApp authentication data cleared');
            }

            log.info('WhatsApp logged out successfully');

            // Reinitialize to generate new QR after a short delay
            setTimeout(() => {
                this.init();
            }, 2000);

            return { success: true, message: 'WhatsApp logged out successfully' };
        } catch (error) {
            log.error('Error during WhatsApp logout:', error);
            return { success: false, message: 'Failed to logout WhatsApp' };
        }
    }

    public async forceReconnect(): Promise<{ success: boolean, message?: string }> {
        try {
            log.info('Force reconnecting WhatsApp...');

            // Reset state
            this.reconnectAttempts = 0;
            this.isInitializing = false;

            // Close existing connection if any
            if (this.sock) {
                try {
                    this.sock.end(undefined);
                } catch (error) {
                    log.warn('Error closing existing socket:', error);
                }
            }

            this.sock = null;
            this.isReady = false;
            this.latestQr = null;
            this.latestQrTimestamp = 0;
            this.connectionState = 'close';

            // Reinitialize immediately
            await this.init();

            return { success: true, message: 'WhatsApp reconnection initiated' };
        } catch (error) {
            log.error('Error during WhatsApp force reconnect:', error);
            return { success: false, message: 'Failed to force reconnect WhatsApp' };
        }
    }

    private async init() {
        if (this.isInitializing) {
            log.info('WhatsApp initialization already in progress, skipping...');
            return;
        }

        this.isInitializing = true;

        try {
            log.info(`WhatsApp initialization attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`);

            // Use a persistent auth folder
            const { state, saveCreds } = await useMultiFileAuthState('./whatsapp_auth');

            this.sock = makeWASocket({
                auth: state,
                connectTimeoutMs: 60000, // 60 seconds timeout
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000, // Keep alive every 30 seconds
                // Disable automatic reconnection - we'll handle it manually
                shouldIgnoreJid: () => false,
                // Add browser info for better compatibility
                browser: ['Ubuntu', 'Chrome', '22.04.4'],
                // Reduce message retry attempts
                msgRetryCounterCache: undefined,
                // No logger to reduce noise
                logger: undefined,
                printQRInTerminal: false
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                this.connectionState = connection || 'close';

                if (qr) {
                    // Generate PNG base64 QR
                    try {
                        const qrPng = await QRCode.toDataURL(qr, { type: 'image/png' });
                        this.latestQr = qrPng;
                        this.latestQrTimestamp = Date.now();
                        this.emit('qr', qrPng);
                        log.info('New WhatsApp QR code generated and stored.');
                    } catch (err) {
                        log.error('Failed to generate QR PNG:', err);
                    }
                }

                if (connection === 'close') {
                    this.isReady = false;
                    this.isInitializing = false;

                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    log.info(`WhatsApp connection closed. Status code: ${statusCode}, Should reconnect: ${shouldReconnect}`);

                    if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000); // Max 30 seconds

                        log.info(`WhatsApp connection closed, attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

                        // Clear QR code when connection closes
                        this.latestQr = null;
                        this.latestQrTimestamp = 0;

                        // Reconnect with exponential backoff
                        setTimeout(() => {
                            this.init();
                        }, delay);
                    } else if (statusCode === DisconnectReason.loggedOut) {
                        log.warn('WhatsApp connection closed - logged out.');
                        this.latestQr = null;
                        this.latestQrTimestamp = 0;
                        this.reconnectAttempts = 0;
                    } else {
                        log.error(`WhatsApp max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection.`);
                        this.latestQr = null;
                        this.latestQrTimestamp = 0;
                    }

                    if (this.disconnectCallback) {
                        this.disconnectCallback(null);
                    }
                }

                if (connection === 'open') {
                    log.info('WhatsApp connection established successfully!');
                    this.isReady = true;
                    this.isInitializing = false;
                    this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection

                    // Clear QR code when connected
                    this.latestQr = null;
                    this.latestQrTimestamp = 0;
                    this.emit('connected');
                }

                if (connection === 'connecting') {
                    log.info('WhatsApp connecting...');
                }
            });

            // Handle socket errors - removed as 'connection.error' is not a valid Baileys event

        } catch (error) {
            log.error('Failed to initialize WhatsApp service:', error);
            this.isInitializing = false;

            // Retry initialization if we haven't exceeded max attempts
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);

                log.info(`Retrying WhatsApp initialization in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

                setTimeout(() => {
                    this.init();
                }, delay);
            }
        }
    }

    public async sendTextMessage({ phoneNumber, message }: { phoneNumber: string, message: string }): Promise<boolean> {
        if (!this.sock || !this.isReady) {
            log.warn('WhatsApp socket not ready. Cannot send message.');
            return false;
        }
        try {
            const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            log.info(`[DEBUG] About to send WhatsApp message`, { phoneNumber, message });
            await this.sock.sendMessage(jid, { text: message });
            log.info(`WhatsApp message sent to ${phoneNumber}`);
            return true;
        } catch (err) {
            log.error('Failed to send WhatsApp message:', err);
            return false;
        }
    }

    public async sendMultipleTextMessages({ phoneNumber, messages }: { phoneNumber: string, messages: string[] }): Promise<boolean> {
        if (!this.sock || !this.isReady) {
            log.warn('WhatsApp socket not ready. Cannot send messages.');
            return false;
        }
        try {
            const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            log.info(`[DEBUG] About to send ${messages.length} WhatsApp messages`, { phoneNumber, messageCount: messages.length });

            // Send messages with a small delay between them
            for (let i = 0; i < messages.length; i++) {
                await this.sock.sendMessage(jid, { text: messages[i] });
                log.info(`WhatsApp message ${i + 1}/${messages.length} sent to ${phoneNumber}`);

                // Add a small delay between messages (except for the last one)
                if (i < messages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                }
            }

            log.info(`All ${messages.length} WhatsApp messages sent successfully to ${phoneNumber}`);
            return true;
        } catch (err) {
            log.error('Failed to send WhatsApp messages:', err);
            return false;
        }
    }

    async sendTransactionNotification(data: TransactionData): Promise<boolean> {
        try {
            log.info(`Sending WhatsApp notification to ${data.phoneNumber}`, {
                transactionId: data.transactionId,
                type: data.transactionType
            });

            // Placeholder implementation - in development mode, just log
            log.info('WhatsApp notification sent (placeholder implementation)', {
                to: data.phoneNumber,
                message: `Transaction ${data.transactionId} of ${data.amount} ${data.currency} was processed.`
            });

            return true;
        } catch (error) {
            log.error('Failed to send WhatsApp notification', error);
            return false;
        }
    }

    /**
     * Send a file (image, document, video, etc.) via WhatsApp
     * @param params.phoneNumber - recipient phone number (string)
     * @param params.buffer - file buffer (Buffer)
     * @param params.mimetype - file mimetype (string)
     * @param params.fileName - file name (string, optional, for documents)
     * @param params.caption - caption (string, optional)
     */
    public async sendFileMessage({ phoneNumber, buffer, mimetype, fileName, caption }: {
        phoneNumber: string,
        buffer: Buffer,
        mimetype: string,
        fileName?: string,
        caption?: string
    }): Promise<boolean> {
        if (!this.sock || !this.isReady) {
            log.warn('WhatsApp socket not ready. Cannot send file message.');
            return false;
        }
        try {
            const jid = phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            let messageContent: any = {};
            if (mimetype.startsWith('image/')) {
                messageContent = { image: buffer, mimetype, caption };
            } else if (mimetype.startsWith('video/')) {
                messageContent = { video: buffer, mimetype, caption };
            } else {
                // Default to document
                messageContent = { document: buffer, mimetype, fileName: fileName || 'file', caption };
            }
            log.info(`[DEBUG] About to send WhatsApp file message`, { phoneNumber, mimetype, fileName, bufferLength: buffer.length });
            await this.sock.sendMessage(jid, messageContent);
            log.info(`WhatsApp file message sent to ${phoneNumber}`);
            return true;
        } catch (err) {
            log.error('Failed to send WhatsApp file message:', err);
            return false;
        }
    }
}

export default new WhatsAppService();
