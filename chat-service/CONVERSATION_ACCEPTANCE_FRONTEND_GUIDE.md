# Conversation Acceptance Feature - Frontend Implementation Guide

This guide explains how to implement the conversation acceptance feature in the user-facing frontend application.

## Overview

The conversation acceptance feature limits users to sending only 3 messages in a new conversation before the recipient must accept or report the conversation. This prevents spam and unwanted messages.

### Exemptions

The following users are **NOT** subject to the 3-message limit:
- **Admin users**: Can send unlimited messages
- **Users with direct referral relationship (level 1)**: If User A directly referred User B (or vice versa), they can send unlimited messages to each other

### Conversation States

Conversations have the following acceptance statuses:
- `pending`: New conversation, message limit applies
- `accepted`: Recipient has accepted, no message limit
- `reported`: Recipient has reported, no messages allowed
- `blocked`: Conversation is blocked, no messages allowed

---

## Backend API Reference

### 1. Conversation Object Structure

When fetching conversations, the response includes these new fields:

```typescript
interface Conversation {
    _id: string;
    type: 'direct' | 'status_reply';
    participants: Array<{
        _id: string;
        name: string;
        avatar?: string;
        isOnline: boolean;
    }>;
    lastMessage?: {
        content: string;
        senderId: string;
        createdAt: Date;
    };
    lastMessageAt?: Date;
    unreadCount: number;
    statusId?: string;

    // NEW FIELDS
    acceptanceStatus: 'pending' | 'accepted' | 'reported' | 'blocked';
    initiatorId?: string;
    messageCounts?: Record<string, number>; // Map of userId -> message count
    acceptedAt?: Date;
    reportedAt?: Date;
    reportedBy?: string;
}
```

### 2. API Endpoints

#### Accept a Conversation
```http
POST /api/chat/conversations/:id/accept
Authorization: Bearer {token}
```

**Response:**
```json
{
    "success": true,
    "message": "Conversation accepted"
}
```

#### Report a Conversation
```http
POST /api/chat/conversations/:id/report
Authorization: Bearer {token}
```

**Response:**
```json
{
    "success": true,
    "message": "Conversation reported"
}
```

#### Send Message (with limit check)
```http
POST /api/chat/messages
Authorization: Bearer {token}
Content-Type: application/json

{
    "conversationId": "conversation_id",
    "content": "Message text",
    "type": "text"
}
```

**Error Response (when limit reached):**
```json
{
    "success": false,
    "message": "You have reached the maximum of 3 messages. The recipient must accept this conversation before you can send more messages."
}
```

---

## Frontend Implementation

### 1. TypeScript Types

Create or update your types file:

```typescript
// types/chat.ts

export enum ConversationAcceptanceStatus {
    PENDING = 'pending',
    ACCEPTED = 'accepted',
    REPORTED = 'reported',
    BLOCKED = 'blocked'
}

export interface Conversation {
    _id: string;
    type: 'direct' | 'status_reply';
    participants: Array<{
        _id: string;
        name: string;
        avatar?: string;
        isOnline: boolean;
    }>;
    lastMessage?: {
        content: string;
        senderId: string;
        createdAt: Date;
    };
    lastMessageAt?: Date;
    unreadCount: number;
    acceptanceStatus: ConversationAcceptanceStatus;
    initiatorId?: string;
    messageCounts?: Record<string, number>;
    acceptedAt?: Date;
    reportedAt?: Date;
    reportedBy?: string;
}
```

### 2. API Service Functions

Add these functions to your chat API service:

```typescript
// services/chatApi.ts

export const acceptConversation = async (conversationId: string): Promise<void> => {
    const response = await apiClient.post(`/chat/conversations/${conversationId}/accept`);
    return response.data;
};

export const reportConversation = async (conversationId: string): Promise<void> => {
    const response = await apiClient.post(`/chat/conversations/${conversationId}/report`);
    return response.data;
};
```

