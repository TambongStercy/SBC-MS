# Chat & Status Service - Frontend Integration Guide

This document provides comprehensive documentation for integrating the Chat & Status features into the user-facing frontend application (Flutter/Mobile or any other client).

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [REST API Endpoints](#rest-api-endpoints)
4. [WebSocket (Socket.IO) Integration](#websocket-socketio-integration)
5. [Status Feature (Les Statuts)](#status-feature-les-statuts)
6. [Internal Messaging Feature](#internal-messaging-feature)
7. [Data Models](#data-models)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)

---

## Overview

The Chat Service provides two main features:

1. **Status/Stories (Les Statuts)** - Instagram/Facebook Stories-style social feed where users share updates
2. **Internal Messaging** - Private conversations between users (text and documents only, NO images/videos)

### Base URLs

- **REST API**: `{GATEWAY_URL}/api/chat`
- **WebSocket**: `{SOCKET_URL}` (typically same host, different port or path)

### Key Restrictions

- **Chat Messages**: Text and documents ONLY (NO images, NO videos)
- **Status Posts**: Text, images, videos (max 30 seconds), and flyers
- **Status Visibility**: ALL registered users see ALL statuses (no mutual contact requirement)
- **Media Storage**: All status media stored in PRIVATE GCS bucket with signed URLs

### Architecture Note

The chat-service delegates file storage operations to the settings-service:
- **chat-service**: Handles business logic, validation, and user interactions
- **settings-service**: Manages all file uploads to Google Cloud Storage
- **Communication**: Chat-service calls settings-service internal endpoints via HTTP
- **Security**: Service-to-service authentication with shared secret token

---

## Authentication

### REST API Authentication

All REST endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

### WebSocket Authentication

When connecting via Socket.IO, pass the token in the auth object:

```javascript
const socket = io(SOCKET_URL, {
    auth: {
        token: userJwtToken
    },
    transports: ['websocket', 'polling']
});
```

---

## REST API Endpoints

### Conversations

#### Get User's Conversations
```
GET /api/chat/conversations
Query: page (default: 1), limit (default: 20)
```

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "_id": "conversation_id",
            "type": "direct",
            "participants": [
                {
                    "_id": "user_id",
                    "name": "John Doe",
                    "avatar": "https://...",
                    "isOnline": true
                }
            ],
            "lastMessage": {
                "content": "Hello!",
                "senderId": "user_id",
                "createdAt": "2025-01-15T10:30:00Z"
            },
            "unreadCount": 3,
            "lastMessageAt": "2025-01-15T10:30:00Z"
        }
    ],
    "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalCount": 100,
        "limit": 20
    }
}
```

#### Get or Create Conversation
```
POST /api/chat/conversations
Body: { "participantId": "other_user_id" }
```

Creates a new conversation with the specified user or returns existing one.

**Response:**
```json
{
    "success": true,
    "data": {
        "_id": "conversation_id",
        "type": "direct",
        "participants": [
            {
                "_id": "user_id",
                "name": "John Doe",
                "avatar": "https://...",
                "isOnline": true
            },
            {
                "_id": "other_user_id",
                "name": "Jane Smith",
                "avatar": "https://...",
                "isOnline": false
            }
        ],
        "lastMessage": null,
        "unreadCount": 0
    }
}
```

**IMPORTANT: How to Start a New Conversation**

To start a conversation with a user, you need their user ID. Here's the typical flow:

1. **Search for users** using the User Service API:
   ```
   GET /api/users/admin/users?search=john&page=1&limit=10
   ```
   This returns a list of users matching the search term (by name or email).

   **Available Filters:**
   | Filter | Type | Description |
   |--------|------|-------------|
   | `search` | string | Search by name or email (min 2 chars) |
   | `status` | string | Filter by: `active`, `blocked`, `deleted` |
   | `country` | string | Filter by country code or name (e.g., "CM", "Cameroon") |
   | `profession` | string | Filter by profession (partial match) |
   | `interests` | string | Comma-separated interests (e.g., "Football,Music") |

   **Example with filters:**
   ```
   GET /api/users/admin/users?country=CM&profession=Engineer&interests=Tech,Business&page=1&limit=20
   ```

2. **Get the user ID** from the search results.

3. **Create conversation** by calling:
   ```
   POST /api/chat/conversations
   Body: { "participantId": "user_id_from_search" }
   ```

4. **The API returns the full conversation** with populated participant details (name, avatar, online status).

**Note:** The conversation is created in the database, and the participant data (name, avatar, isOnline) is fetched from the User Service and included in the response.

#### Get Single Conversation
```
GET /api/chat/conversations/:conversationId
```

#### Delete Conversation
```
DELETE /api/chat/conversations/:conversationId
```

### Messages

#### Get Messages in Conversation
```
GET /api/chat/conversations/:conversationId/messages
Query:
  - page (default: 1)
  - limit (default: 50)
  - groupByDate (optional: 'true' to group messages by date)
```

**Response (Flat List - Default):**
```json
{
    "success": true,
    "data": [
        {
            "_id": "message_id",
            "conversationId": "conversation_id",
            "senderId": "user_id",
            "sender": {
                "_id": "user_id",
                "name": "John Doe",
                "avatar": "https://..."
            },
            "type": "text",
            "content": "Hello!",
            "status": "delivered",
            "readBy": ["user_id_1", "user_id_2"],
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ],
    "pagination": {...}
}
```

**Response (Grouped by Date) - `?groupByDate=true`:**
```json
{
    "success": true,
    "data": [
        {
            "date": "2025-12-15",
            "dateLabel": "Dec 15, 2025",
            "messages": [
                {
                    "_id": "message_id_1",
                    "content": "Good morning!",
                    "createdAt": "2025-12-15T08:30:00Z",
                    "sender": {...}
                },
                {
                    "_id": "message_id_2",
                    "content": "How are you?",
                    "createdAt": "2025-12-15T09:15:00Z",
                    "sender": {...}
                }
            ]
        },
        {
            "date": "2025-12-16",
            "dateLabel": "Yesterday",
            "messages": [...]
        },
        {
            "date": "2025-12-17",
            "dateLabel": "Today",
            "messages": [...]
        }
    ],
    "pagination": {...}
}
```

**Date Grouping:**
- Messages are automatically grouped by date (midnight-to-midnight)
- **Date Labels**:
  - `"Today"`: Messages from current day
  - `"Yesterday"`: Messages from previous day
  - `"Dec 15, 2025"`: Messages from older dates (formatted)
- Groups are sorted chronologically (oldest to newest)
- Use `groupByDate=true` for WhatsApp-style date separators

#### Send Text Message
```
POST /api/chat/messages
Body: {
    "conversationId": "conversation_id",
    "content": "Hello!",
    "type": "text",
    "replyToId": "optional_message_id_to_reply_to"
}
```

**Reply-To Feature**: You can reply to a specific message by including `replyToId` in the request. The replied-to message content will be embedded in the response.

#### Send Document
```
POST /api/chat/messages/document
Content-Type: multipart/form-data
Fields:
  - document: File (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT - max 50MB)
  - conversationId: string
  - content: string (optional caption)
```

**Document Message Response:**
```json
{
    "success": true,
    "data": {
        "_id": "message_id",
        "type": "document",
        "content": "Optional caption",
        "documentUrl": "https://...",
        "documentName": "report.pdf",
        "documentMimeType": "application/pdf",
        "documentSize": 1024576
    }
}
```

#### Delete Message
```
DELETE /api/chat/messages/:messageId
```

#### Bulk Delete Messages
```
POST /api/chat/messages/bulk-delete
Body: {
    "messageIds": ["msg_id_1", "msg_id_2", "msg_id_3"]
}
```

**Response:**
```json
{
    "success": true,
    "message": "3 messages deleted"
}
```

#### Forward Messages
```
POST /api/chat/messages/forward
Body: {
    "messageIds": ["msg_id_1", "msg_id_2"],
    "targetConversationIds": ["conv_id_1", "conv_id_2"]
}
```

Forward messages to one or multiple conversations. The forwarded messages are sent as new messages from the forwarding user.

**Response:**
```json
{
    "success": true,
    "message": "4 messages forwarded"
}
```

#### Bulk Delete Conversations
```
POST /api/chat/conversations/bulk-delete
Body: {
    "conversationIds": ["conv_id_1", "conv_id_2"]
}
```

#### Mark Conversation as Read
```
PATCH /api/chat/conversations/:conversationId/read
```

### Status/Stories

#### Get Status Feed
```
GET /api/chat/statuses
Query:
  - page (default: 1)
  - limit (default: 20)
  - category (optional): 'projects_testimonials' | 'events_news' | 'needs_jobs' | 'business_opportunities' | 'culture_tourism'
```

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "_id": "status_id",
            "userId": "user_id",
            "user": {
                "_id": "user_id",
                "name": "John Doe",
                "avatar": "https://..."
            },
            "category": "business_opportunities",
            "contentType": "image",
            "textContent": "Check out this opportunity!",
            "mediaUrl": "https://storage.googleapis.com/sbc-status-media-private/...",
            "thumbnailUrl": "https://storage.googleapis.com/sbc-status-media-private/...",
            "likesCount": 45,
            "repostsCount": 12,
            "viewsCount": 230,
            "repliesCount": 8,
            "isLiked": false,
            "isReposted": false,
            "isViewed": true,
            "expiresAt": "2025-01-16T10:30:00Z",
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ],
    "pagination": {...}
}
```

**IMPORTANT - Signed URLs**:
- `mediaUrl` and `thumbnailUrl` are **signed URLs** (temporary links)
- They expire after **1 hour** (3600 seconds)
- Backend automatically converts `gs://` paths to signed URLs
- Frontend should use URLs as-is without modification
- If a URL is expired, refetch the statuses to get fresh signed URLs

#### Get Single Status
```
GET /api/chat/statuses/:statusId
```

#### Create Status (User Categories Only)
```
POST /api/chat/statuses
Content-Type: multipart/form-data
Fields:
  - category: 'needs_jobs' | 'business_opportunities' | 'culture_tourism'
  - contentType: 'text' | 'image' | 'video' | 'flyer'
  - textContent: string (required for text, optional caption for media)
  - media: File (for image/video/flyer)
  - duration: number (optional, video duration in seconds, max 30)
```

**IMPORTANT**: Users can only post to these 3 categories:
- `needs_jobs` (Besoins & Emplois)
- `business_opportunities` (Business & Opportunités)
- `culture_tourism` (Culture & Tourisme)

Admin-only categories (users CANNOT post to):
- `projects_testimonials` (Projets & Témoignages)
- `events_news` (Événements & Actualités)

#### Delete Own Status
```
DELETE /api/chat/statuses/:statusId
```

#### Like Status
```
POST /api/chat/statuses/:statusId/like
```

#### Unlike Status
```
DELETE /api/chat/statuses/:statusId/like
```

#### Repost Status
```
POST /api/chat/statuses/:statusId/repost
```

#### Record View
```
POST /api/chat/statuses/:statusId/view
```

#### Get Status Interactions (Likes, Reposts)
```
GET /api/chat/statuses/:statusId/interactions
Query: type ('like' | 'repost' | 'view')
```

#### Reply to Status (Opens Chat)
```
POST /api/chat/statuses/:statusId/reply
Body: { "content": "Your reply message" }
```

This creates a conversation with the status author and sends the first message.

---

## WebSocket (Socket.IO) Integration

### Connection Setup

```javascript
import { io } from 'socket.io-client';

const socket = io(SOCKET_URL, {
    auth: { token: userJwtToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Connection events
socket.on('connect', () => {
    console.log('Connected:', socket.id);
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
});
```

### Chat Events

#### Client -> Server Events

```javascript
// Join a conversation room (do this when opening a chat)
socket.emit('conversation:join', conversationId);

// Leave a conversation room (do this when closing a chat)
socket.emit('conversation:leave', conversationId);

// Send a message via socket (alternative to REST)
socket.emit('message:send', {
    conversationId: 'conv_id',
    content: 'Hello!',
    type: 'text'
});

// Mark messages as read
socket.emit('message:read', {
    conversationId: 'conv_id',
    messageIds: ['msg_id_1', 'msg_id_2'] // optional, marks all if not provided
});

// Typing indicators
socket.emit('typing:start', conversationId);
socket.emit('typing:stop', conversationId);
```

#### Server -> Client Events

```javascript
// New message received
socket.on('message:new', (message) => {
    // message object with full details
    console.log('New message:', message);
});

// Message sent confirmation
socket.on('message:sent', (message) => {
    // Your sent message with server-assigned _id
});

// Message status updated (delivered/read)
socket.on('message:status', ({ messageId, status, readBy }) => {
    // Update message status in UI
});

// Message deleted
socket.on('message:deleted', ({ messageId, conversationId }) => {
    // Remove message from UI
});

// Typing indicators
socket.on('user:typing', ({ conversationId, userId, userName }) => {
    // Show "User is typing..."
});

socket.on('user:stopped_typing', ({ conversationId, userId }) => {
    // Hide typing indicator
});

// Error handling
socket.on('error', ({ message, code }) => {
    console.error('Socket error:', message);
});
```

### Status Events

#### Client -> Server Events

```javascript
// Subscribe to status updates (optionally filter by categories)
socket.emit('status:subscribe', ['business_opportunities', 'needs_jobs']);
// Or subscribe to all:
socket.emit('status:subscribe');

// Unsubscribe from status updates
socket.emit('status:unsubscribe');

// Real-time interactions
socket.emit('status:like', statusId);
socket.emit('status:unlike', statusId);
socket.emit('status:repost', statusId);
socket.emit('status:view', statusId);
```

#### Server -> Client Events

```javascript
// New status posted
socket.on('status:new', (status) => {
    // Add to feed if category matches subscription
    // For story-based UI: Add to existing story group or create new group
    // IMPORTANT: status.mediaUrl will be a signed URL - use as-is
});

// Status updated (counts changed)
socket.on('status:updated', (status) => {
    // Update status in feed
    // Update story viewer if currently viewing this status
});

// Status deleted or expired
socket.on('status:deleted', ({ statusId }) => {
    // Remove from feed
    // If viewing this story, skip to next story
    // If last story in group, remove entire group from stories bar
});

// Like confirmation
socket.on('status:liked', ({ statusId, likesCount }) => {
    // Update UI
    // Update heart icon in story viewer if currently viewing
});

socket.on('status:unliked', ({ statusId, likesCount }) => {
    // Update UI
    // Update heart icon in story viewer if currently viewing
});

// Repost confirmation
socket.on('status:reposted', ({ statusId, repostsCount }) => {
    // Update UI (optional feature)
});

// View recorded
socket.on('status:viewed', ({ statusId, viewsCount }) => {
    // Update view count
    // Mark story as viewed (affects badge indicators)
});
```

### Presence Events

```javascript
// User online status changes
socket.on('user:online', ({ userId }) => {
    // Mark user as online in UI
});

socket.on('user:offline', ({ userId }) => {
    // Mark user as offline in UI
});
```

---

## Status Feature (Les Statuts) - Instagram/Facebook Stories Style

The status feature has been redesigned to follow Instagram/Facebook Stories UI patterns, providing a modern story-based experience with full-screen viewing and creation.

### Categories

| Category | Display Name (FR) | Badge Color | Who Can Post |
|----------|------------------|-------------|--------------|
| `projects_testimonials` | Projets & Témoignages | Gold (#FFD700) | Admin Only |
| `events_news` | Événements & Actualités | Blue (#007BFF) | Admin Only |
| `needs_jobs` | Besoins & Emplois | Green (#28A745) | All Users |
| `business_opportunities` | Business & Opportunités | Violet (#6F42C1) | All Users |
| `culture_tourism` | Culture & Tourisme | Orange (#FD7E14) | All Users |

### Content Types

- **text**: Plain text status (max 500 characters) - displayed on gradient background
- **image**: Image with optional caption (JPEG, PNG, GIF, max 10MB)
- **video**: Video with optional caption (MP4, WebM, max 50MB, max 30 seconds)
- **flyer**: Promotional image/flyer (same as image)

### Media Storage & Security

**IMPORTANT**: All media files (images/videos) are stored in a **PRIVATE** Google Cloud Storage bucket (`sbc-status-media-private`).

#### How It Works:

1. **Upload Process**:
   - Files are uploaded to the chat-service via `POST /api/chat/statuses`
   - Chat-service forwards the file to settings-service internal endpoint
   - Settings-service uploads to private GCS bucket
   - Returns GCS path in format: `gs://sbc-status-media-private/statuses/images/uuid.jpg`

2. **Access Process**:
   - When fetching statuses, the backend generates **signed URLs** (temporary links)
   - Signed URLs expire after **1 hour** (3600 seconds)
   - Frontend receives signed URLs and displays them normally
   - Users cannot access media files without a valid signed URL

3. **Client Implementation Notes**:
   - Always use the `mediaUrl` and `mediaThumbnailUrl` from the API response
   - URLs starting with `gs://` are internal paths - backend converts them to signed URLs
   - Signed URLs are automatically generated when calling `GET /api/chat/statuses`
   - No special handling needed on frontend - just use the URL as-is

### Story-Based UI Architecture

The UI follows Instagram/Facebook Stories patterns with three main components:

#### 1. Stories Bar (Horizontal Scroll)

A horizontal scrollable bar at the top showing all users who have active stories:

```tsx
// Stories grouped by author
interface StoryGroup {
    userId: string;
    authorName: string;
    authorAvatar: string;
    statuses: Status[];
    hasUnviewed: boolean;
}

// UI Layout
<div className="stories-bar">
    {/* Add Your Story Button */}
    <button className="create-story-btn">
        <div className="avatar-ring">
            <img src={currentUserAvatar} />
            <PlusIcon />
        </div>
        <span>Your Story</span>
    </button>

    {/* User Stories */}
    {storyGroups.map(group => (
        <button onClick={() => openStoryViewer(group)}>
            <div className={group.hasUnviewed ? "avatar-ring-gradient" : "avatar-ring-gray"}>
                <img src={group.authorAvatar} />
            </div>
            <span>{group.authorName}</span>
        </button>
    ))}
</div>
```

**Visual Indicators**:
- **Unviewed stories**: Gradient ring (yellow-to-pink)
- **Viewed stories**: Gray ring
- Stories auto-expire after 24 hours

#### 2. Full-Screen Story Viewer

When user clicks a story group, open a full-screen modal:

```tsx
// Full-screen viewer with progress bars
<div className="story-viewer-fullscreen">
    {/* Progress Bars */}
    <div className="progress-bars">
        {currentGroup.statuses.map((_, index) => (
            <div className="progress-bar-track">
                <div
                    className="progress-bar-fill"
                    style={{
                        width: index === currentIndex ? `${progress}%` :
                               index < currentIndex ? '100%' : '0%'
                    }}
                />
            </div>
        ))}
    </div>

    {/* Story Header */}
    <div className="story-header">
        <img src={currentGroup.authorAvatar} />
        <span>{currentGroup.authorName}</span>
        <span>{formatTimeAgo(currentStory.createdAt)}</span>
        <button onClick={closeViewer}>✕</button>
    </div>

    {/* Story Content */}
    {currentStory.mediaUrl ? (
        currentStory.contentType === 'video' ? (
            <video src={currentStory.mediaUrl} autoPlay muted playsInline />
        ) : (
            <img src={currentStory.mediaUrl} />
        )
    ) : (
        <div className="text-story-gradient">
            <p>{currentStory.textContent}</p>
        </div>
    )}

    {/* Text Overlay (if media has caption) */}
    {currentStory.mediaUrl && currentStory.textContent && (
        <div className="caption-overlay">
            <p>{currentStory.textContent}</p>
        </div>
    )}

    {/* Navigation Zones */}
    <div className="nav-zone-left" onClick={handlePrevStory} />
    <div className="nav-zone-right" onClick={handleNextStory} />

    {/* Action Bar */}
    <div className="action-bar">
        <button onClick={() => replyToStory(currentStory)}>
            💬 Reply
        </button>
        <button onClick={() => toggleLike(currentStory)}>
            {currentStory.isLiked ? '❤️' : '🤍'} {currentStory.likesCount}
        </button>
    </div>
</div>
```

**Navigation Behavior**:
- **Click left side**: Previous story (or previous user's stories)
- **Click right side**: Next story (or next user's stories)
- **Auto-advance**: 5 seconds per story (pause on video if longer)
- **Progress bars**: Show current story position and progress

#### 3. Full-Screen Story Composer (with Live Preview)

When creating a story, show a full-screen modal with **LIVE PREVIEW** like WhatsApp/Instagram:

```tsx
// Full-screen composer with real-time preview
<div className="story-composer-fullscreen">
    {/* Background/Media Preview */}
    {selectedMedia ? (
        selectedMedia.type.startsWith('video/') ? (
            <video
                src={URL.createObjectURL(selectedMedia)}
                className="preview-video"
                autoPlay
                loop
                muted
            />
        ) : (
            <img
                src={URL.createObjectURL(selectedMedia)}
                className="preview-image"
            />
        )
    ) : (
        // Gradient background for text-only stories
        <div className="gradient-background" />
    )}

    {/* Text Overlay (real-time preview) */}
    <div className="text-overlay-preview">
        {textContent && (
            <p className="story-text-preview">{textContent}</p>
        )}
    </div>

    {/* Category Selector (Top) */}
    <div className="category-selector">
        <select value={category} onChange={handleCategoryChange}>
            <option value="">Select Category</option>
            <option value="needs_jobs">Besoins & Emplois</option>
            <option value="business_opportunities">Business & Opportunités</option>
            <option value="culture_tourism">Culture & Tourisme</option>
        </select>
    </div>

    {/* Bottom Controls (Glassmorphism) */}
    <div className="controls-bottom">
        {/* Text Input */}
        <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Add text to your story..."
            className="text-input-glass"
        />

        {/* Media Upload Buttons */}
        {!selectedMedia && (
            <div className="media-buttons">
                <label className="upload-btn">
                    <ImageIcon />
                    <span>Photo</span>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        hidden
                    />
                </label>
                <label className="upload-btn">
                    <VideoIcon />
                    <span>Video</span>
                    <input
                        type="file"
                        accept="video/*"
                        onChange={handleVideoSelect}
                        hidden
                    />
                </label>
            </div>
        )}

        {/* Remove Media Button */}
        {selectedMedia && (
            <button onClick={() => setSelectedMedia(null)}>
                Remove Media
            </button>
        )}

        {/* Share Button */}
        <button
            onClick={handleShareStory}
            disabled={!category || !textContent.trim()}
            className="share-btn"
        >
            Share Story
        </button>
    </div>
</div>
```

**Key Features**:
- **Live Preview**: Media/text displays exactly as it will appear
- **Real-time Text**: Text overlays on media in real-time as user types
- **Gradient Backgrounds**: Text-only stories have beautiful gradients
- **Glassmorphism UI**: Semi-transparent controls with backdrop blur
- **Category First**: Must select category before sharing

### Visibility Rules

- **ALL registered users see ALL statuses** - no mutual contact requirement
- Status feed is public to all authenticated users
- Users can filter by category
- Statuses expire after 24 hours by default
- Media files stored in PRIVATE bucket with signed URL access

### Interactions

1. **View**: Automatically recorded when story is viewed (impacts hasUnviewed badges)
2. **Like**: Toggle like on a status (shows heart icon and count)
3. **Reply**: Opens a private chat with the status author
4. **Repost**: Share status to your followers (creates reference) - Optional feature

### Implementation Checklist

- [ ] Horizontal stories bar with user avatars
- [ ] Unviewed/viewed badge indicators (gradient vs gray)
- [ ] Full-screen story viewer with progress bars
- [ ] Auto-advance (5s per story)
- [ ] Click navigation (left/right zones)
- [ ] Full-screen story composer with live preview
- [ ] Real-time text overlay on media
- [ ] Gradient backgrounds for text-only stories
- [ ] Category selector in composer
- [ ] Handle signed URLs for private media
- [ ] Story grouping by author
- [ ] View tracking

---

## Internal Messaging Feature

### Key Rules

1. **Text and Documents ONLY** - NO images, NO videos, NO voice messages
2. **Supported Document Types**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT
3. **Max Document Size**: 50MB
4. **Ad Integration**: Ads may appear in the conversation list (type: 'ad')

### Message Types

| Type | Description | Fields |
|------|-------------|--------|
| `text` | Plain text message | `content` |
| `document` | File attachment | `documentUrl`, `documentName`, `documentMimeType`, `documentSize`, `content` (caption) |
| `system` | System notification | `content` |
| `ad` | Advertisement | `content`, `adImageUrl`, `adRedirectUrl`, `adCta` |

### Conversation Types

| Type | Description |
|------|-------------|
| `direct` | One-on-one private chat |
| `status_reply` | Conversation started from status reply |

### UI Flow

1. **Conversation List**:
   - Show list of conversations with last message preview
   - Show unread count badge
   - Show online status indicator
   - Ads may appear inline (type: 'ad')

2. **Chat View**:
   - Messages grouped by date
   - Sent/delivered/read indicators
   - Typing indicator
   - Document preview with download option
   - NO image/video sending button - only text and document attachment

3. **Starting a Chat**:
   - From user profile: `POST /api/chat/conversations` with `participantId`
   - From status reply: `POST /api/chat/statuses/:statusId/reply`

### New Features

#### Reply-To Messages (WhatsApp-style)
Users can reply to specific messages. When replying:
1. Show a preview of the original message above the input
2. Include the `replyToId` when sending the message
3. Display replied messages with the embedded `replyTo` content

```typescript
// Example reply-to UI
<div className="reply-preview">
    <span>{replyTo.senderName}</span>
    <p>{replyTo.content}</p>
</div>
<input placeholder="Reply to message..." />
```

#### Multi-Select Mode (Long Press)
For better mobile UX, implement long-press to enter selection mode:
1. Long press (500ms) on a message/conversation enters selection mode
2. First pressed item is automatically selected
3. Tap other items to toggle selection
4. Show action bar with: Copy, Forward, Delete

```typescript
// Long press detection
const handleLongPress = (item) => {
    setSelectMode(true);
    setSelectedItems(new Set([item.id]));
};
```

#### Forward Messages Flow
1. User selects messages in selection mode
2. User taps "Forward" button
3. Show conversation picker modal
4. User selects target conversations
5. Call `POST /api/chat/messages/forward`
6. **Important**: After forwarding, update the conversation list to show the new last message

```typescript
// After successful forward
const handleForward = async (messageIds, conversationIds) => {
    await forwardMessages(messageIds, conversationIds);

    // Update conversation list with new last message
    setConversations(prev => prev.map(conv => {
        if (conversationIds.includes(conv._id)) {
            return {
                ...conv,
                lastMessage: { content: forwardedContent, ... },
                lastMessageAt: new Date().toISOString()
            };
        }
        return conv;
    }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)));

    // Reload messages if current conversation was a target
    if (conversationIds.includes(currentConversation._id)) {
        await reloadMessages();
    }
};
```

#### Confirmation Modals
Always show confirmation before destructive actions:
- Delete message(s)
- Delete conversation(s)

Include warning message: "This action cannot be undone."

---

## Data Models

### Conversation

```typescript
interface Conversation {
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
    statusId?: string; // For status_reply type
    createdAt: string;
    updatedAt: string;
}

interface ConversationParticipant {
    _id: string;
    name: string;
    avatar?: string;
    isOnline: boolean;
}
```

### Message

```typescript
interface Message {
    _id: string;
    conversationId: string;
    senderId: string;
    sender?: {
        _id: string;
        name: string;
        avatar?: string;
    };
    type: 'text' | 'document' | 'system' | 'ad';
    content: string;
    // Reply-to feature
    replyTo?: {
        messageId: string;
        content: string;      // Truncated to 100 chars
        senderId: string;
        senderName: string;
        type: 'text' | 'document' | 'system' | 'ad';
    };
    // Document fields
    documentUrl?: string;
    documentName?: string;
    documentMimeType?: string;
    documentSize?: number;
    // Ad fields
    adImageUrl?: string;
    adRedirectUrl?: string;
    adCta?: string;
    // Status
    status: 'sent' | 'delivered' | 'read';
    readBy: string[];
    createdAt: string;
    updatedAt: string;
}
```

### Status

```typescript
interface Status {
    _id: string;
    userId: string;
    user?: {
        _id: string;
        name: string;
        avatar?: string;
    };
    category: StatusCategory;
    contentType: 'text' | 'image' | 'video' | 'flyer';
    textContent?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    mediaDuration?: number; // For videos
    // Counts
    likesCount: number;
    repostsCount: number;
    viewsCount: number;
    repliesCount: number;
    // User interaction flags (populated per request)
    isLiked: boolean;
    isReposted: boolean;
    isViewed: boolean;
    // Repost reference
    originalStatusId?: string;
    originalStatus?: Status;
    // Metadata
    expiresAt: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

type StatusCategory =
    | 'projects_testimonials'
    | 'events_news'
    | 'needs_jobs'
    | 'business_opportunities'
    | 'culture_tourism';
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid/missing token) |
| 403 | Forbidden (no permission) |
| 404 | Not Found |
| 500 | Server Error |

### Error Response Format

```json
{
    "success": false,
    "message": "Error description",
    "error": "VALIDATION_ERROR"
}
```

### Socket Error Events

```javascript
socket.on('error', ({ message, code }) => {
    switch(code) {
        case 'UNAUTHORIZED':
            // Re-authenticate
            break;
        case 'NOT_FOUND':
            // Resource not found
            break;
        case 'FORBIDDEN':
            // No permission
            break;
        default:
            // General error
    }
});
```

---

## Best Practices

### 1. Connection Management

```javascript
// Connect when app starts or user logs in
// Disconnect when user logs out
// Handle reconnection automatically via Socket.IO settings
```

### 2. Optimistic Updates

```javascript
// For better UX, update UI immediately then sync with server
// Example: Like a status
const handleLike = async (statusId) => {
    // Update UI immediately
    setStatuses(prev => prev.map(s =>
        s._id === statusId
            ? { ...s, isLiked: true, likesCount: s.likesCount + 1 }
            : s
    ));

    // Then call API
    try {
        await likeStatus(statusId);
    } catch (error) {
        // Revert on error
        setStatuses(prev => prev.map(s =>
            s._id === statusId
                ? { ...s, isLiked: false, likesCount: s.likesCount - 1 }
                : s
        ));
    }
};
```

### 3. Pagination

```javascript
// Load more on scroll
const loadMoreStatuses = async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    const response = await getStatuses(currentPage + 1);

    setStatuses(prev => [...prev, ...response.data]);
    setCurrentPage(response.pagination.currentPage);
    setHasMore(response.pagination.currentPage < response.pagination.totalPages);
    setLoading(false);
};
```

### 4. Message Deduplication

```javascript
// When receiving messages via socket, check for duplicates
socket.on('message:new', (message) => {
    setMessages(prev => {
        // Check if message already exists (from optimistic update)
        if (prev.some(m => m._id === message._id)) {
            return prev;
        }
        return [...prev, message];
    });
});
```

### 5. Online Status Tracking

```javascript
// Keep track of online users
const [onlineUsers, setOnlineUsers] = useState(new Set());

socket.on('user:online', ({ userId }) => {
    setOnlineUsers(prev => new Set(prev).add(userId));
});

socket.on('user:offline', ({ userId }) => {
    setOnlineUsers(prev => {
        const updated = new Set(prev);
        updated.delete(userId);
        return updated;
    });
});

// Use in UI
const isUserOnline = (userId) => onlineUsers.has(userId);
```

### 6. Document Upload Progress

```javascript
const uploadDocument = async (conversationId, file, onProgress) => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('conversationId', conversationId);

    return axios.post('/api/chat/messages/document', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percent);
        }
    });
};
```

---

## Flutter/Dart Example

For Flutter implementations, here's a basic Socket.IO setup:

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

class ChatSocketService {
  late IO.Socket socket;

  void connect(String token) {
    socket = IO.io(
      'YOUR_SOCKET_URL',
      IO.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .setAuth({'token': token})
        .enableAutoConnect()
        .enableReconnection()
        .build()
    );

    socket.onConnect((_) {
      print('Connected');
    });

    socket.on('message:new', (data) {
      // Handle new message
    });

    socket.on('status:new', (data) {
      // Handle new status
    });
  }

  void joinConversation(String conversationId) {
    socket.emit('conversation:join', conversationId);
  }

  void sendMessage(String conversationId, String content) {
    socket.emit('message:send', {
      'conversationId': conversationId,
      'content': content,
      'type': 'text'
    });
  }

  void disconnect() {
    socket.disconnect();
  }
}
```

---

## Questions?

For any questions about this integration, please refer to:
- The chat-service source code in `/chat-service/src`
- The admin frontend implementation in `/admin-frontend-ms/src/pages/ChatPage.tsx` and `StatusPage.tsx`
- Socket context example in `/admin-frontend-ms/src/contexts/SocketContext.tsx`
