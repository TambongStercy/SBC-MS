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
                    log.warn('WhatsApp connection closed.');
                    if (this.disconnectCallback) {
                        // Provide a URL or null (to be set by API layer)
                        this.disconnectCallback(null);
                    }
                }
                if (connection === 'open') {
                    log.info('WhatsApp connection established!');
                    this.isReady = true;
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
