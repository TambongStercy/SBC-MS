import apiClient from '../api/apiClient';

// Interfaces
export interface ConversationParticipant {
    _id: string;
    name: string;
    avatar?: string;
    isOnline: boolean;
}

export interface Conversation {
    _id: string;
    type: 'direct' | 'status_reply';
    participants: ConversationParticipant[];
    lastMessage?: {
        content: string;
        senderId: string;
        createdAt: string;
    };
    lastMessageAt?: string;
    unreadCount: number;
    statusId?: string;
}

export interface MessageSender {
    _id: string;
    name: string;
    avatar?: string;
}

export interface ReplyTo {
    _id: string;
    content: string;
    senderId: string;
    senderName?: string;
    type: 'text' | 'document' | 'system' | 'ad';
}

export interface Message {
    _id: string;
    conversationId: string;
    senderId: string;
    sender?: MessageSender;
    type: 'text' | 'document' | 'system' | 'ad';
    content: string;
    documentUrl?: string;
    documentName?: string;
    documentMimeType?: string;
    documentSize?: number;
    adImageUrl?: string;
    adRedirectUrl?: string;
    adCta?: string;
    status: 'sent' | 'delivered' | 'read';
    readBy: string[];
    replyTo?: ReplyTo;
    createdAt: string;
    updatedAt: string;
}

export interface MessageGroup {
    date: string; // ISO date (YYYY-MM-DD)
    dateLabel: string; // "Today", "Yesterday", or formatted date
    messages: Message[];
}

export interface PaginationInfo {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
}

// API Functions

/**
 * Get user's conversations
 */
export const getConversations = async (
    page: number = 1,
    limit: number = 20
): Promise<{ data: Conversation[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get('/chat/conversations', {
        params: { page, limit }
    });
    return response.data;
};

/**
 * Get or create conversation with a user
 */
export const getOrCreateConversation = async (
    participantId: string
): Promise<Conversation> => {
    const response = await apiClient.post('/chat/conversations', { participantId });
    return response.data.data;
};

/**
 * Get conversation by ID
 */
export const getConversation = async (
    conversationId: string
): Promise<Conversation> => {
    const response = await apiClient.get(`/chat/conversations/${conversationId}`);
    return response.data.data;
};

/**
 * Get messages in a conversation (flat list)
 */
export const getMessages = async (
    conversationId: string,
    page: number = 1,
    limit: number = 50
): Promise<{ data: Message[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get(`/chat/conversations/${conversationId}/messages`, {
        params: { page, limit }
    });
    return response.data;
};

/**
 * Get messages in a conversation grouped by date
 */
export const getMessagesGrouped = async (
    conversationId: string,
    page: number = 1,
    limit: number = 50
): Promise<{ data: MessageGroup[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get(`/chat/conversations/${conversationId}/messages`, {
        params: { page, limit, groupByDate: 'true' }
    });
    return response.data;
};

/**
 * Send a text message
 */
export const sendMessage = async (
    conversationId: string,
    content: string,
    replyToId?: string
): Promise<Message> => {
    const response = await apiClient.post('/chat/messages', {
        conversationId,
        content,
        type: 'text',
        replyToId
    });
    return response.data.data;
};

/**
 * Upload and send document
 */
export const sendDocument = async (
    conversationId: string,
    file: File,
    caption?: string
): Promise<Message> => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('conversationId', conversationId);
    if (caption) {
        formData.append('content', caption);
    }

    const response = await apiClient.post('/chat/messages/document', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data.data;
};

/**
 * Delete a message
 */
export const deleteMessage = async (messageId: string): Promise<void> => {
    await apiClient.delete(`/chat/messages/${messageId}`);
};

/**
 * Mark conversation as read
 */
export const markConversationAsRead = async (conversationId: string): Promise<void> => {
    await apiClient.patch(`/chat/conversations/${conversationId}/read`);
};

/**
 * Delete conversation
 */
export const deleteConversation = async (conversationId: string): Promise<void> => {
    await apiClient.delete(`/chat/conversations/${conversationId}`);
};

/**
 * Delete multiple messages
 */
export const deleteMessages = async (messageIds: string[]): Promise<void> => {
    await apiClient.post('/chat/messages/bulk-delete', { messageIds });
};

/**
 * Delete multiple conversations
 */
export const deleteConversations = async (conversationIds: string[]): Promise<void> => {
    await apiClient.post('/chat/conversations/bulk-delete', { conversationIds });
};

/**
 * Forward message(s) to conversation(s)
 */
export const forwardMessages = async (
    messageIds: string[],
    targetConversationIds: string[]
): Promise<void> => {
    await apiClient.post('/chat/messages/forward', {
        messageIds,
        targetConversationIds
    });
};