### 3. Helper Functions

Create utility functions to determine UI behavior:

```typescript
// utils/conversationHelpers.ts

export const needsAcceptance = (
    conversation: Conversation,
    currentUserId: string
): boolean => {
    return (
        conversation.acceptanceStatus === 'pending' &&
        conversation.initiatorId !== currentUserId
    );
};

export const canSendMessage = (
    conversation: Conversation,
    currentUserId: string
): boolean => {
    // Cannot send messages in reported or blocked conversations
    if (
        conversation.acceptanceStatus === 'reported' ||
        conversation.acceptanceStatus === 'blocked'
    ) {
        return false;
    }

    // Can always send if accepted
    if (conversation.acceptanceStatus === 'accepted') {
        return true;
    }

    // For pending conversations, check message count
    const messageCount = conversation.messageCounts?.[currentUserId] || 0;
    return messageCount < 3;
};

export const getRemainingMessages = (
    conversation: Conversation,
    currentUserId: string
): number => {
    if (conversation.acceptanceStatus !== 'pending') {
        return Infinity;
    }

    const messageCount = conversation.messageCounts?.[currentUserId] || 0;
    return Math.max(0, 3 - messageCount);
};

export const isInitiator = (
    conversation: Conversation,
    currentUserId: string
): boolean => {
    return conversation.initiatorId === currentUserId;
};
```

### 4. React Component Example

Here's a complete example of a chat component with acceptance handling:

