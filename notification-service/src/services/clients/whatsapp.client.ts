import logger from '../../utils/logger';

const log = logger.getLogger('WhatsAppClient');

interface PlaceholderClient {
    sendMessage: (to: string, message: string) => Promise<boolean>;
    initialize: () => void;
    isReady: () => boolean;
}

class WhatsAppClientPlaceholder implements PlaceholderClient {
    private ready = false;

    constructor() {
        log.info('WhatsApp client placeholder initialized');
    }

    initialize(): void {
        log.info('WhatsApp client placeholder initialized (no actual connection)');
        this.ready = true;
    }

    isReady(): boolean {
        return this.ready;
    }

    async sendMessage(to: string, message: string): Promise<boolean> {
        try {
            log.info(`WhatsApp message sent (placeholder)`, { to, message });
            return true;
        } catch (error) {
            log.error('Failed to send WhatsApp message (placeholder)', error);
            return false;
        }
    }
}

const whatsappClient = new WhatsAppClientPlaceholder();
export default whatsappClient;