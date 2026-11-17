import type { Conversation } from '../../services/chatApi';
import type { AdminUserData } from '../../services/adminUserApi';

/** A conversation opened with a member but not created yet (created with its first message). */
export interface PendingConversation {
    isPending: true;
    pendingUser: AdminUserData;
    /** Temporary local id: `pending_<userId>`. */
    _id: string;
    participants: Array<{ _id: string; name: string; avatar?: string }>;
    lastMessage?: { content: string; senderId: string; createdAt: string };
    lastMessageAt?: string;
    unreadCount: number;
}

export type DisplayConversation = Conversation | PendingConversation;

export const isPendingConversation = (conv: DisplayConversation): conv is PendingConversation =>
    'isPending' in conv && conv.isPending === true;

/** The member on the other side of a conversation. */
export const otherParticipant = (conv: DisplayConversation, currentUserId: string) =>
    conv.participants.find(p => p._id !== currentUserId) || conv.participants[0];

/** Most recent message first. */
export const byLastMessage = (a: { lastMessageAt?: string }, b: { lastMessageAt?: string }) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
};

/** 14:05 today, "Hier", the weekday within a week, then "12 nov." */
export function formatChatTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return date.toLocaleDateString('fr-FR', { weekday: 'short' });
    return date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
}

/** Label of a date group ("Aujourd’hui", "Hier", "12 nov. 2026") and its YYYY-MM-DD key. */
export function dateGroupOf(createdAt: string): { date: string; dateLabel: string } {
    const messageDate = new Date(createdAt);
    messageDate.setHours(0, 0, 0, 0);
    const date = messageDate.toISOString().split('T')[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let dateLabel: string;
    if (messageDate.getTime() === today.getTime()) dateLabel = 'Aujourd’hui';
    else if (messageDate.getTime() === yesterday.getTime()) dateLabel = 'Hier';
    else dateLabel = messageDate.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' });
    return { date, dateLabel };
}
