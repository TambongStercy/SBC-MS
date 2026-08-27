import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SbcloveServiceClient');

export interface CanChatResult {
    unlocked: boolean; // both participants opted into contact (contactUnlocked)
    isOpen: boolean;   // the weekly SBC Love window is currently open
}

// Short in-process cache for the window flag only. The window changes on the
// hour at most, so a stale read of a few seconds is harmless and keeps the
// message:send hot path off a cross-service call every keystroke-send.
// The `unlocked` flag is NOT cached — consent can be revoked and must be fresh.
let windowCache: { isOpen: boolean; expiresAt: number } | null = null;
const WINDOW_TTL_MS = 20 * 1000;

class SbcloveServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.sbcloveServiceUrl,
            timeout: 8000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'chat-service'
            }
        });
        log.info('SBCLOVE service client initialized');
    }

    /** Whether `userId` may send in the LOVE conversation for `matchId` right now. */
    async canChat(matchId: string, userId: string): Promise<CanChatResult> {
        const response = await this.apiClient.get('/sbclove/internal/can-chat', {
            params: { matchId, userId }
        });
        const data = response.data?.data ?? response.data;
        const result: CanChatResult = {
            unlocked: !!data.unlocked,
            isOpen: !!data.isOpen
        };
        windowCache = { isOpen: result.isOpen, expiresAt: Date.now() + WINDOW_TTL_MS };
        return result;
    }

    /** Window-open flag alone, cached ~20s. Used where consent is already known. */
    async isWindowOpen(): Promise<boolean> {
        if (windowCache && windowCache.expiresAt > Date.now()) return windowCache.isOpen;
        const response = await this.apiClient.get('/sbclove/internal/window');
        const data = response.data?.data ?? response.data;
        const isOpen = !!data.isOpen;
        windowCache = { isOpen, expiresAt: Date.now() + WINDOW_TTL_MS };
        return isOpen;
    }
}

export const sbcloveServiceClient = new SbcloveServiceClient();