```typescript
// components/ChatWindow.tsx

import React, { useState, useEffect } from 'react';
import { Conversation, Message } from '../types/chat';
import {
    sendMessage,
    acceptConversation,
    reportConversation,
    getMessages
} from '../services/chatApi';
import {
    needsAcceptance,
    canSendMessage,
    getRemainingMessages,
    isInitiator
} from '../utils/conversationHelpers';

interface ChatWindowProps {
    conversation: Conversation;
    currentUserId: string;
    onConversationUpdate: (conversation: Conversation) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
    conversation,
    currentUserId,
    onConversationUpdate
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageInput, setMessageInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [showAcceptanceBar, setShowAcceptanceBar] = useState(false);

    useEffect(() => {
        // Show acceptance bar if conversation needs acceptance
        setShowAcceptanceBar(needsAcceptance(conversation, currentUserId));

        // Load messages
        loadMessages();
    }, [conversation._id]);

    const loadMessages = async () => {
        try {
            const response = await getMessages(conversation._id);
            setMessages(response.data);
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    };

    const handleSendMessage = async () => {
        if (!messageInput.trim()) return;

        // Check if user can send messages
        if (!canSendMessage(conversation, currentUserId)) {
            alert('Cannot send more messages in this conversation');
            return;
        }

        setIsSending(true);
        try {
            await sendMessage({
                conversationId: conversation._id,
                content: messageInput.trim(),
                type: 'text'
            });

            setMessageInput('');

            // Update local conversation message count
            const updatedConversation = {
                ...conversation,
                messageCounts: {
                    ...conversation.messageCounts,
                    [currentUserId]: (conversation.messageCounts?.[currentUserId] || 0) + 1
                }
            };
            onConversationUpdate(updatedConversation);

            // Reload messages
            await loadMessages();
        } catch (error: any) {
            if (error.response?.data?.message) {
                alert(error.response.data.message);
            } else {
                alert('Failed to send message');
            }
        } finally {
            setIsSending(false);
        }
    };

    const handleAcceptConversation = async () => {
        try {
            await acceptConversation(conversation._id);

            // Update conversation status
            const updatedConversation = {
                ...conversation,
                acceptanceStatus: 'accepted' as const,
                acceptedAt: new Date()
            };
            onConversationUpdate(updatedConversation);
            setShowAcceptanceBar(false);

            alert('Conversation accepted');
        } catch (error) {
            alert('Failed to accept conversation');
        }
    };

    const handleReportConversation = async () => {
        if (!confirm('Are you sure you want to report this conversation?')) {
            return;
        }

        try {
            await reportConversation(conversation._id);

            // Update conversation status
            const updatedConversation = {
                ...conversation,
                acceptanceStatus: 'reported' as const,
                reportedAt: new Date(),
                reportedBy: currentUserId
            };
            onConversationUpdate(updatedConversation);
            setShowAcceptanceBar(false);

            alert('Conversation reported');
        } catch (error) {
            alert('Failed to report conversation');
        }
    };

    const renderMessageLimitWarning = () => {
        if (conversation.acceptanceStatus !== 'pending') return null;
        if (!isInitiator(conversation, currentUserId)) return null;

        const remaining = getRemainingMessages(conversation, currentUserId);
        if (remaining === Infinity) return null;

        return (
            <div className="message-limit-warning">
                <i className="icon-warning" />
                <span>
                    {remaining > 0
                        ? `You can send ${remaining} more message${remaining !== 1 ? 's' : ''} before the recipient must respond`
                        : 'Message limit reached. Waiting for recipient to accept.'}
                </span>
            </div>
        );
    };

    const renderAcceptanceBar = () => {
        if (!showAcceptanceBar) return null;

        return (
            <div className="acceptance-bar">
                <div className="acceptance-message">
                    <i className="icon-info" />
                    <span>This user wants to start a conversation with you</span>
                </div>
                <div className="acceptance-actions">
                    <button
                        onClick={handleAcceptConversation}
                        className="btn-accept"
                    >
                        Accept
                    </button>
                    <button
                        onClick={handleReportConversation}
                        className="btn-report"
                    >
                        Report
                    </button>
                </div>
            </div>
        );
    };

    const isMessageInputDisabled =
        conversation.acceptanceStatus === 'reported' ||
        conversation.acceptanceStatus === 'blocked' ||
        !canSendMessage(conversation, currentUserId);

    return (
        <div className="chat-window">
            {/* Acceptance Bar (for recipients) */}
            {renderAcceptanceBar()}

            {/* Message Limit Warning (for initiators) */}
            {renderMessageLimitWarning()}

            {/* Messages */}
            <div className="messages-container">
                {messages.map(message => (
                    <div key={message._id} className="message">
                        {/* Render message */}
                    </div>
                ))}
            </div>

            {/* Message Input */}
            <div className="message-input-container">
                <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder={
                        isMessageInputDisabled
                            ? "You cannot send messages in this conversation"
                            : "Type a message..."
                    }
                    disabled={isMessageInputDisabled || isSending}
                    className="message-input"
                />
                <button
                    onClick={handleSendMessage}
                    disabled={isMessageInputDisabled || isSending || !messageInput.trim()}
                    className="send-button"
                >
                    Send
                </button>
            </div>
        </div>
    );
};
```

### 5. Styling Suggestions

```css
/* styles/chat.css */

.acceptance-bar {
    background-color: #fff3cd;
    border-bottom: 1px solid #ffc107;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.acceptance-message {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #856404;
    font-weight: 500;
}

.acceptance-actions {
    display: flex;
    gap: 8px;
}

.btn-accept {
    background-color: #28a745;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
}

.btn-accept:hover {
    background-color: #218838;
}

.btn-report {
    background-color: #dc3545;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
}

.btn-report:hover {
    background-color: #c82333;
}

.message-limit-warning {
    background-color: #e7f3ff;
    border-left: 4px solid #2196f3;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #0c5460;
    font-size: 14px;
}

.message-input:disabled {
    background-color: #e9ecef;
    cursor: not-allowed;
}
```

### 6. Socket.IO Real-time Updates

Update your socket listeners to handle conversation acceptance:

