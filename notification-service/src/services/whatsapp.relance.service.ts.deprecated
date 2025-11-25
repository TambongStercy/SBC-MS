import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import logger from '../utils/logger';
import RelanceConfigModel, { WhatsAppStatus } from '../database/models/relance-config.model';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import pino from 'pino';

const log = logger.getLogger('WhatsAppRelanceService');

// Create Pino logger for Baileys (it requires Pino specifically)
const pinoLogger = pino({ level: 'silent' }); // Use 'silent' to disable Baileys internal logs, or 'info' to enable

const MAX_MESSAGES_PER_DAY = parseInt(process.env.RELANCE_MAX_MESSAGES_PER_DAY || '100');

/**
 * WhatsApp Relance Service using Baileys
 * HEADLESS - No browser required, works on Windows, Linux, macOS
 * Supports multi-device and media files
 */
class WhatsAppRelanceService {
    private activeSessions: Map<string, WASocket> = new Map();
    private sessionPath: string;

    constructor() {
        // Create directory for WhatsApp sessions
        this.sessionPath = path.join(__dirname, '../../.baileys_auth');
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
        }
        log.info(`[Baileys] Session path: ${this.sessionPath}`);
    }

    /**
     * Generate QR code for user to scan
     */
    async generateQRCode(userId: string): Promise<{ qr?: string; error?: string }> {
        try {
            log.info(`[Baileys] Generating QR code for user ${userId}`);

            // Check/create config
            let config = await RelanceConfigModel.findOne({ userId });
            if (!config) {
                config = await RelanceConfigModel.create({
                    userId,
                    enabled: true,
                    whatsappStatus: WhatsAppStatus.DISCONNECTED,
                    enrollmentPaused: false,
                    sendingPaused: false
                });
            }

            // Clean up existing session
            await this.disconnect(userId);

            return new Promise(async (resolve) => {
                const userSessionPath = path.join(this.sessionPath, `session-${userId}`);

                // Only delete session files if user has reached 3 failures OR explicitly requesting new QR
                const failureCount = config?.connectionFailureCount || 0;
                if (fs.existsSync(userSessionPath)) {
                    if (failureCount >= 3) {
                        log.info(`[Baileys] Deleting session for user ${userId} (${failureCount} failures - threshold reached)`);
                        try {
                            fs.rmSync(userSessionPath, { recursive: true, force: true });
                        } catch (rmError: any) {
                            log.warn(`[Baileys] Could not delete old session:`, rmError);
                        }
                    } else {
                        log.info(`[Baileys] Keeping existing session for user ${userId} (${failureCount}/3 failures)`);
                    }
                }

                // Create session directory if it doesn't exist
                if (!fs.existsSync(userSessionPath)) {
                    fs.mkdirSync(userSessionPath, { recursive: true });
                }

                try {
                    const { state, saveCreds } = await useMultiFileAuthState(userSessionPath);
                    const { version } = await fetchLatestBaileysVersion();

                    let qrGenerated = false;
                    let qrReturnedToUser = false;
                    let qrTimeout: NodeJS.Timeout | undefined;
                    let reconnectTimeout: NodeJS.Timeout | undefined;

                    const createSocket = () => {
                        const sock = makeWASocket({
                            version,
                            auth: {
                                creds: state.creds,
                                keys: makeCacheableSignalKeyStore(state.keys, pinoLogger)
                            },
                            printQRInTerminal: false,
                            browser: ['Relance SBC', 'Chrome', '1.0.0'], // Custom browser name
                            generateHighQualityLinkPreview: true,
                            logger: pinoLogger
                        });

                        return sock;
                    };

                    let sock = createSocket();

                    // Store socket temporarily so it stays alive for scanning
                    const tempSocketKey = `temp-${userId}`;
                    this.activeSessions.set(tempSocketKey, sock);

                    // Connection updates
                    sock.ev.on('connection.update', async (update) => {
                        const { connection, lastDisconnect, qr } = update;

                        log.info(`[Baileys] Connection update for ${userId}: connection=${connection}, hasQR=${!!qr}`);

                        // QR code received (can happen multiple times as QR refreshes)
                        if (qr) {
                            try {
                                log.info(`[Baileys] QR code ${qrGenerated ? 'refreshed' : 'received'} for user ${userId}`);
                                const qrDataURL = await QRCode.toDataURL(qr);

                                if (!qrGenerated) {
                                    qrGenerated = true;
                                    qrReturnedToUser = true;
                                    if (qrTimeout) clearTimeout(qrTimeout);

                                    // Update status to show QR is pending scan
                                    await RelanceConfigModel.updateOne(
                                        { userId },
                                        { whatsappStatus: WhatsAppStatus.DISCONNECTED }
                                    );

                                    // Return QR to user but keep promise alive for connection
                                    resolve({ qr: qrDataURL });
                                }
                                // Note: QR will auto-refresh every ~20 seconds, we just return the first one
                            } catch (error: any) {
                                log.error(`[Baileys] QR generation error:`, error);
                                if (!qrGenerated) {
                                    if (qrTimeout) clearTimeout(qrTimeout);
                                    this.activeSessions.delete(tempSocketKey);
                                    resolve({ error: 'Failed to generate QR code' });
                                }
                            }
                        }

                        // Connection opened
                        if (connection === 'open') {
                            log.info(`[Baileys] ✓ Successfully connected for user ${userId}`);

                            // Reset failure counter on successful connection
                            await RelanceConfigModel.updateOne(
                                { userId },
                                {
                                    whatsappStatus: WhatsAppStatus.CONNECTED,
                                    lastQrScanDate: new Date(),
                                    lastConnectionCheck: new Date(),
                                    connectionFailureCount: 0,
                                    lastConnectionFailure: undefined
                                }
                            );

                            // Move from temp to permanent session
                            this.activeSessions.delete(tempSocketKey);
                            this.activeSessions.set(userId, sock);
                        }

                        // Connection closed
                        if (connection === 'close') {
                            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                            log.warn(`[Baileys] Connection closed for user ${userId}, status: ${statusCode}, reconnect: ${shouldReconnect}`);

                            // Track connection failure
                            const currentConfig = await RelanceConfigModel.findOne({ userId });
                            if (currentConfig) {
                                const failureCount = (currentConfig.connectionFailureCount || 0) + 1;

                                await RelanceConfigModel.updateOne(
                                    { userId },
                                    {
                                        connectionFailureCount: failureCount,
                                        lastConnectionFailure: new Date()
                                    }
                                );

                                log.warn(`[Baileys] Connection failure ${failureCount}/3 for user ${userId}`);
                            }

                            // Don't clean up temp session immediately - might be temporary disconnect during pairing
                            // Only clean up if it's a permanent logout (401) OR 3rd failure
                            if (statusCode === DisconnectReason.loggedOut) {
                                log.error(`[Baileys] User ${userId} logged out (401) - cleaning up session`);
                                this.activeSessions.delete(tempSocketKey);
                                this.activeSessions.delete(userId);

                                const failureCount = currentConfig?.connectionFailureCount || 0;

                                // Only delete session files after 3 failures
                                if (failureCount >= 3) {
                                    log.error(`[Baileys] User ${userId} - 3 consecutive failures, deleting session files`);
                                    const userSessionPath = path.join(this.sessionPath, `session-${userId}`);
                                    if (fs.existsSync(userSessionPath)) {
                                        fs.rmSync(userSessionPath, { recursive: true, force: true });
                                    }

                                    await RelanceConfigModel.updateOne(
                                        { userId },
                                        {
                                            whatsappStatus: WhatsAppStatus.DISCONNECTED,
                                            connectionFailureCount: 0
                                        }
                                    );
                                } else {
                                    log.warn(`[Baileys] User ${userId} - keeping session files for retry (${failureCount}/3 failures)`);
                                    await RelanceConfigModel.updateOne(
                                        { userId },
                                        { whatsappStatus: WhatsAppStatus.DISCONNECTED }
                                    );
                                }

                                // If QR wasn't generated yet, resolve with error
                                if (!qrGenerated) {
                                    if (qrTimeout) clearTimeout(qrTimeout);
                                    resolve({ error: 'Connection closed before QR generation' });
                                }
                            } else if (statusCode === 515 && qrReturnedToUser) {
                                // 515 after QR scan = need to reconnect with saved credentials
                                log.info(`[Baileys] Status 515 after QR scan - reconnecting with saved credentials for user ${userId}`);

                                // Clean up old socket
                                this.activeSessions.delete(tempSocketKey);

                                // Wait a moment then reconnect
                                reconnectTimeout = setTimeout(async () => {
                                    try {
                                        log.info(`[Baileys] Creating new socket to complete pairing for user ${userId}`);

                                        // Create new socket with saved credentials
                                        const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(userSessionPath);
                                        const { version: newVersion } = await fetchLatestBaileysVersion();

                                        sock = makeWASocket({
                                            version: newVersion,
                                            auth: {
                                                creds: newState.creds,
                                                keys: makeCacheableSignalKeyStore(newState.keys, pinoLogger)
                                            },
                                            printQRInTerminal: false,
                                            browser: ['Relance SBC', 'Chrome', '1.0.0'], // Custom browser name
                                            logger: pinoLogger
                                        });

                                        // Update temp session with new socket
                                        this.activeSessions.set(tempSocketKey, sock);

                                        // Listen for connection on new socket
                                        sock.ev.on('connection.update', async (update) => {
                                            if (update.connection === 'open') {
                                                log.info(`[Baileys] ✓ Reconnection successful for user ${userId}`);

                                                // Reset failure counter on successful reconnection
                                                await RelanceConfigModel.updateOne(
                                                    { userId },
                                                    {
                                                        whatsappStatus: WhatsAppStatus.CONNECTED,
                                                        lastQrScanDate: new Date(),
                                                        lastConnectionCheck: new Date(),
                                                        connectionFailureCount: 0,
                                                        lastConnectionFailure: undefined
                                                    }
                                                );

                                                this.activeSessions.delete(tempSocketKey);
                                                this.activeSessions.set(userId, sock);
                                            }
                                        });

                                        sock.ev.on('creds.update', newSaveCreds);

                                    } catch (reconnectError: any) {
                                        log.error(`[Baileys] Reconnection failed for user ${userId}:`, reconnectError);
                                    }
                                }, 2000); // Wait 2 seconds before reconnecting
                            } else {
                                // For other disconnect reasons, keep session alive
                                log.info(`[Baileys] Temporary disconnect (${statusCode}) - keeping session alive for user ${userId}`);
                            }
                        }
                    });

                    // Save credentials on update
                    sock.ev.on('creds.update', saveCreds);

                    // Set timeout (5 minutes - give user time to scan)
                    qrTimeout = setTimeout(() => {
                        if (!qrGenerated) {
                            log.error(`[Baileys] QR timeout for user ${userId}`);
                            sock.end(undefined);
                            this.activeSessions.delete(`temp-${userId}`);
                            resolve({ error: 'QR code generation timeout' });
                        }
                    }, 300000); // 5 minutes

                } catch (error: any) {
                    log.error(`[Baileys] Socket creation error:`, error);
                    resolve({ error: error.message });
                }
            });
        } catch (error: any) {
            log.error(`[Baileys] generateQRCode error:`, error);
            return { error: error.message };
        }
    }

    /**
     * Check WhatsApp connection status
     * Auto-restores session if files exist and failure count < 3
     */
    async checkStatus(userId: string): Promise<WhatsAppStatus> {
        const config = await RelanceConfigModel.findOne({ userId });
        if (!config) return WhatsAppStatus.DISCONNECTED;

        // Check if already in active sessions
        const sock = this.activeSessions.get(userId);
        if (sock) return WhatsAppStatus.CONNECTED;

        // If not in memory but session files exist, try to restore connection
        const userSessionPath = path.join(this.sessionPath, `session-${userId}`);
        if (fs.existsSync(userSessionPath) && config.connectionFailureCount < 3) {
            log.info(`[Baileys] Attempting to restore session for user ${userId}`);
            const client = await this.initializeClient(userId);
            if (client) {
                log.info(`[Baileys] ✓ Session restored for user ${userId}`);
                await RelanceConfigModel.updateOne(
                    { userId },
                    {
                        whatsappStatus: WhatsAppStatus.CONNECTED,
                        lastConnectionCheck: new Date()
                    }
                );
                return WhatsAppStatus.CONNECTED;
            }
        }

        return config.whatsappStatus || WhatsAppStatus.DISCONNECTED;
    }

    /**
     * Disconnect WhatsApp session
     */
    async disconnect(userId: string, force: boolean = false): Promise<void> {
        try {
            const sock = this.activeSessions.get(userId);
            if (sock) {
                log.info(`[Baileys] Disconnecting user ${userId}${force ? ' (FORCE)' : ''}`);
                sock.end(undefined);
                this.activeSessions.delete(userId);
            }

            // Force disconnect: delete session files and reset failure counter
            if (force) {
                log.info(`[Baileys] Force disconnect - deleting session files for user ${userId}`);
                const userSessionPath = path.join(this.sessionPath, `session-${userId}`);
                if (fs.existsSync(userSessionPath)) {
                    fs.rmSync(userSessionPath, { recursive: true, force: true });
                }

                await RelanceConfigModel.updateOne(
                    { userId },
                    {
                        whatsappStatus: WhatsAppStatus.DISCONNECTED,
                        connectionFailureCount: 0,
                        lastConnectionFailure: undefined
                    }
                );
            } else {
                // Normal disconnect: keep session files for retry
                await RelanceConfigModel.updateOne(
                    { userId },
                    { whatsappStatus: WhatsAppStatus.DISCONNECTED }
                );
            }
        } catch (error: any) {
            log.error(`[Baileys] Disconnect error:`, error);
        }
    }

    /**
     * Initialize client for sending messages
     */
    async initializeClient(userId: string): Promise<WASocket | null> {
        try {
            // Check if already connected
            const existingSocket = this.activeSessions.get(userId);
            if (existingSocket) {
                log.info(`[Baileys] Using existing socket for user ${userId}`);
                return existingSocket;
            }

            log.info(`[Baileys] Initializing client for user ${userId}`);

            const userSessionPath = path.join(this.sessionPath, `session-${userId}`);

            // Check if session exists
            if (!fs.existsSync(userSessionPath)) {
                log.error(`[Baileys] No session for user ${userId}`);
                return null;
            }

            const { state, saveCreds } = await useMultiFileAuthState(userSessionPath);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pinoLogger)
                },
                printQRInTerminal: false,
                browser: ['Relance SBC', 'Chrome', '1.0.0'], // Custom browser name
                logger: pinoLogger
            });

            return new Promise((resolve) => {
                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect } = update;

                    if (connection === 'open') {
                        log.info(`[Baileys] ✓ Client ready for user ${userId}`);
                        this.activeSessions.set(userId, sock);

                        // Reset failure counter on successful connection
                        await RelanceConfigModel.updateOne(
                            { userId },
                            {
                                lastConnectionCheck: new Date(),
                                connectionFailureCount: 0,
                                lastConnectionFailure: undefined
                            }
                        );

                        resolve(sock);
                    }

                    if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        log.warn(`[Baileys] Connection closed, status: ${statusCode}`);

                        this.activeSessions.delete(userId);

                        // Track connection failure
                        const currentConfig = await RelanceConfigModel.findOne({ userId });
                        if (currentConfig && statusCode === DisconnectReason.loggedOut) {
                            const failureCount = (currentConfig.connectionFailureCount || 0) + 1;

                            await RelanceConfigModel.updateOne(
                                { userId },
                                {
                                    connectionFailureCount: failureCount,
                                    lastConnectionFailure: new Date()
                                }
                            );

                            log.warn(`[Baileys] Connection failure ${failureCount}/3 for user ${userId} (initializeClient)`);

                            // Only delete session files after 3 failures
                            if (failureCount >= 3) {
                                log.error(`[Baileys] User ${userId} - 3 consecutive failures, deleting session files`);
                                const userSessionPath = path.join(this.sessionPath, `session-${userId}`);
                                if (fs.existsSync(userSessionPath)) {
                                    fs.rmSync(userSessionPath, { recursive: true, force: true });
                                }

                                await RelanceConfigModel.updateOne(
                                    { userId },
                                    {
                                        whatsappStatus: WhatsAppStatus.DISCONNECTED,
                                        connectionFailureCount: 0
                                    }
                                );
                            } else {
                                log.warn(`[Baileys] User ${userId} - keeping session files for retry (${failureCount}/3 failures)`);
                                await RelanceConfigModel.updateOne(
                                    { userId },
                                    { whatsappStatus: WhatsAppStatus.DISCONNECTED }
                                );
                            }
                        }

                        resolve(null);
                    }
                });

                sock.ev.on('creds.update', saveCreds);

                // Timeout
                setTimeout(() => {
                    if (!this.activeSessions.has(userId)) {
                        log.error(`[Baileys] Client init timeout for user ${userId}`);
                        sock.end(undefined);
                        resolve(null);
                    }
                }, 30000);
            });
        } catch (error: any) {
            log.error(`[Baileys] initializeClient error:`, error);
            return null;
        }
    }

    /**
     * Send WhatsApp message with optional media
     */
    async sendMessage(
        sock: WASocket,
        phoneNumber: string,
        message: string,
        mediaUrls?: Array<{ url: string; type: 'image' | 'video' | 'pdf' }>
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Format phone number for WhatsApp (add @s.whatsapp.net)
            const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

            // Send media if provided
            if (mediaUrls && mediaUrls.length > 0) {
                for (const media of mediaUrls) {
                    try {
                        // Download media file
                        const response = await axios.get(media.url, { responseType: 'arraybuffer' });
                        const buffer = Buffer.from(response.data);
                        const mimeType = response.headers['content-type'] || this.getMimeType(media.type);

                        // Determine message type
                        if (media.type === 'image') {
                            await sock.sendMessage(jid, {
                                image: buffer,
                                caption: message,
                                mimetype: mimeType
                            });
                        } else if (media.type === 'video') {
                            await sock.sendMessage(jid, {
                                video: buffer,
                                caption: message,
                                mimetype: mimeType
                            });
                        } else if (media.type === 'pdf') {
                            await sock.sendMessage(jid, {
                                document: buffer,
                                fileName: `document.pdf`,
                                mimetype: 'application/pdf',
                                caption: message
                            });
                        }

                        log.info(`[Baileys] ✓ Sent ${media.type} to ${phoneNumber}`);
                    } catch (mediaError: any) {
                        log.error(`[Baileys] Media send error:`, mediaError);
                        // Continue with text if media fails
                    }
                }
            } else {
                // Send text message only
                await sock.sendMessage(jid, { text: message });
                log.info(`[Baileys] ✓ Sent text to ${phoneNumber}`);
            }

            return { success: true };
        } catch (error: any) {
            log.error(`[Baileys] sendMessage error:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get MIME type for media
     */
    private getMimeType(type: 'image' | 'video' | 'pdf'): string {
        switch (type) {
            case 'image': return 'image/jpeg';
            case 'video': return 'video/mp4';
            case 'pdf': return 'application/pdf';
            default: return 'application/octet-stream';
        }
    }

    /**
     * Destroy client (alias for disconnect)
     */
    async destroyClient(userId: string): Promise<void> {
        await this.disconnect(userId);
    }
}

// Export singleton instance
export const whatsappRelanceService = new WhatsAppRelanceService();
