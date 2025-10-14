# Relance Feature - React Frontend Implementation Guide

## Overview

The **Relance** feature is a WhatsApp-based automated follow-up system for unpaid referrals. This guide explains how to implement the user-facing React frontend for this feature.

---

## Table of Contents

1. [Feature Summary](#feature-summary)
2. [Business Logic](#business-logic)
3. [API Endpoints Reference](#api-endpoints-reference)
4. [Data Models](#data-models)
5. [Implementation Steps](#implementation-steps)
6. [UI/UX Flow](#uiux-flow)
7. [Code Examples](#code-examples)
8. [Subscription Integration](#subscription-integration)

---

## Feature Summary

**What is Relance?**
- Users purchase a **RELANCE** subscription for **1,000 XAF/month** (~$2.2 USD for crypto payments)
- When they refer someone who doesn't pay within **1 hour**, that referral enters a **7-day automated WhatsApp loop**
- System sends **daily WhatsApp messages** (Day 1-7) with customizable templates
- Referral **exits the loop** when they pay OR after 7 days complete
- Users control: WhatsApp connection, pause enrollment, pause sending, enable/disable

**Key Features:**
- WhatsApp Web connection via QR code
- Real-time connection status monitoring
- View active referrals in the loop
- Control message sending settings
- Multi-language support (French/English)

---

## Business Logic

### Subscription Requirements

1. **Subscription Type:** `RELANCE` (SubscriptionType enum)
2. **Category:** `FEATURE` (SubscriptionCategory enum)
3. **Duration:** `MONTHLY` (SubscriptionDuration enum)
4. **Price:** 1,000 XAF/month (~$2.2 USD crypto)
5. **Auto-renewal:** Optional

**Check subscription:**
```
GET /api/subscriptions/check/RELANCE
```

**Purchase subscription:**
```
POST /api/subscriptions/purchase
Body: {
  "subscriptionType": "RELANCE",
  "paymentMethod": "cinetpay" | "feexpay" | "crypto"
}
```

### Enrollment Triggers

- **Automatic enrollment:** Cron job runs **every hour**
- **Eligibility criteria:**
  1. User (referrer) has **active RELANCE subscription**
  2. User's WhatsApp is **connected**
  3. Enrollment is **not paused** (`enrollmentPaused: false`)
  4. Relance is **enabled** (`enabled: true`)
  5. Referral registered **more than 1 hour ago**
  6. Referral has **no active subscription** (CLASSIQUE or CIBLE)
  7. Referral is **not already in the loop**

### Exit Conditions

Referrals exit the loop when:
1. **They pay** - Any subscription purchase (CLASSIQUE/CIBLE)
2. **7 days complete** - Received all 7 daily messages
3. **Referrer's subscription expires** - RELANCE subscription ends
4. **Manual removal** - Admin action (future feature)

### Message Sending Schedule

- **Cron job runs:** Every **6 hours** (4 times per day)
- **Sends messages to:** Targets whose `nextMessageDue` date has passed
- **Daily progression:** After sending Day N, increments to Day N+1
- **Time calculation:** `nextMessageDue = lastMessageSentAt + 24 hours`

---

## API Endpoints Reference

### Base URL
```
/api/relance
```

### User Endpoints (Authenticated)

#### 1. Connect WhatsApp
**Endpoint:** `POST /api/relance/connect`
**Description:** Generate QR code for WhatsApp Web connection
**Auth:** Required (JWT Bearer token)
**Request:** No body
**Response:**
```json
{
  "success": true,
  "data": {
    "qr": "data:image/png;base64,..." // Base64 QR code image
  }
}
```
**Notes:**
- QR code expires after ~60 seconds if not scanned
- Poll `/status` endpoint to detect when user scans QR
- Connection persists across app restarts

---

#### 2. Get Status
**Endpoint:** `GET /api/relance/status`
**Description:** Check WhatsApp connection status and settings
**Auth:** Required
**Response:**
```json
{
  "success": true,
  "data": {
    "whatsappStatus": "connected" | "disconnected" | "expired",
    "enabled": true,
    "enrollmentPaused": false,
    "sendingPaused": false,
    "messagesSentToday": 45,
    "lastConnectionCheck": "2025-01-15T10:30:00Z"
  }
}
```
**Status Values:**
- `connected` - WhatsApp ready to send messages
- `disconnected` - No WhatsApp connection
- `expired` - Session expired, need to re-scan QR

---

#### 3. Disconnect WhatsApp
**Endpoint:** `DELETE /api/relance/disconnect`
**Description:** Logout WhatsApp session
**Auth:** Required
**Response:**
```json
{
  "success": true,
  "message": "WhatsApp disconnected successfully"
}
```
**Notes:**
- Stops all message sending immediately
- Does NOT remove referrals from loop
- User must re-scan QR to reconnect

---

#### 4. Update Settings
**Endpoint:** `PUT /api/relance/settings`
**Description:** Update pause/enable settings
**Auth:** Required
**Request:**
```json
{
  "enabled": true,           // Master switch (optional)
  "enrollmentPaused": false, // Pause new enrollments (optional)
  "sendingPaused": false     // Pause message sending (optional)
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "userId": "...",
    "enabled": true,
    "enrollmentPaused": false,
    "sendingPaused": false,
    "whatsappStatus": "connected",
    "messagesSentToday": 45,
    // ... other fields
  }
}
```
**Settings Behavior:**
- `enabled: false` - Pauses EVERYTHING (enrollment + sending)
- `enrollmentPaused: true` - Only pauses new enrollments
- `sendingPaused: true` - Only pauses message sending
- All optional - send only fields you want to update

---

#### 5. Get My Targets
**Endpoint:** `GET /api/relance/targets`
**Description:** Get user's active referrals in the loop
**Auth:** Required
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "referralUserId": "...",
      "referrerUserId": "...",
      "enteredLoopAt": "2025-01-10T12:00:00Z",
      "currentDay": 3,
      "nextMessageDue": "2025-01-13T12:00:00Z",
      "lastMessageSentAt": "2025-01-12T12:00:00Z",
      "messagesDelivered": [
        {
          "day": 1,
          "sentAt": "2025-01-10T12:00:00Z",
          "status": "delivered"
        },
        {
          "day": 2,
          "sentAt": "2025-01-11T12:00:00Z",
          "status": "delivered"
        },
        {
          "day": 3,
          "sentAt": "2025-01-12T12:00:00Z",
          "status": "failed",
          "errorMessage": "WhatsApp session expired"
        }
      ],
      "status": "active",
      "language": "fr",
      "createdAt": "2025-01-10T11:00:00Z",
      "updatedAt": "2025-01-12T12:05:00Z"
    }
    // ... more targets (max 100)
  ]
}
```
**Notes:**
- Returns max 100 most recent targets
- Only shows `status: "active"` targets
- Use `messagesDelivered` array to show progress

---

## Data Models

### RelanceConfig (User Settings)

```typescript
interface RelanceConfig {
  _id: string;
  userId: string;                     // SBC member ID
  enabled: boolean;                   // Master switch
  enrollmentPaused: boolean;          // Pause new enrollments only
  sendingPaused: boolean;             // Pause sending only
  whatsappAuthData: string;           // Encrypted session (backend only)
  whatsappStatus: 'connected' | 'disconnected' | 'expired';
  lastQrScanDate?: string;            // ISO date
  lastConnectionCheck?: string;       // ISO date
  messagesSentToday: number;          // Rate limiting counter
  lastResetDate: string;              // ISO date
  createdAt: string;
  updatedAt: string;
}
```

### RelanceTarget (Referral in Loop)

```typescript
interface RelanceTarget {
  _id: string;
  referralUserId: string;             // Referral's user ID
  referrerUserId: string;             // Your user ID
  enteredLoopAt: string;              // ISO date
  currentDay: number;                 // 1-7
  nextMessageDue: string;             // ISO date
  lastMessageSentAt?: string;         // ISO date
  messagesDelivered: MessageDelivery[];
  exitedLoopAt?: string;              // ISO date (if exited)
  exitReason?: 'paid' | 'completed_7days' | 'manual' | 'referrer_inactive';
  status: 'active' | 'completed' | 'paused';
  language: 'fr' | 'en';
  createdAt: string;
  updatedAt: string;
}

interface MessageDelivery {
  day: number;                        // 1-7
  sentAt: string;                     // ISO date
  status: 'delivered' | 'failed';
  errorMessage?: string;              // If failed
}
```

---

## Implementation Steps

### Step 1: Check Subscription

Before showing Relance UI, verify user has active RELANCE subscription:

```typescript
// api/subscriptionApi.ts
export const checkRelanceSubscription = async (): Promise<boolean> => {
  const response = await apiClient.get('/subscriptions/check/RELANCE');
  return response.data.hasSubscription;
};

// In your component
useEffect(() => {
  const checkSub = async () => {
    const hasRelance = await checkRelanceSubscription();
    if (!hasRelance) {
      // Show subscription prompt
      setShowSubscriptionModal(true);
    } else {
      // Load Relance UI
      fetchRelanceStatus();
    }
  };
  checkSub();
}, []);
```

### Step 2: Create API Service

```typescript
// services/relanceApi.ts
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const relanceApi = {
  // Connect WhatsApp
  connect: async () => {
    const response = await apiClient.post('/relance/connect');
    return response.data.data;
  },

  // Get status
  getStatus: async () => {
    const response = await apiClient.get('/relance/status');
    return response.data.data;
  },

  // Disconnect
  disconnect: async () => {
    const response = await apiClient.delete('/relance/disconnect');
    return response.data;
  },

  // Update settings
  updateSettings: async (settings: {
    enabled?: boolean;
    enrollmentPaused?: boolean;
    sendingPaused?: boolean;
  }) => {
    const response = await apiClient.put('/relance/settings', settings);
    return response.data.data;
  },

  // Get targets
  getTargets: async () => {
    const response = await apiClient.get('/relance/targets');
    return response.data.data;
  },
};
```

### Step 3: Build Component State

```typescript
// pages/RelancePage.tsx
import { useState, useEffect } from 'react';
import { relanceApi } from '../services/relanceApi';

interface RelanceStatus {
  whatsappStatus: 'connected' | 'disconnected' | 'expired';
  enabled: boolean;
  enrollmentPaused: boolean;
  sendingPaused: boolean;
  messagesSentToday: number;
  lastConnectionCheck?: string;
}

interface RelanceTarget {
  _id: string;
  referralUserId: string;
  currentDay: number;
  nextMessageDue: string;
  messagesDelivered: Array<{
    day: number;
    sentAt: string;
    status: 'delivered' | 'failed';
  }>;
  status: 'active' | 'completed' | 'paused';
}

export const RelancePage = () => {
  const [status, setStatus] = useState<RelanceStatus | null>(null);
  const [targets, setTargets] = useState<RelanceTarget[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
    fetchTargets();
  }, []);

  const fetchStatus = async () => {
    try {
      const data = await relanceApi.getStatus();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  const fetchTargets = async () => {
    try {
      const data = await relanceApi.getTargets();
      setTargets(data);
    } catch (error) {
      console.error('Failed to fetch targets:', error);
    }
  };

  // ... implement handlers
};
```

### Step 4: Implement WhatsApp Connection

```typescript
// QR Code Connection Flow
const handleConnect = async () => {
  setLoading(true);
  try {
    const result = await relanceApi.connect();
    setQrCode(result.qr); // Base64 image

    // Poll status every 3 seconds to detect scan
    const pollInterval = setInterval(async () => {
      const statusData = await relanceApi.getStatus();
      if (statusData.whatsappStatus === 'connected') {
        clearInterval(pollInterval);
        setQrCode(null);
        setStatus(statusData);
        alert('WhatsApp connected successfully!');
      }
    }, 3000);

    // Stop polling after 60 seconds (QR expires)
    setTimeout(() => {
      clearInterval(pollInterval);
      if (qrCode) {
        setQrCode(null);
        alert('QR code expired. Please try again.');
      }
    }, 60000);
  } catch (error) {
    console.error('Failed to connect:', error);
    alert('Failed to generate QR code');
  } finally {
    setLoading(false);
  }
};

const handleDisconnect = async () => {
  if (!confirm('Disconnect WhatsApp? This will stop all message sending.')) {
    return;
  }

  try {
    await relanceApi.disconnect();
    await fetchStatus();
    alert('WhatsApp disconnected');
  } catch (error) {
    console.error('Failed to disconnect:', error);
    alert('Failed to disconnect');
  }
};
```

### Step 5: Implement Settings Controls

```typescript
const handleToggleEnabled = async () => {
  try {
    const newEnabled = !status?.enabled;
    await relanceApi.updateSettings({ enabled: newEnabled });
    await fetchStatus();
  } catch (error) {
    console.error('Failed to update:', error);
  }
};

const handleToggleEnrollment = async () => {
  try {
    const newPaused = !status?.enrollmentPaused;
    await relanceApi.updateSettings({ enrollmentPaused: newPaused });
    await fetchStatus();
  } catch (error) {
    console.error('Failed to update:', error);
  }
};

const handleToggleSending = async () => {
  try {
    const newPaused = !status?.sendingPaused;
    await relanceApi.updateSettings({ sendingPaused: newPaused });
    await fetchStatus();
  } catch (error) {
    console.error('Failed to update:', error);
  }
};
```

---

## UI/UX Flow

### Page Structure

```
┌─────────────────────────────────────────┐
│  Relance - WhatsApp Follow-up           │
├─────────────────────────────────────────┤
│  📱 WhatsApp Connection                 │
│  Status: [Connected/Disconnected]       │
│  [Connect QR] [Disconnect]              │
├─────────────────────────────────────────┤
│  ⚙️ Settings                            │
│  [ ] Master Switch (Enabled)            │
│  [ ] Pause New Enrollments              │
│  [ ] Pause Message Sending              │
├─────────────────────────────────────────┤
│  📊 Statistics                          │
│  Active Referrals: 12                   │
│  Messages Sent Today: 45                │
├─────────────────────────────────────────┤
│  👥 Active Referrals (12)               │
│  ┌─────────────────────────────────┐   │
│  │ Referral: John Doe              │   │
│  │ Current Day: 3/7                │   │
│  │ Next Message: Jan 13, 10:00 AM  │   │
│  │ Progress: ●●●○○○○               │   │
│  │ Status: ✅✅❌ (1 failed)       │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Referral: Jane Smith            │   │
│  │ ... (repeat)                    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Connection States

**1. Disconnected State:**
```
Status: ❌ Disconnected
[Connect WhatsApp] button
```

**2. QR Code Scanning:**
```
Status: ⏳ Waiting for scan...
[QR Code Image Display]
"Scan this QR code with WhatsApp"
[Cancel] button
```

**3. Connected State:**
```
Status: ✅ Connected
Last check: 2 minutes ago
[Disconnect] button
```

**4. Expired State:**
```
Status: ⚠️ Session Expired
"Your WhatsApp session has expired"
[Reconnect] button
```

### Settings Controls

```jsx
<div className="settings">
  <label>
    <input
      type="checkbox"
      checked={status?.enabled}
      onChange={handleToggleEnabled}
    />
    Enable Relance (Master Switch)
  </label>

  <label>
    <input
      type="checkbox"
      checked={status?.enrollmentPaused}
      onChange={handleToggleEnrollment}
      disabled={!status?.enabled}
    />
    Pause New Enrollments
  </label>

  <label>
    <input
      type="checkbox"
      checked={status?.sendingPaused}
      onChange={handleToggleSending}
      disabled={!status?.enabled}
    />
    Pause Message Sending
  </label>
</div>
```

### Referral Card Display

```jsx
{targets.map((target) => (
  <div key={target._id} className="referral-card">
    <h4>Referral ID: {target.referralUserId}</h4>
    <p>Day: {target.currentDay}/7</p>
    <p>Next Message: {new Date(target.nextMessageDue).toLocaleString()}</p>

    {/* Progress bar */}
    <div className="progress">
      {[1, 2, 3, 4, 5, 6, 7].map((day) => (
        <span
          key={day}
          className={day <= target.currentDay ? 'active' : 'inactive'}
        >
          {day <= target.currentDay ? '●' : '○'}
        </span>
      ))}
    </div>

    {/* Message delivery status */}
    <div className="delivery-status">
      {target.messagesDelivered.map((msg) => (
        <span key={msg.day}>
          Day {msg.day}: {msg.status === 'delivered' ? '✅' : '❌'}
        </span>
      ))}
    </div>
  </div>
))}
```

---

## Code Examples

### Complete Page Component

```tsx
// pages/RelancePage.tsx
import React, { useState, useEffect } from 'react';
import { relanceApi } from '../services/relanceApi';
import { checkRelanceSubscription } from '../services/subscriptionApi';

export const RelancePage: React.FC = () => {
  const [hasSubscription, setHasSubscription] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    // Check subscription
    const hasSub = await checkRelanceSubscription();
    setHasSubscription(hasSub);

    if (hasSub) {
      await fetchStatus();
      await fetchTargets();
    }
  };

  const fetchStatus = async () => {
    try {
      const data = await relanceApi.getStatus();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  const fetchTargets = async () => {
    try {
      const data = await relanceApi.getTargets();
      setTargets(data);
    } catch (error) {
      console.error('Failed to fetch targets:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await relanceApi.connect();
      setQrCode(result.qr);

      // Poll for connection
      const pollInterval = setInterval(async () => {
        const statusData = await relanceApi.getStatus();
        if (statusData.whatsappStatus === 'connected') {
          clearInterval(pollInterval);
          setQrCode(null);
          setStatus(statusData);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setQrCode(null);
      }, 60000);
    } catch (error) {
      console.error('Connection error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm('Disconnect WhatsApp?')) {
      await relanceApi.disconnect();
      await fetchStatus();
    }
  };

  const handleToggleEnabled = async () => {
    await relanceApi.updateSettings({
      enabled: !status.enabled
    });
    await fetchStatus();
  };

  if (!hasSubscription) {
    return (
      <div className="no-subscription">
        <h2>Relance Feature</h2>
        <p>You need an active RELANCE subscription (1,000 XAF/month) to use this feature.</p>
        <button onClick={() => window.location.href = '/subscriptions'}>
          Subscribe Now
        </button>
      </div>
    );
  }

  return (
    <div className="relance-page">
      <h1>Relance - WhatsApp Follow-up</h1>

      {/* Connection Section */}
      <section className="connection-section">
        <h2>WhatsApp Connection</h2>
        <div className="status">
          Status: {status?.whatsappStatus || 'Unknown'}
        </div>

        {qrCode ? (
          <div className="qr-section">
            <img src={qrCode} alt="QR Code" />
            <p>Scan with WhatsApp</p>
            <button onClick={() => setQrCode(null)}>Cancel</button>
          </div>
        ) : (
          <div>
            {status?.whatsappStatus === 'connected' ? (
              <button onClick={handleDisconnect}>Disconnect</button>
            ) : (
              <button onClick={handleConnect} disabled={loading}>
                {loading ? 'Generating...' : 'Connect WhatsApp'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Settings Section */}
      <section className="settings-section">
        <h2>Settings</h2>
        <label>
          <input
            type="checkbox"
            checked={status?.enabled || false}
            onChange={handleToggleEnabled}
          />
          Enable Relance
        </label>
        {/* Add more settings */}
      </section>

      {/* Targets Section */}
      <section className="targets-section">
        <h2>Active Referrals ({targets.length})</h2>
        {targets.map((target) => (
          <div key={target._id} className="target-card">
            <p>Day: {target.currentDay}/7</p>
            <p>Next: {new Date(target.nextMessageDue).toLocaleString()}</p>
          </div>
        ))}
      </section>
    </div>
  );
};
```

---

## Subscription Integration

### Subscription System Overview

The subscription system supports **two categories**:

1. **REGISTRATION** - Lifetime subscriptions (CLASSIQUE, CIBLE)
   - One-time payment, never expires
   - Required for platform access
   - `duration: "lifetime"`
   - `category: "registration"`

2. **FEATURE** - Monthly recurring (RELANCE)
   - Monthly payment required
   - Add-on features
   - `duration: "monthly"`
   - `category: "feature"`

### Subscription Endpoints

#### Get All User Subscriptions (with filtering)
```
GET /api/subscriptions?page=1&limit=10&category=feature
```

**Query Parameters:**
- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10) - Items per page
- `category` (optional) - Filter by "registration" or "feature"

**Response:**
```json
{
  "success": true,
  "data": {
    "subscriptions": [
      {
        "_id": "...",
        "user": "...",
        "subscriptionType": "RELANCE",
        "category": "feature",
        "duration": "monthly",
        "status": "active",
        "startDate": "2025-01-01T00:00:00Z",
        "endDate": "2025-02-01T00:00:00Z",
        "nextRenewalDate": "2025-02-01T00:00:00Z",
        "autoRenew": true
      }
    ],
    "totalCount": 1,
    "totalPages": 1,
    "page": 1
  }
}
```

**Usage Examples:**
```typescript
// Get all subscriptions
const allSubs = await subscriptionApi.getSubscriptions();

// Get only registration subscriptions (CLASSIQUE, CIBLE)
const regSubs = await subscriptionApi.getSubscriptions({ category: 'registration' });

// Get only feature subscriptions (RELANCE)
const featureSubs = await subscriptionApi.getSubscriptions({ category: 'feature' });
```

#### Get Active Subscriptions
```
GET /api/subscriptions/active?page=1&limit=10
```

Returns only active subscriptions (status: "active", endDate in future).

#### Get Expired Subscriptions
```
GET /api/subscriptions/expired?page=1&limit=10
```

Returns expired subscriptions.

#### Check Specific Subscription Type
```
GET /api/subscriptions/check/:type
```

**Examples:**
```
GET /api/subscriptions/check/RELANCE
GET /api/subscriptions/check/CLASSIQUE
GET /api/subscriptions/check/CIBLE
```

**Response:**
```json
{
  "success": true,
  "hasSubscription": true,
  "subscription": {
    "_id": "...",
    "subscriptionType": "RELANCE",
    "status": "active",
    "endDate": "2025-02-01T00:00:00Z",
    "category": "feature",
    "duration": "monthly"
  }
}
```

### API Service Implementation

```typescript
// services/subscriptionApi.ts
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const subscriptionApi = {
  // Get all subscriptions with optional category filter
  getSubscriptions: async (params?: {
    page?: number;
    limit?: number;
    category?: 'registration' | 'feature';
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.category) queryParams.append('category', params.category);

    const response = await apiClient.get(`/subscriptions?${queryParams.toString()}`);
    return response.data.data;
  },

  // Get active subscriptions
  getActiveSubscriptions: async (page = 1, limit = 10) => {
    const response = await apiClient.get(`/subscriptions/active?page=${page}&limit=${limit}`);
    return response.data.data;
  },

  // Get expired subscriptions
  getExpiredSubscriptions: async (page = 1, limit = 10) => {
    const response = await apiClient.get(`/subscriptions/expired?page=${page}&limit=${limit}`);
    return response.data.data;
  },

  // Check specific subscription type
  checkSubscription: async (type: 'CLASSIQUE' | 'CIBLE' | 'RELANCE') => {
    const response = await apiClient.get(`/subscriptions/check/${type}`);
    return response.data;
  },

  // Purchase subscription
  purchase: async (data: {
    subscriptionType: 'CLASSIQUE' | 'CIBLE' | 'RELANCE';
    paymentMethod: 'cinetpay' | 'feexpay' | 'crypto';
  }) => {
    const response = await apiClient.post('/subscriptions/purchase', data);
    return response.data;
  },
};

// Helper function specifically for Relance
export const checkRelanceSubscription = async (): Promise<boolean> => {
  try {
    const response = await subscriptionApi.checkSubscription('RELANCE');
    return response.hasSubscription;
  } catch (error) {
    console.error('Failed to check RELANCE subscription:', error);
    return false;
  }
};
```

### Check Subscription Before Rendering

```typescript
// App.tsx or Route Guard
import { checkRelanceSubscription } from './services/subscriptionApi';

const RelanceRoute = () => {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkRelanceSubscription().then((hasIt) => {
      setHasAccess(hasIt);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  if (!hasAccess) {
    return <SubscriptionRequired feature="RELANCE" price="1,000 XAF/month" />;
  }

  return <RelancePage />;
};
```

### Display User's Subscriptions

```typescript
// components/SubscriptionList.tsx
import { useState, useEffect } from 'react';
import { subscriptionApi } from '../services/subscriptionApi';

export const SubscriptionList = () => {
  const [registrationSubs, setRegistrationSubs] = useState([]);
  const [featureSubs, setFeatureSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSubscriptions();
  }, []);

  const loadSubscriptions = async () => {
    setLoading(true);
    try {
      // Fetch registration subscriptions (lifetime)
      const regData = await subscriptionApi.getSubscriptions({
        category: 'registration',
        limit: 100
      });
      setRegistrationSubs(regData.subscriptions);

      // Fetch feature subscriptions (monthly)
      const featureData = await subscriptionApi.getSubscriptions({
        category: 'feature',
        limit: 100
      });
      setFeatureSubs(featureData.subscriptions);
    } catch (error) {
      console.error('Failed to load subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading subscriptions...</div>;

  return (
    <div className="subscription-list">
      {/* Registration Subscriptions (Lifetime) */}
      <section>
        <h2>Platform Access (Lifetime)</h2>
        {registrationSubs.length === 0 ? (
          <p>No registration subscription found. Please purchase CLASSIQUE or CIBLE.</p>
        ) : (
          registrationSubs.map((sub: any) => (
            <div key={sub._id} className="subscription-card">
              <h3>{sub.subscriptionType}</h3>
              <p>Status: {sub.status}</p>
              <p>Duration: Lifetime</p>
              <p>Activated: {new Date(sub.startDate).toLocaleDateString()}</p>
            </div>
          ))
        )}
      </section>

      {/* Feature Subscriptions (Monthly) */}
      <section>
        <h2>Add-on Features (Monthly)</h2>
        {featureSubs.length === 0 ? (
          <p>No feature subscriptions. Explore add-ons like RELANCE!</p>
        ) : (
          featureSubs.map((sub: any) => (
            <div key={sub._id} className="subscription-card">
              <h3>{sub.subscriptionType}</h3>
              <p>Status: {sub.status}</p>
              <p>Duration: Monthly</p>
              <p>Next Renewal: {new Date(sub.nextRenewalDate).toLocaleDateString()}</p>
              <p>Auto-Renew: {sub.autoRenew ? 'Yes' : 'No'}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
};
```

### Purchase Flow

```typescript
// components/SubscriptionRequired.tsx
import { subscriptionApi } from '../services/subscriptionApi';

export const SubscriptionRequired = ({ feature, price }) => {
  const [purchasing, setPurchasing] = useState(false);

  const handlePurchase = async (paymentMethod: string) => {
    setPurchasing(true);
    try {
      const response = await subscriptionApi.purchase({
        subscriptionType: feature, // "RELANCE"
        paymentMethod: paymentMethod // "cinetpay", "feexpay", "crypto"
      });

      // Redirect to payment page
      if (response.data.paymentUrl) {
        window.location.href = response.data.paymentUrl;
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Failed to initiate purchase');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="subscription-required">
      <h2>{feature} Subscription Required</h2>
      <p>Price: {price}</p>
      <div className="payment-methods">
        <button onClick={() => handlePurchase('cinetpay')}>
          Pay with CinetPay
        </button>
        <button onClick={() => handlePurchase('feexpay')}>
          Pay with FeexPay
        </button>
        <button onClick={() => handlePurchase('crypto')}>
          Pay with Crypto
        </button>
      </div>
    </div>
  );
};
```

---

## Best Practices

### 1. Error Handling

```typescript
const handleApiCall = async (apiFunction: () => Promise<any>) => {
  try {
    return await apiFunction();
  } catch (error: any) {
    if (error.response?.status === 401) {
      // Redirect to login
      window.location.href = '/login';
    } else if (error.response?.status === 403) {
      alert('You do not have access to this feature');
    } else {
      alert('An error occurred. Please try again.');
    }
    console.error(error);
  }
};
```

### 2. Polling Management

```typescript
// Use useRef to store interval ID for cleanup
const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  // Start polling
  pollIntervalRef.current = setInterval(fetchStatus, 10000); // Every 10s

  // Cleanup on unmount
  return () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
  };
}, []);
```

### 3. Loading States

```typescript
const [loadingStates, setLoadingStates] = useState({
  connecting: false,
  disconnecting: false,
  updatingSettings: false,
  fetchingTargets: false,
});

// Use individual loading states
<button
  onClick={handleConnect}
  disabled={loadingStates.connecting}
>
  {loadingStates.connecting ? 'Connecting...' : 'Connect WhatsApp'}
</button>
```

### 4. Auto-refresh Status

```typescript
// Refresh status every 30 seconds when connected
useEffect(() => {
  if (status?.whatsappStatus === 'connected') {
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }
}, [status?.whatsappStatus]);
```

---

## Testing Checklist

- [ ] Subscription check works (blocks access if no RELANCE sub)
- [ ] QR code displays correctly
- [ ] QR code polling detects successful scan
- [ ] QR code expires after 60 seconds
- [ ] Disconnect works and updates status
- [ ] Settings toggles update immediately
- [ ] Targets list displays correctly
- [ ] Message delivery status shows correctly (✅/❌)
- [ ] Progress bar shows current day
- [ ] Next message due time displays in user timezone
- [ ] Page refreshes data periodically
- [ ] Error messages display for API failures
- [ ] Loading states prevent duplicate requests
- [ ] Responsive design works on mobile

---

## Additional Notes

### Message Templates
- Message templates (Day 1-7) are **admin-configured** in the backend
- Users **cannot customize** message content (admin feature only)
- Messages support **French and English** (based on referral's language preference)
- Messages can include **media attachments** (images/videos/PDFs)

### Referral Data
- You only get `referralUserId` in the API response
- To display referral names/phone numbers, you need to:
  1. Fetch user details from `/api/users/:userId` endpoint
  2. Or add a separate API endpoint to get enriched target data

### Rate Limiting
- `messagesSentToday` counter resets daily at midnight
- No hard limit enforced by default
- WhatsApp may rate limit if sending too many messages

### Future Enhancements
- View message templates (read-only)
- Export referral list
- Manual enrollment/removal
- Detailed analytics (open rates, response rates)
- Custom message scheduling

---

## Support

For issues or questions:
1. Check backend logs in `notification-service`
2. Verify subscription status in `user-service`
3. Check WhatsApp connection in admin panel
4. Review cron job logs for enrollment/sending issues

**Backend Documentation:**
- [RELANCE_IMPLEMENTATION_GUIDE.md](./RELANCE_IMPLEMENTATION_GUIDE.md)
- [PHASE_4_WHATSAPP_IMPLEMENTATION.md](./PHASE_4_WHATSAPP_IMPLEMENTATION.md)

---

**Last Updated:** January 2025
**Version:** 1.0
