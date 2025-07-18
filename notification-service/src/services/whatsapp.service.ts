import makeWASocket, { DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
import logger from '../utils/logger';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
const QRCode = require('qrcode');
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
        connectionState: string
    } {
        return {
            isReady: this.isReady,
            hasQr: this.latestQr !== null,
            qrTimestamp: this.latestQr ? this.latestQrTimestamp : null,
            connectionState: this.isReady ? 'connected' : (this.latestQr ? 'waiting_for_scan' : 'disconnected')
        };
    }

    public async logout(): Promise<{ success: boolean, message?: string }> {
        try {
            if (!this.sock) {
                return { success: false, message: 'WhatsApp is not initialized' };
            }

            // Close the socket connection
            await this.sock.logout();
            this.sock = null;
            this.isReady = false;
            this.latestQr = null;
            this.latestQrTimestamp = 0;

            // Clear authentication data
            const fs = require('fs');
            const path = require('path');
            const authPath = './whatsapp_auth';

            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                log.info('WhatsApp authentication data cleared');
            }

            log.info('WhatsApp logged out successfully');

            // Reinitialize to generate new QR
            setTimeout(() => {
                this.init();
            }, 1000);

            return { success: true, message: 'WhatsApp logged out successfully' };
        } catch (error) {
            log.error('Error during WhatsApp logout:', error);
            return { success: false, message: 'Failed to logout WhatsApp' };
        }
    }

    private async init() {
        try {
            // Use a persistent auth folder
            const { state, saveCreds } = await useMultiFileAuthState('./whatsapp_auth');
            this.sock = makeWASocket({
                auth: state
                // No logger, no printQRInTerminal
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

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
                    const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        log.info('WhatsApp connection closed, attempting to reconnect...');
                        // Clear QR code when connection closes
                        this.latestQr = null;
                        this.latestQrTimestamp = 0;

                        // Reconnect after a short delay
                        setTimeout(() => {
                            this.init();
                        }, 3000);
                    } else {
                        log.warn('WhatsApp connection closed - logged out.');
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
                    // Clear QR code when connected
                    this.latestQr = null;
                    this.latestQrTimestamp = 0;
                    this.emit('connected');
                }

                if (connection === 'connecting') {
                    log.info('WhatsApp connecting...');
                }
            });
        } catch (error) {
            log.error('Failed to initialize WhatsApp service:', error);
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
