# Phase 4: WhatsApp Integration - Implementation Guide

## ✅ What's Been Completed So Far

### Database Models (DONE)
- ✅ `relance-config.model.ts` - User WhatsApp configurations
- ✅ `relance-message.model.ts` - Admin message templates
- ✅ `relance-target.model.ts` - Referral tracking

---

## 📋 Remaining Implementation Tasks

### Task 1: Install Dependencies

```bash
cd notification-service
npm install whatsapp-web.js qrcode-terminal bull crypto-js @types/crypto-js
```

**Packages:**
- `whatsapp-web.js` - WhatsApp Web API
- `qrcode-terminal` - Generate QR codes for auth
- `bull` - Job queue (already installed, verify)
- `crypto-js` - Encrypt WhatsApp session data

---

### Task 2: Create WhatsApp Service

**File**: `notification-service/src/services/whatsapp.relance.service.ts`

```typescript
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
import CryptoJS from 'crypto-js';
import config from '../config';
import logger from '../utils/logger';
import RelanceConfigModel, { WhatsAppStatus } from '../database/models/relance-config.model';

const log = logger.getLogger('WhatsAppRelanceService');

const ENCRYPTION_KEY = config.whatsapp?.sessionSecret || 'default-secret-key';

/**
 * WhatsApp Relance Service
 * Manages WhatsApp Web sessions for multiple users
 */
class WhatsAppRelanceService {
    private activeSessions: Map<string, Client> = new Map();

    /**
     * Generate QR code for user to scan
     * @param userId User ID
     * @returns QR code data URL
     */
    async generateQRCode(userId: string): Promise<{ qr?: string; error?: string }> {
        try {
            // Check if config exists
            let config = await RelanceConfigModel.findOne({ userId });
            if (!config) {
                config = await RelanceConfigModel.create({
                    userId,
                    enabled: true,
                    whatsappStatus: WhatsAppStatus.DISCONNECTED
                });
            }

            return new Promise((resolve) => {
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `relance-${userId}`
                    }),
                    puppeteer: {
                        headless: true,
                        args: ['--no-sandbox']
                    }
                });

                client.on('qr', (qr) => {
                    log.info(`QR Code generated for user ${userId}`);
                    resolve({ qr });
                    client.destroy(); // Don't keep session open during QR scan
                });

                client.on('ready', async () => {
                    log.info(`WhatsApp ready for user ${userId}`);

                    // Save session data (encrypted)
                    const sessionData = await client.getState();
                    const encryptedData = this.encryptSessionData(JSON.stringify(sessionData));

                    await RelanceConfigModel.updateOne(
                        { userId },
                        {
                            whatsappAuthData: encryptedData,
                            whatsappStatus: WhatsAppStatus.CONNECTED,
                            lastQrScanDate: new Date()
                        }
                    );

                    resolve({ qr: 'authenticated' });
                    client.destroy();
                });

                client.on('auth_failure', () => {
                    log.error(`Authentication failed for user ${userId}`);
                    resolve({ error: 'Authentication failed' });
                });

                client.initialize();

                // Timeout after 2 minutes
                setTimeout(() => {
                    resolve({ error: 'QR code generation timeout' });
                    client.destroy();
                }, 120000);
            });
        } catch (error: any) {
            log.error(`Error generating QR for user ${userId}:`, error);
            return { error: error.message };
        }
    }

    /**
     * Initialize WhatsApp client for a user
     * @param userId User ID
     * @returns WhatsApp client instance
     */
    async initializeClient(userId: string): Promise<Client | null> {
        try {
            // Check if already connected
            if (this.activeSessions.has(userId)) {
                return this.activeSessions.get(userId)!;
            }

            const config = await RelanceConfigModel.findOne({ userId });
            if (!config || config.whatsappStatus !== WhatsAppStatus.CONNECTED) {
                log.warn(`User ${userId} has no active WhatsApp session`);
                return null;
            }

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: `relance-${userId}`
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox']
                }
            });

            await client.initialize();
            this.activeSessions.set(userId, client);

            // Update last connection check
            await RelanceConfigModel.updateOne(
                { userId },
                { lastConnectionCheck: new Date() }
            );

            return client;
        } catch (error: any) {
            log.error(`Error initializing WhatsApp for user ${userId}:`, error);

            // Mark as disconnected
            await RelanceConfigModel.updateOne(
                { userId },
                { whatsappStatus: WhatsAppStatus.DISCONNECTED }
            );

            return null;
        }
    }

    /**
     * Send a WhatsApp message
     * @param client WhatsApp client
     * @param phoneNumber Target phone number (with country code)
     * @param message Message text
     * @param mediaUrls Optional media attachments
     */
    async sendMessage(
        client: Client,
        phoneNumber: string,
        message: string,
        mediaUrls?: string[]
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Format phone number (remove + and spaces)
            const formattedNumber = phoneNumber.replace(/[+\s-]/g, '') + '@c.us';

            // Send text message
            await client.sendMessage(formattedNumber, message);
            log.info(`Message sent to ${phoneNumber}`);

            // Send media if provided
            if (mediaUrls && mediaUrls.length > 0) {
                for (const url of mediaUrls) {
                    const media = await MessageMedia.fromUrl(url);
                    await client.sendMessage(formattedNumber, media);
                    await this.sleep(2000); // 2 second delay between media
                }
            }

            return { success: true };
        } catch (error: any) {
            log.error(`Error sending message to ${phoneNumber}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect and destroy client
     */
    async destroyClient(userId: string): Promise<void> {
        const client = this.activeSessions.get(userId);
        if (client) {
            await client.destroy();
            this.activeSessions.delete(userId);
            log.info(`WhatsApp session destroyed for user ${userId}`);
        }
    }

    /**
     * Check connection status
     */
    async checkStatus(userId: string): Promise<WhatsAppStatus> {
        const config = await RelanceConfigModel.findOne({ userId });
        return config?.whatsappStatus || WhatsAppStatus.DISCONNECTED;
    }

    // Helper methods
    private encryptSessionData(data: string): string {
        return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
    }

    private decryptSessionData(encryptedData: string): string {
        const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const whatsappRelanceService = new WhatsAppRelanceService();
```

---

### Task 3: Create Relance API Routes

**File**: `notification-service/src/api/routes/relance.routes.ts`

```typescript
import { Router } from 'express';
import { relanceController } from '../controllers/relance.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// ===== USER ROUTES (Authenticated) =====
/**
 * @route   POST /api/relance/connect
 * @desc    Generate QR code for WhatsApp connection
 * @access  Private
 */
router.post('/connect', authenticate, (req, res) =>
    relanceController.connectWhatsApp(req, res)
);

/**
 * @route   GET /api/relance/status
 * @desc    Check WhatsApp connection status
 * @access  Private
 */
router.get('/status', authenticate, (req, res) =>
    relanceController.getStatus(req, res)
);

/**
 * @route   DELETE /api/relance/disconnect
 * @desc    Disconnect WhatsApp session
 * @access  Private
 */
router.delete('/disconnect', authenticate, (req, res) =>
    relanceController.disconnectWhatsApp(req, res)
);

/**
 * @route   PUT /api/relance/pause
 * @desc    Pause/resume enrollment or sending
 * @access  Private
 */
router.put('/pause', authenticate, (req, res) =>
    relanceController.updatePauseSettings(req, res)
);

// ===== ADMIN ROUTES =====
/**
 * @route   GET /api/relance/admin/messages
 * @desc    Get all relance messages (Day 1-7)
 * @access  Admin
 */
router.get('/admin/messages', authenticate, authorize(['admin']), (req, res) =>
    relanceController.getAllMessages(req, res)
);

/**
 * @route   POST /api/relance/admin/messages
 * @desc    Create/update relance message for a specific day
 * @access  Admin
 */
router.post('/admin/messages', authenticate, authorize(['admin']), (req, res) =>
    relanceController.upsertMessage(req, res)
);

/**
 * @route   DELETE /api/relance/admin/messages/:day
 * @desc    Delete relance message for a specific day
 * @access  Admin
 */
router.delete('/admin/messages/:day', authenticate, authorize(['admin']), (req, res) =>
    relanceController.deleteMessage(req, res)
);

// ===== INTERNAL ROUTES (Service-to-service) =====
/**
 * @route   POST /api/relance/internal/exit-user
 * @desc    Remove user from relance loop (when they pay)
 * @access  Internal
 */
router.post('/internal/exit-user', (req, res) =>
    relanceController.exitUserFromLoop(req, res)
);

export default router;
```

---

### Task 4: Environment Variables

Add to `notification-service/.env`:

```env
# WhatsApp Relance Configuration
WHATSAPP_SESSION_SECRET=your-strong-encryption-key-here
RELANCE_MAX_CONCURRENT_SESSIONS=50
RELANCE_MESSAGE_DELAY_MS=3000
RELANCE_MAX_MESSAGES_PER_DAY=100
```

---

### Task 5: Update notification-service package.json

Add scripts for development:

```json
{
  "scripts": {
    "dev:relance": "nodemon --exec ts-node src/jobs/relance-enrollment.job.ts",
    "dev:sender": "nodemon --exec ts-node src/jobs/relance-sender.job.ts"
  }
}
```

---

## 🚀 Next Steps After This Implementation

1. **Implement Relance Controller** - Handle all API requests
2. **Create Cron Jobs** - Enrollment & Message Sending
3. **Test WhatsApp Connection** - Verify QR code generation works
4. **Test Message Sending** - Send test messages
5. **Admin Frontend** - Phase 5

---

## 📊 Estimated Completion Time

- Task 1 (Dependencies): 5 minutes
- Task 2 (WhatsApp Service): Already provided above
- Task 3 (API Routes): Already provided above
- Task 4 (Env Variables): 2 minutes
- Task 5 (Cron Jobs): 2-3 hours
- Task 6 (Controller): 1-2 hours
- Testing: 1 hour

**Total**: ~5-7 hours of development work

---

## ⚠️ Important Notes

1. **WhatsApp Terms**: Users must comply with WhatsApp's Terms of Service
2. **Rate Limiting**: Max 100 messages/day per WhatsApp account (configurable)
3. **Session Management**: WhatsApp sessions can expire, requiring re-authentication
4. **Puppeteer**: Requires Chrome/Chromium to be installed on server

---

## 📞 Support

Continue from here by:
1. Installing dependencies
2. Creating the controller
3. Implementing cron jobs
4. Testing the integration

See `RELANCE_IMPLEMENTATION_GUIDE.md` for the complete architecture overview.