```typescript
// services/socket.ts

socket.on('conversation:accepted', (data: { conversationId: string }) => {
    // Update conversation in your state
    updateConversation(data.conversationId, {
        acceptanceStatus: 'accepted',
        acceptedAt: new Date()
    });
});

socket.on('conversation:reported', (data: { conversationId: string, reportedBy: string }) => {
    // Update conversation in your state
    updateConversation(data.conversationId, {
        acceptanceStatus: 'reported',
        reportedAt: new Date(),
        reportedBy: data.reportedBy
    });
});
```

### 7. Conversation List Badge

Show a badge in the conversation list for pending conversations:

```typescript
// components/ConversationListItem.tsx

const ConversationListItem: React.FC<{ conversation: Conversation, currentUserId: string }> = ({
    conversation,
    currentUserId
}) => {
    const showAcceptanceBadge = needsAcceptance(conversation, currentUserId);
    const showLimitBadge =
        conversation.acceptanceStatus === 'pending' &&
        isInitiator(conversation, currentUserId) &&
        getRemainingMessages(conversation, currentUserId) === 0;

    return (
        <div className="conversation-item">
            {/* Avatar, name, last message, etc. */}

            {showAcceptanceBadge && (
                <span className="badge badge-warning">Needs Response</span>
            )}

            {showLimitBadge && (
                <span className="badge badge-info">Limit Reached</span>
            )}
        </div>
    );
};
```

---

## Testing Checklist

### As Conversation Initiator:
- [ ] Can send first message in new conversation
- [ ] Can send second message
- [ ] Can send third message
- [ ] Cannot send fourth message (blocked with error)
- [ ] See warning showing remaining messages
- [ ] After recipient accepts, can send unlimited messages

### As Conversation Recipient:
- [ ] See acceptance bar when receiving new conversation
- [ ] Can click "Accept" to accept conversation
- [ ] Can click "Report" to report conversation
- [ ] Acceptance bar disappears after accepting
- [ ] After accepting, can send unlimited messages

### Special Cases:
- [ ] Admin users can send unlimited messages (no limit shown)
- [ ] Users with direct referral relationship can send unlimited messages
- [ ] Reported conversations show as reported in UI
- [ ] Cannot send messages in reported conversations
- [ ] Real-time updates when conversation is accepted/reported

---

## Common Issues & Solutions

### Issue: User gets limit error but count shows < 3

**Solution**: The message count is checked BEFORE creating the message. Make sure to increment the local count after successful send.

### Issue: Acceptance bar shows even after accepting

**Solution**: Ensure you're updating the conversation object in your state with the new `acceptanceStatus`.

### Issue: Socket updates not working

**Solution**: Make sure you've added the socket listeners for `conversation:accepted` and `conversation:reported` events.

### Issue: Cannot test with real accounts

**Solution**: Use the acceptance endpoints in development to manually accept conversations, or create test accounts with referral relationships.

---

## Mobile App Considerations

For React Native or mobile apps:

1. **Push Notifications**: Send a push notification when:
   - A new pending conversation is created (to recipient)
   - A conversation is accepted (to initiator)
   - User reaches message limit (to initiator)

2. **UI Patterns**: Consider using bottom sheets or modals for the acceptance prompt instead of a fixed bar.

3. **Offline Support**: Cache conversation acceptance status locally and sync when online.

---

## Security Notes

- Never trust client-side validation alone - the backend enforces all limits
- The backend checks admin status and referral relationships server-side
- All API calls require authentication via JWT token
- Report functionality should be backed by server-side logging for admin review

---

## Additional Features to Consider

1. **Block Feature**: Add ability to block users completely (not just report)
2. **Notification Settings**: Let users opt out of new conversation requests
3. **Auto-Report Spam**: Detect and auto-report spam patterns
4. **Message Preview**: Show first 3 messages in acceptance prompt
5. **Mutual Friends**: Show mutual friends/referrals in acceptance prompt to build trust

---

For questions or issues, refer to the backend implementation in `chat-service/` or contact the backend development team.
