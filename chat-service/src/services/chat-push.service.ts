import { ConversationType } from '../database/models/conversation.model';
import { MessageType } from '../database/models/message.model';
import { userServiceClient } from './clients/user.service.client';
import { sendChatPush } from './clients/notification.service.client';

const GCS_PUBLIC = 'https://storage.googleapis.com/sbc-file-storage/';

/**
 * The sender's photo as a notification icon: a 128px copy through our own
 * /api/settings/files resizer. Same origin, so the service worker can fetch it
 * (a direct storage.googleapis.com URL has no CORS for it, and costs egress).
 */
export function avatarIcon(avatar?: string): string | undefined {
    if (!avatar) return undefined;
    if (avatar.startsWith(GCS_PUBLIC)) return `/api/settings/files/${encodeURIComponent(avatar.slice(GCS_PUBLIC.length))}?w=128`;
    if (avatar.startsWith('/settings/files/')) return `/api${avatar}${avatar.includes('?') ? '&' : '?'}w=128`;
    if (avatar.startsWith('https://')) return avatar;
    return undefined;
}

/** The outside world, swappable in checks. */
export const chatPushDeps = { send: sendChatPush };

const preview = (text: string) => (text.length > 140 ? `${text.slice(0, 137)}…` : text);

/** What the lock screen shows for this message. */
export function chatPushText(args: {
    conversationType: string; messageType: string; senderName: string; content: string; documentName?: string;
}): { title: string; body: string } | null {
    if (args.messageType === MessageType.SYSTEM || args.messageType === MessageType.AD) return null;
    // SBC Love is encrypted at rest; its content never goes to a lock screen.
    if (args.conversationType === ConversationType.LOVE) return { title: 'SBC Love', body: 'Tu as un nouveau message.' };
    const body = args.messageType === MessageType.DOCUMENT
        ? `📄 ${args.documentName || 'Document'}`
        : preview(args.content);
    const title = args.conversationType === ConversationType.STATUS_REPLY
        ? `${args.senderName} a répondu à ton statut`
        : args.senderName;
    return { title, body };
}

/**
 * One buzz per conversation every few seconds at most: forwarding ten messages
 * should not ring ten times. Each push replaces the conversation's previous
 * one (same tag), so nothing piles up either way.
 */
const THROTTLE_MS = 3000;
const lastPush = new Map<string, number>();

export function shouldPush(recipientId: string, conversationId: string, now = Date.now()): boolean {
    const key = `${recipientId}:${conversationId}`;
    const prev = lastPush.get(key);
    if (prev !== undefined && now - prev < THROTTLE_MS) return false;
    lastPush.set(key, now);
    if (lastPush.size > 50_000) lastPush.clear();
    return true;
}

/** Fire-and-forget: a message is saved whether or not a push goes out. */
export function pushNewMessage(args: {
    conversationId: string; conversationType: string; senderId: string; recipients: string[];
    messageType: string; content: string; documentName?: string;
}): void {
    void (async () => {
        const recipients = args.recipients.filter(r => shouldPush(r, args.conversationId));
        if (!recipients.length) return;
        const sender = await userServiceClient.getUserDetails(args.senderId).catch(() => null);
        const text = chatPushText({ ...args, senderName: sender?.name?.trim() || 'Nouveau message' });
        if (!text) return;
        const icon = args.conversationType === ConversationType.LOVE ? undefined : avatarIcon(sender?.avatar);
        await Promise.all(recipients.map(userId => chatPushDeps.send({
            userId,
            ...text,
            url: `/chat?conversation=${args.conversationId}`,
            tag: `chat-${args.conversationId}`,
            ...(icon ? { icon } : {}),
        })));
    })().catch(() => undefined);
}
